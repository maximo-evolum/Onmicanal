"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { reviewFinanceMovementBatch, getFinanceMovementLedger, exportFinanceMovementLedger, type FinanceLedger, type FinanceWorkspaceContext } from "@/lib/api";
import styles from "./finance-movement-ledger.module.css";
import { FinanceMovementTracePanel } from "./finance-movement-trace";
import { FinanceMovementOwnerEditor } from "./finance-movement-owner";
import { getFinanceMovementOwners, type FinanceMovementOwner } from "@/lib/api";
import { ledgerDefaults, ledgerColumns, defaultColumns, ledgerPreferenceKey, readLedgerPreferences, normalizeLedgerFilters, type LedgerColumn, type LedgerPreferences } from "@/lib/finance-ledger-preferences";
const initial = ledgerDefaults;
const labels: Record<string, string> = { CREDIT: "Abono", DEBIT: "Cargo", UNKNOWN: "Por identificar", MATCHED: "Conciliado", PENDING: "Pendiente", REVIEW: "En revisión", EXCLUDED: "Excluido", OTHER: "Otro estado" };
export function FinanceMovementLedger({ context, tenantId, userId, canManage }: { context: FinanceWorkspaceContext; tenantId: string; userId: string; canManage: boolean }) {
  const [owners, setOwners] = useState<FinanceMovementOwner[]>([]), [ownerMessage, setOwnerMessage] = useState("");
  useEffect(() => { let active = true; setOwners([]); getFinanceMovementOwners().then((r) => { if (active) setOwners(r.users); }).catch(() => { if (active) setOwnerMessage("No se pudo consultar el personal. Actualiza la página antes de asignar."); }); return () => { active = false; }; }, [tenantId, userId]);
  const [preferences, setPreferences] = useState<LedgerPreferences>({ version: 1, columns: [...defaultColumns], saved: [] });
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [ready, setReady] = useState(false), [presetName, setPresetName] = useState("");
  useEffect(() => {
    try { setPreferences(readLedgerPreferences(localStorage.getItem(ledgerPreferenceKey(tenantId, userId)))); }
    catch (e) { setPreferenceMessage(e instanceof Error ? e.message : "No se pudieron recuperar las preferencias."); }
    setReady(true);
  }, [tenantId, userId]);
  function persist(next: LedgerPreferences) {
    try { localStorage.setItem(ledgerPreferenceKey(tenantId, userId), JSON.stringify(next)); setPreferences(next); setPreferenceMessage("Preferencias guardadas para esta cuenta en este navegador."); }
    catch { setPreferenceMessage("No se pudieron guardar las preferencias. Revisa el almacenamiento del navegador."); }
  }
  function saveFilter() {
    const name = presetName.trim(); if (!name) { setPreferenceMessage("Escribe un nombre para el filtro."); return; }
    const exists = preferences.saved.some((item) => item.name === name);
    if (exists && !window.confirm(`¿Reemplazar el filtro «${name}»?`)) return;
    if (!exists && preferences.saved.length >= 20) { setPreferenceMessage("Puedes guardar hasta 20 filtros. Elimina uno antes de agregar otro."); return; }
    persist({ ...preferences, saved: [...preferences.saved.filter((item) => item.name !== name), { name, filters: normalizeLedgerFilters(filters) }] });
  }
  const [form, setForm] = useState(initial), [filters, setFilters] = useState(initial), [page, setPage] = useState(1);
  const [data, setData] = useState<FinanceLedger | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null), [exporting, setExporting] = useState(false), [refresh, setRefresh] = useState(0);
  const exportingRef = useRef(false);
  const [selected, setSelected] = useState<Array<{ id: string; version: string }>>([]), [reason, setReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false), [bulkResults, setBulkResults] = useState<Array<{ id: string; status: string; message: string }>>([]);
  const bulkLock = useRef(false), batch = useRef({ signature: "", key: "" });
  useEffect(() => { setSelected([]); }, [filters]);
  async function reviewSelected() {
    if (bulkLock.current || !canManage || !selected.length || reason.trim().length < 10) return;
    if (!window.confirm(`¿Enviar ${selected.length} movimientos a revisión? Cada uno se valida por separado; puede haber resultados parciales. No se conciliarán ni eliminarán.`)) return;
    bulkLock.current = true; setBulkBusy(true); setError(""); setBulkResults([]);
    const signature = JSON.stringify({ selected, reason: reason.trim() });
    if (batch.current.signature !== signature) batch.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await reviewFinanceMovementBatch({ items: selected, reason: reason.trim(), operationKey: batch.current.key });
      setBulkResults(result.results);
      if (!result.results.some((r) => r.status === "UNKNOWN")) setSelected([]);
      setRefresh((n) => n + 1);
    } catch (e) { setError(`${e instanceof Error ? e.message : "Sin confirmación del servidor."} Reintenta sin cambiar selección ni motivo para conservar el identificador del lote.`); }
    finally { bulkLock.current = false; setBulkBusy(false); }
  }
  useEffect(() => {
    let active = true; setBusy(true); setData(null); setError(""); setExpanded(null);
    getFinanceMovementLedger({ ...context, ...filters, page: String(page) }).then((result) => { if (active) setData(result); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [context.period, context.accountKey, context.currency, filters, page, refresh]);
  const money = (amount: number | null) => amount === null ? "Sin monto válido" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: context.currency === "CLP" ? 0 : 4 }).format(amount) + ` ${context.currency}`;
  async function download(format: "csv" | "xlsx" = "csv") {
    if (exportingRef.current) return; exportingRef.current = true; setExporting(true); setError("");
    try { const blob = await exportFinanceMovementLedger({ ...context, ...filters }, format); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `movimientos-financieros.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo exportar."); }
    finally { exportingRef.current = false; setExporting(false); }
  }
  return <section className={styles.workspace} aria-label="Consulta completa de movimientos">
    <h3>Consultar movimientos</h3><p>Los filtros se combinan con la empresa, período y cuenta seleccionados arriba. Los totales corresponden a todos los resultados filtrados, no solo a esta página; no representan el saldo de la cuenta.</p>
    <details><summary>Mis filtros y columnas</summary><p>Se guardan solo en este navegador, separados por empresa y usuario. No cambian el período ni la cuenta bancaria activos. La búsqueda puede contener datos personales; evita guardarla en equipos compartidos.</p>
      {preferenceMessage && <p role="status">{preferenceMessage}</p>}
      <div className={styles.toolbar}><label>Nombre del filtro<input maxLength={60} value={presetName} onChange={(e) => setPresetName(e.target.value)} /></label><button type="button" disabled={!ready || busy} onClick={saveFilter}>Guardar filtros aplicados</button></div>
      <div className={styles.toolbar}>{preferences.saved.map((item, index) => <span key={`${item.name}:${index}`}><button type="button" disabled={busy || bulkBusy} onClick={() => { setForm({ ...item.filters }); setFilters({ ...item.filters }); setPage(1); setPresetName(item.name); }}>{item.name}</button><button type="button" aria-label={`Eliminar filtro ${item.name}`} onClick={() => { if (window.confirm(`¿Eliminar el filtro «${item.name}»? No elimina movimientos.`)) persist({ ...preferences, saved: preferences.saved.filter((_, i) => i !== index) }); }}>Eliminar</button></span>)}</div>
      <fieldset><legend>Columnas visibles (al menos una)</legend><div className={styles.toolbar}>{(Object.keys(ledgerColumns) as LedgerColumn[]).map((key) => <label key={key}><input type="checkbox" checked={preferences.columns.includes(key)} disabled={!ready || preferences.columns.length === 1 && preferences.columns.includes(key)} onChange={(e) => persist({ ...preferences, columns: e.target.checked ? [...preferences.columns, key] : preferences.columns.filter((c) => c !== key) })} /> {ledgerColumns[key]}</label>)}</div></fieldset>
      <button type="button" disabled={!ready} onClick={() => { if (window.confirm("¿Restaurar columnas y borrar filtros guardados de esta cuenta en este navegador?")) persist({ version: 1, columns: [...defaultColumns], saved: [] }); }}>Restaurar preferencias</button>
      <p>La columna Acción permanece visible. El CSV conserva todas las columnas, aunque estén ocultas en pantalla.</p>
    </details>
    <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setFilters({ ...form }); setPage(1); }}>
      <label>Buscar descripción, RUT, referencia o cartola<input value={form.search} maxLength={200} onChange={(e) => setForm({ ...form, search: e.target.value })} /></label>
      <label>Responsable<select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}><option value="">Todos</option><option value="NONE">Sin responsable</option><option value="ASSIGNED">Con responsable</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}{u.isActive ? "" : " (inactivo)"}</option>)}</select></label>
      <label>Vista de fechas<select value={form.dateScope} onChange={(e) => setForm(normalizeLedgerFilters({ ...form, dateScope: e.target.value }))}><option value="PERIOD">Con fecha válida / período activo</option><option value="UNDATED">Sin fecha válida / cualquier período</option></select></label>
      <div><label>Revisión de cartola importada<input type="number" min="0" step="1" disabled={form.importRevision === "UNKNOWN"} value={form.importRevision === "UNKNOWN" ? "" : form.importRevision} placeholder="Todas las revisiones" onChange={(e) => setForm({ ...form, importRevision: e.target.value })} /></label><label><input type="checkbox" checked={form.importRevision === "UNKNOWN"} onChange={(e) => setForm({ ...form, importRevision: e.target.checked ? "UNKNOWN" : "" })} /> Solo sin versión registrada</label></div>
      <label>Puntaje de conciliación vigente<select value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })}><option value="ALL">Todos</option><option value="HIGH">Alto: 95 a 100</option><option value="MEDIUM">Medio: 80 a menos de 95</option><option value="LOW">Bajo: menos de 80</option><option value="UNKNOWN">Sin puntaje vigente</option></select></label>
      {([['from', 'Desde', 'date'], ['to', 'Hasta', 'date'], ['min', 'Monto mínimo', 'number'], ['max', 'Monto máximo', 'number']] as const).map(([key, label, type]) => <label key={key}>{label}<input type={type} disabled={type === 'date' && form.dateScope === 'UNDATED'} min={type === 'number' ? '0' : undefined} step="any" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label>Tipo<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="ALL">Todos</option>{['CREDIT', 'DEBIT', 'UNKNOWN'].map((v) => <option key={v} value={v}>{labels[v]}</option>)}</select></label>
      <label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ALL">Todos</option>{['MATCHED', 'PENDING', 'REVIEW', 'EXCLUDED', 'OTHER'].map((v) => <option key={v} value={v}>{labels[v]}</option>)}</select></label>
      <label>Orden<select value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })}><option value="date_desc">Más recientes</option><option value="date_asc">Más antiguos</option><option value="amount_desc">Mayor monto</option><option value="amount_asc">Menor monto</option></select></label>
      <label>Filas por página<select value={form.pageSize} onChange={(e) => setForm({ ...form, pageSize: e.target.value })}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button type="submit" disabled={busy || bulkBusy}>Aplicar filtros</button><button type="button" disabled={busy || bulkBusy} onClick={() => { setForm(initial); setFilters({ ...initial }); setPage(1); }}>Limpiar filtros</button>
    </form>
    <div className={styles.toolbar}><button type="button" disabled={busy || bulkBusy} onClick={() => setRefresh((n) => n + 1)}>Actualizar</button><button type="button" disabled={busy || exporting || !data} onClick={() => void download()}>{exporting ? "Exportando…" : "Exportar todos los resultados CSV"}</button><button type="button" disabled={busy || bulkBusy || exporting || !data} onClick={() => void download("xlsx")}>{exporting ? "Exportando…" : "Exportar todos los resultados Excel"}</button></div>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Consultando movimientos completos…</p>}
    {ownerMessage && <p role="status">{ownerMessage}</p>}
    {data && <p role="status">{data.scopeNotice}</p>}
    <p>La revisión corresponde a la cartola incorporada, no al número de cambios del movimiento. El puntaje procede de la conciliación aprobada vigente: no es una probabilidad ni una sugerencia actual. Una reversa deja de aportar ese puntaje.</p>
    {data && !data.reconciliationAccess && <p>Tu cuenta no tiene acceso a los puntajes de conciliación. Puedes consultar los movimientos sin aplicar ese filtro.</p>}
    {data && data.undatedAvailable > 0 && data.dateScope !== "UNDATED" && <aside><p>Hay {data.undatedAvailable} movimiento(s) sin fecha válida en esta cuenta y moneda, fuera del listado por período. El contador no aplica los filtros adicionales.</p><button type="button" disabled={busy || bulkBusy} onClick={() => { const next = { ...initial, dateScope: "UNDATED" }; setForm(next); setFilters(next); setPage(1); }}>Revisar movimientos sin fecha</button></aside>}
    {canManage && <fieldset disabled={bulkBusy}><legend>Revisión de movimientos seleccionados</legend><p>{selected.length} seleccionados de un máximo de 25. La selección puede abarcar varias páginas y se limpia al aplicar filtros.</p><label>Motivo<textarea maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explica qué debe revisar el responsable (mínimo 10 caracteres)" /></label><div className={styles.toolbar}><button type="button" disabled={busy || !selected.length || reason.trim().length < 10} onClick={() => void reviewSelected()}>Enviar seleccionados a revisión</button><button type="button" onClick={() => setSelected([])}>Limpiar selección</button></div></fieldset>}
    {bulkBusy && <p role="status">Procesando lote… No repitas la acción.</p>}
    {!!bulkResults.length && <details open><summary>Resultado individual del lote</summary><ul>{bulkResults.map((r) => <li key={r.id}>{r.id}: {r.message}</li>)}</ul></details>}
    {data && <><div className={styles.summary}><strong>{data.total} movimientos</strong><span>Abonos: {money(data.summary.credits)}</span><span>Cargos: {money(data.summary.debits)}</span><span>Sin clasificar o monto inválido: {data.summary.unclassified}</span></div>
      <div className={styles.table}><table><thead><tr>{preferences.columns.map((key) => <th key={key}>{ledgerColumns[key]}</th>)}<th>Acción</th></tr></thead><tbody>{data.records.map((r) => <Fragment key={r.id}><tr>{preferences.columns.map((key) => <td key={key} className={key === "amount" ? styles.amount : undefined}>{key === "amount" ? money(r.amount) : key === "direction" || key === "status" ? labels[r[key]] : key === "description" ? <>{r.description}<small>{[r.payer, r.rut, r.reference].filter(Boolean).join(" · ")}</small></> : r[key] || "No registrado"}</td>)}<td>{canManage && <label><input type="checkbox" aria-label={`Seleccionar ${r.description}`} checked={selected.some((item) => item.id === r.id)} disabled={bulkBusy || !r.version || r.status !== "PENDING" || selected.length >= 25 && !selected.some((item) => item.id === r.id)} onChange={(e) => setSelected((items) => e.target.checked ? [...items, { id: r.id, version: r.version }] : items.filter((item) => item.id !== r.id))} /> Seleccionar</label>}<button type="button" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? "Cerrar detalle" : "Ver detalle"}</button></td></tr>{expanded === r.id && <tr><td colSpan={preferences.columns.length + 1}><dl className={styles.detail}>{Object.entries({ Responsable: r.assignedToId ? owners.find((u) => u.id === r.assignedToId)?.name || "Responsable no disponible" : "Sin responsable", Banco: r.bank, Cuenta: r.account, "Últimos 4 dígitos": r.last4, Cartola: r.sourceFile, "Fila de origen": r.sourceRow, Hoja: r.sourceSheet, "Identificador del movimiento": r.id, "Lote de importación": r.batchId, "Conciliación asociada": r.reconciliationId, "Motivos de revisión": r.reasons.join("; ") }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "No registrado"}</dd></div>)}</dl><>{canManage && <FinanceMovementOwnerEditor key={`${r.id}:${r.version}`} movementId={r.id} version={r.version} assignedToId={r.assignedToId} users={owners} onSaved={() => { setOwnerMessage("Responsable actualizado. El cambio quedó registrado en el historial."); setSelected([]); setRefresh((n) => n + 1); }} />}</><FinanceMovementTracePanel key={r.id} movementId={r.id} /></td></tr>}</Fragment>)}</tbody></table></div>
      {!data.total && <p>No hay movimientos con estos filtros. No implica que la cuenta no haya tenido actividad.</p>}
      <div className={styles.toolbar}><button type="button" disabled={busy || data.page <= 1} onClick={() => setPage(data.page - 1)}>Anterior</button><span>Página {data.page} de {data.pages} · {data.total} resultados</span><button type="button" disabled={busy || data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Siguiente</button></div>
    </>}
  </section>;
}
