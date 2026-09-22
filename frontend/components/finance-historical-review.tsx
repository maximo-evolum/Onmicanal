"use client";
import { useEffect, useRef, useState } from "react";
import { getFinanceHistoricalReview, correctFinanceHistoricalRecord, type FinanceHistoricalReview, type FinanceHistoricalReviewRow } from "@/lib/api";
const labels: Record<string, string> = { issueDate: "Fecha de emisión original", dueDate: "Vencimiento (si consta en el original)", documentNumber: "Folio", partyName: "Cliente / proveedor", amount: "Monto original en CLP", balance: "Saldo pendiente según respaldo", paidAmount: "Pagos históricos acumulados", creditNotesTotal: "Notas de crédito vinculadas", debitNotesTotal: "Notas de débito vinculadas", currency: "Moneda confirmada", transactionDate: "Fecha original del movimiento", direction: "Abono / cargo", description: "Descripción original", reference: "Referencia / comprobante", bankKey: "Banco", accountAlias: "Alias identificable de la cuenta", accountLast4: "Últimos cuatro dígitos", accountType: "Tipo de cuenta" };
const amountFields = new Set(["amount", "balance", "paidAmount", "creditNotesTotal", "debitNotesTotal"]);
const docFields = ["issueDate", "dueDate", "documentNumber", "partyName", "amount", "balance", "paidAmount", "creditNotesTotal", "debitNotesTotal", "currency"];
const accountFields = ["bankKey", "accountAlias", "accountLast4", "accountType"];

