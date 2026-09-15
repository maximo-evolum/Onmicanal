import { useEffect, useRef, useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createMobileFinanceInvoice } from "../api/client";
import { InvoiceDraft, InvoiceFields, InvoiceScope, invoiceDraftRepository, invoicePayload, newInvoiceDraft } from "../finance-invoice-draft";

const repository = invoiceDraftRepository({ getItemAsync: SecureStore.getItemAsync, setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }) });
export function FinanceInvoiceForm({ scope, theme, onSaved }: { scope: InvoiceScope; theme: { text: string; muted: string; border: string; purple: string }; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const current = useRef<InvoiceDraft | null>(null);
  const mounted = useRef(true), submitting = useRef(false), change = useRef(0);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("Recuperando borrador…");
  useEffect(() => {
    mounted.current = true;
    repository.load(scope).then((value) => { if (mounted.current) { current.current = value; setDraft(value); setNotice(value.phase === "pending" ? "Hay una confirmación pendiente. Reintenta con los mismos datos para verificar el guardado." : "Borrador local cifrado. Solo se envía al pulsar Guardar."); } }).catch((error) => { if (mounted.current) setNotice(error.message); });
    return () => { mounted.current = false; };
  }, []);
  function edit(key: keyof InvoiceFields, value: string) {
    if (!current.current || submitting.current || current.current.phase === "pending") return;
    const next = { ...current.current, fields: { ...current.current.fields, [key]: value } };
    const revision = ++change.current;
    current.current = next; setDraft(next); setNotice("Guardando borrador en el teléfono…");
    repository.save(next).then(() => { if (mounted.current && revision === change.current) setNotice("Borrador guardado en este teléfono."); }).catch(() => { if (mounted.current && revision === change.current) setNotice("No se pudo guardar el borrador local. No cierres la app; revisa el espacio disponible."); });
  }
  async function save() {
    if (!current.current || submitting.current) return;
    submitting.current = true; setBusy(true); ++change.current;
    const selected = current.current;
    let sent = false;
    try {
      const payload = invoicePayload(selected);
      const pending: InvoiceDraft = { ...selected, phase: "pending" };
      // Persist exact payload identity BEFORE any network request.
      await repository.save(pending);
      current.current = pending; if (mounted.current) { setDraft(pending); setNotice("Confirmando con el servidor…"); }
      sent = true;
      await createMobileFinanceInvoice(payload);
      const fresh = newInvoiceDraft(scope);
      await repository.save(fresh);
      current.current = fresh;
      if (mounted.current) {
        setDraft(fresh); setNotice("Factura confirmada. Puedes crear un nuevo borrador.");
        Alert.alert("Factura registrada", "Registro interno confirmado; no emite un documento tributario al SII.");
        await onSaved();
      }
    } catch (error) {
      // Only definite validation rejection makes the original draft editable.
      const status = (error as { status?: number })?.status;
      if (sent && (status === 400 || status === 422)) {
        const editable: InvoiceDraft = { ...selected, phase: "editing" };
        try { await repository.save(editable); current.current = editable; if (mounted.current) setDraft(editable); } catch { /* keep persisted pending identity */ }
      }
      if (mounted.current) setNotice(`${error instanceof Error ? error.message : "No se pudo confirmar."} ${current.current?.phase === "pending" ? "Se conserva el intento. Pulsa Reintentar confirmación; no crees otra factura." : "El formulario se conserva para corregir o reintentar."}`);
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  function discard() {
    if (!draft || draft.phase === "pending" || busy) return;
    Alert.alert("Descartar borrador local", "Se eliminarán solo los datos de este formulario no enviado. No elimina facturas del servidor.", [{ text: "Cancelar", style: "cancel" }, { text: "Descartar", style: "destructive", onPress: () => {
      if (submitting.current || current.current?.phase === "pending") return;
      submitting.current = true; setBusy(true); ++change.current;
      const fresh = newInvoiceDraft(scope);
      repository.save(fresh).then(() => { current.current = fresh; if (mounted.current) { setDraft(fresh); setNotice("Borrador descartado."); } }).catch(() => { if (mounted.current) setNotice("No se pudo descartar. El borrador se conserva."); }).finally(() => { submitting.current = false; if (mounted.current) setBusy(false); });
    } }]);
  }
  return <View style={{ gap: 10 }}><Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>{notice}</Text>
    {draft && <>
      {([['number', 'Número de factura'], ['customer', 'Cliente o razón social'], ['rut', 'RUT (opcional)'], ['amount', 'Monto CLP sin separadores'], ['issueDate', 'Emisión: AAAA-MM-DD'], ['dueDate', 'Vence: AAAA-MM-DD']] as const).map(([key, label]) => <TextInput key={key} accessibilityLabel={label} placeholder={label} placeholderTextColor={theme.muted} maxLength={120} editable={!busy && draft.phase === "editing"} keyboardType={key === "amount" ? "numeric" : "default"} value={draft.fields[key]} onChangeText={(value) => edit(key, value)} style={{ color: theme.text, padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 12 }} />)}
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={save} style={{ padding: 12 }}><Text style={{ color: theme.purple }}>{busy ? "Guardando…" : draft.phase === "pending" ? "Reintentar confirmación" : "Guardar factura"}</Text></TouchableOpacity>
      {draft.phase === "editing" && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={discard} style={{ padding: 12 }}><Text style={{ color: theme.muted }}>Descartar borrador local</Text></TouchableOpacity>}
    </>}
  </View>;
}
