import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { previewMobileBankFile, getMobileBankJobs, getMobileBankPreview, getMobileBankRows, confirmMobileBankImport, MobileBankPreview } from "../api/client";

// No local parsing or generic record writes: the server retains the original,
// validates every row and confirms exactly the immutable revision reviewed here.
export function FinanceBankImport({ onImported, theme }: { onImported: () => Promise<void>; theme: { text: string; muted: string; purple: string; border: string } }) {
  const locked = useRef(false);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<MobileBankPreview | null>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [jobs, setJobs] = useState<Array<{ id: string; sourceFile: string; status: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  async function run(label: string, action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(label);
    try { await action(); }
    catch (error) { Alert.alert("No se completó la operación", error instanceof Error ? error.message : "Intenta nuevamente. Puedes recuperar la importación guardada."); }
    finally { locked.current = false; setBusy(""); }
  }
  async function show(value: MobileBankPreview, nextPage = 1) {
    setPreview(value); setReviewLoaded(false); setRows([]);
    const result = await getMobileBankRows(value.jobId, value.revision, nextPage);
    setRows(result.rows); setPage(result.page); setPages(result.pages); setReviewLoaded(true);
  }
  function pick() { void run("Enviando y analizando la cartola…", async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/plain", "application/pdf", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    if ((file.size || 0) > 12 * 1024 * 1024) throw new Error("El archivo supera 12 MB. No se ha importado ningún movimiento.");
    setPreview(null); setRows([]);
    await show(await previewMobileBankFile(file));
  }); }
  function recover(more = false) { void run("Consultando importaciones guardadas…", async () => {
    const result = await getMobileBankJobs(more ? cursor : null);
    setJobs((old) => more ? [...old, ...result.jobs] : result.jobs); setCursor(result.nextCursor);
  }); }
  function confirm() {
    if (!preview || locked.current || !reviewLoaded) return;
    const selected = preview;
    Alert.alert("Confirmar incorporación", `Se incorporará la revisión ${selected.revision} de ${selected.sourceFile}. Las filas inválidas quedarán para revisión y los duplicados se omitirán. Esto no aplica pagos ni concilia facturas.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Incorporar", onPress: () => { void run("Incorporando movimientos…", async () => {
        const result = await confirmMobileBankImport(selected.jobId, selected.revision);
        setPreview(null); setRows([]); setReviewLoaded(false);
        setJobs((old) => old.filter((job) => job.id !== selected.jobId));
        Alert.alert("Importación confirmada", `${result.imported} movimientos incorporados; ${result.duplicateRows} duplicados omitidos; ${result.requiresReview} para revisión.`);
        await onImported();
      }); } }
    ]);
  }
  const button = (label: string, action: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" disabled={!!busy || disabled} onPress={action} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, opacity: busy || disabled ? 0.5 : 1 }}><Text style={{ color: theme.purple, fontWeight: "700" }}>{label}</Text></TouchableOpacity>;
  const blocked = preview?.duplicate?.blocked || preview?.periodProtection?.blocked || !preview?.account?.bankKey;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.muted }}>Carga segura con revisión en el servidor. Requiere internet. Máximo 12 MB y 5.000 movimientos por archivo; no se recortan filas.</Text>
    {button("Seleccionar cartola", pick)}
    {button("Recuperar importaciones guardadas", () => recover())}
    {!!busy && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}><ActivityIndicator color={theme.purple} /><Text style={{ color: theme.text }}>{busy} No repitas la acción.</Text></View>}
    {jobs.map((job) => <View key={job.id}>{button(`${job.sourceFile} · ${({ READY: "Lista para revisar", IMPORTED: "Importada", FAILED: "Con error", PROCESSING: "Procesando", CANCELLED: "Cancelada", RECEIVED: "Recibida" } as Record<string, string>)[job.status] || job.status}`, () => { void run("Recuperando revisión…", async () => { const result = await getMobileBankPreview(job.id); if (!result.preview || result.job.status !== "READY") throw new Error("La importación no está lista. Revísala en la web o vuelve a consultar su estado."); await show(result.preview); }); }, job.status !== "READY")}</View>)}
    {cursor && button("Ver más importaciones", () => recover(true))}
    {preview && <View style={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontWeight: "700" }}>{preview.sourceFile} · Revisión {preview.revision}</Text>
      <Text style={{ color: theme.text }}>{preview.summary.totalRows} filas · Abonos {preview.summary.credits} · Cargos {preview.summary.debits} · Por revisar {preview.summary.reviewRows}</Text>
      <Text style={{ color: theme.muted }}>{preview.account.bankKey ? `Banco: ${preview.account.bankKey}` : "Banco no identificado: completa la cuenta en la revisión web antes de importar."}</Text>
      {!!preview.duplicate?.blocked && <Text style={{ color: theme.text }}>{preview.duplicate.message}</Text>}
      {!!preview.periodProtection?.blocked && <Text style={{ color: theme.text }}>{preview.periodProtection.message}</Text>}
      {rows.map((row, index) => <View key={index} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.border }}><Text style={{ color: theme.text }}>{String(row.transactionDate || "Sin fecha")} · {String(row.description || "Sin descripción")}</Text><Text style={{ color: theme.muted }}>{row.direction === "CREDIT" ? "Abono" : row.direction === "DEBIT" ? "Cargo" : "Revisar tipo"} · {String(row.amount ?? "")} · {row.excluded ? "Excluida" : row.needsReview ? "Revisar" : row.duplicate ? "Duplicada" : "Válida"}</Text></View>)}
      <Text style={{ color: theme.muted }}>Página {page} de {pages}. Para corregir columnas o excluir filas, utiliza la revisión web.</Text>
      {button("Anterior", () => { void run("Cargando movimientos…", () => show(preview, page - 1)); }, page <= 1)}
      {button("Siguiente", () => { void run("Cargando movimientos…", () => show(preview, page + 1)); }, page >= pages)}
      {button("Confirmar incorporación", confirm, !!blocked || !reviewLoaded)}
    </View>}
  </View>;
}