export function FinanceHistoricalReviewPanel({ canManage, onChanged, onBusy }: { canManage: boolean; onChanged: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const [data, setData] = useState<FinanceHistoricalReview | null>(null), [page, setPage] = useState(1), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<FinanceHistoricalReviewRow | null>(null), [values, setValues] = useState<Record<string, string | number | null>>({});
  const [reason, setReason] = useState(""), [evidence, setEvidence] = useState(""), [confirmation, setConfirmation] = useState("");
  const generation = useRef(0), lock = useRef(false);
  async function load() {
    const seq = ++generation.current; setBusy(true); setError("");
    try { const next = await getFinanceHistoricalReview(page, query); if (seq === generation.current) setData(next); }
    catch (e) { if (seq === generation.current) { setError(e instanceof Error ? e.message : "No se pudo cargar la revisión."); setData(null); } }
    finally { if (seq === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [page]);
  function edit(row: FinanceHistoricalReviewRow) { setSelected(row); setValues({ ...row.values }); setReason(""); setEvidence(""); setConfirmation(""); setError(""); setNotice(""); }
  async function save() {
    if (!selected || lock.current || !canManage || confirmation !== "CORREGIR") return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const keys = selected.target === "bank_statement" ? accountFields : selected.target === "bank_movement" ? ["transactionDate", "amount", "direction", "description", "reference", "currency", ...accountFields] : docFields;
      const patch = Object.fromEntries(keys.map((k) => [k, values[k] ?? ""]));
      const result = await correctFinanceHistoricalRecord(selected.id, { version: selected.version, patch, reason, evidence, confirmation: "CORREGIR" });
      setSelected(null); setNotice(`Corrección registrada (${result.correctionId}). Se conserva el original. Si quedan datos desconocidos, el registro seguirá visible para revisión. No se realizó ningún cobro ni conciliación automática.`);
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo corregir."); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  const keys = selected?.target === "bank_statement" ? accountFields : selected?.target === "bank_movement" ? ["transactionDate", "amount", "direction", "description", "reference", "currency", ...accountFields] : docFields;
  return <article className="finance-card finance-historical-review">
    <h2>Registros históricos por completar</h2>
    <p>{data?.scope || "Revisión de toda la empresa, incluyendo registros que no aparecen en un mes por falta de fecha."}</p>
    <p>No adivines fechas, saldos ni pagos. Corrige sólo con un respaldo. Los registros con vínculos financieros activos requieren regularizarlos primero; los períodos cerrados permanecen protegidos.</p>
    <div className="finance-review-toolbar"><label>Buscar folio, registro o archivo<input value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => { setSelected(null); if (page !== 1) setPage(1); else void load(); }}>Buscar / actualizar</button><span>{data?.total ?? 0} por revisar</span></div>
    {busy ? <p role="status">Procesando revisión histórica…</p> : null}{error ? <p className="finance-note" role="alert">{error}</p> : null}{notice ? <p className="finance-note" role="status">{notice}</p> : null}
    {data?.records.map((row) => <section key={row.id} className="finance-coverage-source">
      <h3>{row.title}</h3><p>{row.source.file || "Sin archivo de origen identificado"}{row.source.row ? ` · fila ${row.source.row}` : ""} · {row.target === "bank_movement" ? "Movimiento bancario" : row.target === "bank_statement" ? "Cartola" : row.target === "finance_payable" ? "Documento de proveedor" : "Documento de cliente"}</p>
      <ul>{row.issues.map((i, n) => <li key={`${i.code}-${n}`}>{i.label}{!i.blocking ? " (no bloquea el cierre por sí solo)" : ""}</li>)}</ul>
      {row.lastReview ? <p>Última corrección: {new Date(row.lastReview.at).toLocaleString("es-CL")} · {row.lastReview.reason} · Respaldo: {row.lastReview.evidence}</p> : null}
      {canManage && selected?.id !== row.id ? <button type="button" disabled={busy} className="secondary-btn" onClick={() => edit(row)}>Completar con respaldo</button> : null}
      {selected?.id === row.id ? <div className="finance-coverage-fields">
        {keys.map((key) => <label key={key}>{labels[key]}{key === "bankKey" ? <select disabled={busy} value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })}><option value="">Selecciona el banco</option>{data.banks.map((b) => <option value={b.key} key={b.key}>{b.name}</option>)}</select> : key === "direction" || key === "currency" ? <select disabled={busy} value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })}><option value="">Por confirmar con el original</option>{key === "currency" ? <option value="CLP">CLP · Pesos chilenos</option> : <><option value="CREDIT">Abono</option><option value="DEBIT">Cargo</option></>}</select> : <input type={key.endsWith("Date") ? "date" : amountFields.has(key) ? "number" : "text"} min={amountFields.has(key) ? 0 : undefined} step={amountFields.has(key) ? 1 : undefined} value={values[key] ?? ""} disabled={busy} maxLength={key === "accountLast4" ? 4 : 500} onChange={(e) => setValues({ ...values, [key]: amountFields.has(key) && e.target.value !== "" ? Number(e.target.value) : e.target.value })} />}</label>)}
        <label className="finance-coverage-evidence">Motivo de la corrección<textarea value={reason} minLength={10} maxLength={1500} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="finance-coverage-evidence">Referencia del documento, cartola o evidencia<textarea value={evidence} minLength={10} maxLength={1500} disabled={busy} onChange={(e) => setEvidence(e.target.value)} /></label>
        <label>Escribe CORREGIR<input value={confirmation} autoComplete="off" disabled={busy} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <div><button type="button" className="primary-btn" disabled={busy || confirmation !== "CORREGIR" || reason.trim().length < 10 || evidence.trim().length < 10} onClick={() => void save()}>Guardar corrección auditada</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button></div>
      </div> : null}
    </section>)}
    {!busy && data?.total === 0 ? <p>No hay registros incompletos detectados en los módulos a los que tienes acceso. Esto no acredita cobertura de fuentes externas.</p> : null}
    <div className="finance-review-toolbar"><button type="button" disabled={busy || page <= 1} onClick={() => { setSelected(null); setPage(page - 1); }}>Anterior</button><span>Página {page} de {data?.pages || 1}</span><button type="button" disabled={busy || !data || page >= data.pages} onClick={() => { setSelected(null); setPage(page + 1); }}>Siguiente</button></div>
  </article>;
}
