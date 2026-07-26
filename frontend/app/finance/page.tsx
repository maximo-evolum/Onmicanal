"use client";

import { ChangeEvent, FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  analyzeFinanceAgents,
  approveFinanceReconciliation,
  createIndustryRecord,
  generateFinanceCollectionCases,
  getFinanceAgentWorkspace,
  getFinanceOverview,
  getFinanceReconciliationSuggestions,
  getIndustryRecords,
  type FinanceOverview,
  type FinanceAgentPolicy,
  type FinanceAgentWorkspace,
  type FinanceReconciliationSuggestion,
  type IndustryRecord,
  updateFinanceAgentPolicy
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { ModuleAccessKey } from "@/lib/module-access";

type FinanceTab = "resumen" | "facturas" | "cartolas" | "conciliacion" | "excepciones" | "cobranza" | "agentes";

const tabs: Array<{ key: FinanceTab; label: string; module: ModuleAccessKey; detail: string }> = [
  { key: "resumen", label: "Resumen", module: "finance_analytics", detail: "Cartera, flujo esperado y estado de la operacion." },
  { key: "facturas", label: "Facturas", module: "finance_invoices", detail: "Registra documentos pendientes de cobro." },
  { key: "cartolas", label: "Cartolas", module: "finance_bank_sync", detail: "Importa movimientos bancarios para conciliarlos." },
  { key: "conciliacion", label: "Conciliacion IA", module: "finance_reconciliation", detail: "Revisa sugerencias antes de confirmar cambios." },
  { key: "excepciones", label: "Excepciones", module: "finance_exceptions", detail: "Ordena diferencias y casos que requieren revision." },
  { key: "cobranza", label: "Cobranza IA", module: "finance_collections", detail: "Prepara la cartera vencida para un seguimiento aprobado." },
  { key: "agentes", label: "Equipo IA", module: "finance_analytics", detail: "Cinco agentes especializados coordinados con controles humanos." }
];

function resolveFinanceTab(value: string | null): FinanceTab {
  return tabs.some((tab) => tab.key === value) ? value as FinanceTab : "resumen";
}

function asData(record: IndustryRecord) {
  return (record.data || {}) as Record<string, unknown>;
}

function text(value: unknown, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function amount(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount(value));
}

function shortDate(value: unknown) {
  if (!value) return "Sin fecha";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function parseDelimitedRows(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const headers = lines[0].split(delimiter).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  }).filter((row) => Object.values(row).some(Boolean));
}

export default function FinancePage() {
  return <Suspense fallback={<div className="module-access-state">Cargando Finance OS...</div>}><FinanceWorkspace /></Suspense>;
}

function FinanceWorkspace() {
  const params = useSearchParams();
  const [activeTab, setActiveTab] = useState<FinanceTab>(() => resolveFinanceTab(params.get("tab")));
  const active = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [suggestions, setSuggestions] = useState<FinanceReconciliationSuggestion[]>([]);
  const [agentWorkspace, setAgentWorkspace] = useState<FinanceAgentWorkspace | null>(null);
  const [agentPolicy, setAgentPolicy] = useState<FinanceAgentPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ number: "", client: "", rut: "", amount: "", dueDate: "" });
  const [movementForm, setMovementForm] = useState({ date: "", amount: "", description: "", reference: "" });
  const [exceptionForm, setExceptionForm] = useState({ title: "", type: "Diferencia de monto", detail: "" });

  useEffect(() => {
    function syncBrowserNavigation() {
      setActiveTab(resolveFinanceTab(new URLSearchParams(window.location.search).get("tab")));
    }

    window.addEventListener("popstate", syncBrowserNavigation);
    return () => window.removeEventListener("popstate", syncBrowserNavigation);
  }, []);

  function selectTab(tab: FinanceTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    window.history.pushState({}, "", tab === "resumen" ? "/finance" : `/finance?tab=${tab}`);
  }

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      if (activeTab === "resumen") setOverview(await getFinanceOverview());
      if (activeTab === "facturas") setRecords(await getIndustryRecords("finance_invoice"));
      if (activeTab === "cartolas") setRecords(await getIndustryRecords("bank_movement"));
      if (activeTab === "excepciones") setRecords(await getIndustryRecords("finance_exception"));
      if (activeTab === "cobranza") setRecords(await getIndustryRecords("finance_collection_case"));
      if (activeTab === "conciliacion") setSuggestions((await getFinanceReconciliationSuggestions()).suggestions);
      if (activeTab === "agentes") {
        const workspace = await getFinanceAgentWorkspace();
        setAgentWorkspace(workspace);
        setAgentPolicy(workspace.policy);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los datos financieros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [activeTab]);

  const headline = useMemo(() => {
    if (!overview) return null;
    return [
      { label: "Por cobrar", value: money(overview.invoices.pendingAmount), help: `${overview.invoices.pending} facturas abiertas` },
      { label: "Vencido", value: money(overview.invoices.overdueAmount), help: `${overview.invoices.overdue} facturas vencidas` },
      { label: "Conciliado", value: `${overview.reconciliation.rate}%`, help: `${overview.reconciliation.matchedMovements} movimientos confirmados` },
      { label: "DSO estimado", value: `${overview.collection.dsoDays} dias`, help: "Promedio de cobro de la cartera pagada" }
    ];
  }, [overview]);
  const notificationCount = (overview?.exceptions.open || 0) + (overview?.invoices.overdue || 0);

  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    if (!invoiceForm.number || !invoiceForm.client || !invoiceForm.amount || !invoiceForm.dueDate) return setMessage("Completa numero, cliente, monto y vencimiento de la factura.");
    setSaving(true);
    try {
      await createIndustryRecord({
        recordType: "finance_invoice",
        title: `Factura ${invoiceForm.number} - ${invoiceForm.client}`,
        status: "OPEN",
        data: { invoiceNumber: invoiceForm.number, clientName: invoiceForm.client, clientRut: invoiceForm.rut, issueDate: new Date().toISOString().slice(0, 10), dueDate: invoiceForm.dueDate, amount: amount(invoiceForm.amount), balance: amount(invoiceForm.amount), currency: "CLP" }
      });
      setInvoiceForm({ number: "", client: "", rut: "", amount: "", dueDate: "" });
      setMessage("Factura registrada. Ya puede entrar al flujo de conciliacion y cobranza.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la factura."); }
    finally { setSaving(false); }
  }

  async function createMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementForm.date || !movementForm.amount) return setMessage("Completa fecha y monto del movimiento.");
    setSaving(true);
    try {
      await createIndustryRecord({
        recordType: "bank_movement",
        title: `${movementForm.date} - ${movementForm.description || "Movimiento bancario"}`,
        status: "PENDING",
        data: { date: movementForm.date, transactionDate: movementForm.date, amount: amount(movementForm.amount), description: movementForm.description, reference: movementForm.reference, source: "manual" }
      });
      setMovementForm({ date: "", amount: "", description: "", reference: "" });
      setMessage("Movimiento listo para conciliacion.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el movimiento."); }
    finally { setSaving(false); }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setMessage("Esta primera version importa cartolas CSV. Los PDF y Excel se guardan en Archivos para su procesamiento posterior.");
    setSaving(true);
    try {
      const rows = parseDelimitedRows(await file.text());
      if (!rows.length) throw new Error("No se detectaron movimientos en el archivo CSV.");
      await Promise.all(rows.slice(0, 500).map((row, index) => {
        const date = row.fecha || row.date || row.fecha_movimiento || "";
        const rawAmount = row.monto || row.amount || row.abono || row.credito || "0";
        const description = row.descripcion || row.description || row.glosa || row.detalle || "Movimiento importado";
        const reference = row.referencia || row.reference || row.comprobante || "";
        return createIndustryRecord({ recordType: "bank_movement", title: `${date || "Sin fecha"} - ${description}`, status: "PENDING", data: { date, transactionDate: date, amount: amount(String(rawAmount).replace(/\./g, "").replace(",", ".")), description, reference, source: "csv", sourceFile: file.name, importRow: index + 2 } });
      }));
      setMessage(`${Math.min(rows.length, 500)} movimientos importados. Revisa la conciliacion sugerida.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo importar la cartola."); }
    finally { setSaving(false); }
  }

  async function approveSuggestion(suggestion: FinanceReconciliationSuggestion) {
    setSaving(true);
    try {
      await approveFinanceReconciliation(suggestion.movement.id, suggestion.invoice.id);
      setMessage("Conciliacion confirmada y factura actualizada.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo confirmar la conciliacion."); }
    finally { setSaving(false); }
  }

  async function createException(event: FormEvent) {
    event.preventDefault();
    if (!exceptionForm.title) return setMessage("Describe la excepcion para crear el caso.");
    setSaving(true);
    try {
      await createIndustryRecord({ recordType: "finance_exception", title: exceptionForm.title, status: "OPEN", data: { type: exceptionForm.type, detail: exceptionForm.detail, priority: "MEDIUM" } });
      setExceptionForm({ title: "", type: "Diferencia de monto", detail: "" });
      setMessage("Excepcion creada para revision humana.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear la excepcion."); }
    finally { setSaving(false); }
  }

  async function generateCollections() {
    setSaving(true);
    try {
      const result = await generateFinanceCollectionCases();
      setMessage(result.created ? `${result.created} casos de cobranza listos para revisar.` : "No hay nuevas facturas vencidas sin caso de cobranza.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron generar los casos."); }
    finally { setSaving(false); }
  }

  async function saveAgentPolicy() {
    if (!agentPolicy) return;
    setSaving(true);
    try {
      const result = await updateFinanceAgentPolicy(agentPolicy);
      setAgentPolicy(result.policy);
      setMessage("Politica del equipo IA actualizada. Los cambios financieros siguen requiriendo aprobacion humana.");
      const workspace = await getFinanceAgentWorkspace();
      setAgentWorkspace(workspace);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la politica de agentes."); }
    finally { setSaving(false); }
  }

  async function analyzeAgents() {
    setSaving(true);
    try {
      const result = await analyzeFinanceAgents();
      setAgentWorkspace(result.workspace);
      setAgentPolicy(result.workspace.policy);
      setMessage(result.exceptionsPrepared ? `${result.exceptionsPrepared} excepciones fueron preparadas para revision.` : result.exceptionsSkipped ? "Analisis completado. La preparacion automatica de excepciones esta desactivada." : "Analisis completado sin nuevas excepciones.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo ejecutar el analisis de agentes."); }
    finally { setSaving(false); }
  }

  return (
    <ModuleGate moduleKey="finance_analytics">
      <div className={`module-with-menu-shell finance-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active={activeTab === "resumen" ? "Finanzas" : active.label} isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="finance-workspace">
          <header className="finance-header">
            <div className="finance-title"><span>EVOLUM FINANZAS</span><h1>{activeTab === "resumen" ? `Hola, ${agent?.name?.split(" ")[0] || "equipo"}` : active.label}</h1><p>{activeTab === "resumen" ? "Esto es lo que necesita tu atencion financiera hoy." : active.detail}</p></div>
            <div className="finance-header-actions"><label className="finance-search"><span className="finance-search-label">Buscar</span><input aria-label="Buscar en Finance OS" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, factura o movimiento" /></label><div className="finance-notification-wrap"><button className="finance-bell" type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-label={notificationCount ? `Ver ${notificationCount} notificaciones` : "Ver notificaciones"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{notificationCount ? <span>{notificationCount > 9 ? "9+" : notificationCount}</span> : null}</button>{notificationsOpen ? <div className="finance-notification-panel"><strong>Notificaciones</strong>{overview?.invoices.overdue ? <span>{overview.invoices.overdue} facturas vencidas requieren atencion.</span> : null}{overview?.exceptions.open ? <span>{overview.exceptions.open} excepciones estan pendientes de revision.</span> : null}{!overview?.invoices.overdue && !overview?.exceptions.open ? <span>No hay alertas financieras nuevas.</span> : null}</div> : null}</div><AccountPill fallbackName={agent?.name || "Usuario"} /></div>
          </header>
          <nav className="finance-tabs" aria-label="Secciones de Finance OS">{tabs.map((tab) => <a key={tab.key} href={tab.key === "resumen" ? "/finance" : `/finance?tab=${tab.key}`} className={tab.key === activeTab ? "active" : ""} aria-current={tab.key === activeTab ? "page" : undefined} onClick={(event) => { event.preventDefault(); selectTab(tab.key); }}>{tab.label}</a>)}</nav>
          {message ? <div className="finance-message">{message}</div> : null}
          {loading ? <div className="finance-loading">Actualizando informacion financiera...</div> : null}

          {activeTab === "resumen" && overview ? <>
            <section className="finance-kpis">{headline?.map((item) => <article key={item.label}><small>{item.label}</small><strong>{item.value}</strong><span>{item.help}</span></article>)}</section>
            <section className="finance-grid">
              <article className="finance-card"><h2>Cartera por antiguedad</h2>{overview.aging.map((bucket) => <div className="finance-aging" key={bucket.label}><span>{bucket.label}</span><i><b style={{ width: `${Math.min(100, overview.invoices.pendingAmount ? (bucket.amount / overview.invoices.pendingAmount) * 100 : 0)}%` }} /></i><strong>{money(bucket.amount)}</strong></div>)}</article>
              <article className="finance-card"><h2>Estado de integraciones</h2>{overview.integrationReadiness.map((item) => <div className="finance-readiness" key={item.key}><b className={item.status}>{item.status === "ready" ? "Listo" : item.status === "manual" ? "Manual" : "Requiere config."}</b><div><strong>{item.label}</strong><span>{item.note}</span></div></div>)}</article>
            </section>
          </> : null}

          {activeTab === "facturas" ? <section className="finance-grid"><form className="finance-card finance-form" onSubmit={createInvoice}><h2>Nueva factura por cobrar</h2><input required placeholder="Numero de factura" value={invoiceForm.number} onChange={(event) => setInvoiceForm({ ...invoiceForm, number: event.target.value })} /><input required placeholder="Cliente o empresa" value={invoiceForm.client} onChange={(event) => setInvoiceForm({ ...invoiceForm, client: event.target.value })} /><input placeholder="RUT cliente (opcional)" value={invoiceForm.rut} onChange={(event) => setInvoiceForm({ ...invoiceForm, rut: event.target.value })} /><input required type="number" placeholder="Monto CLP" value={invoiceForm.amount} onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })} /><label>Vencimiento<input required type="date" value={invoiceForm.dueDate} onChange={(event) => setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })} /></label><button className="primary-btn" disabled={saving}>Guardar factura</button></form><article className="finance-card"><h2>Facturas registradas</h2><FinanceTable records={records} kind="invoice" query={search} /></article></section> : null}

          {activeTab === "cartolas" ? <section className="finance-grid"><article className="finance-card finance-form"><h2>Importar cartola</h2><p>CSV queda listo para conciliacion. PDF y Excel pueden guardarse en Archivos mientras se activa el parser de la integracion contratada.</p><label className="finance-upload">Seleccionar cartola CSV<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={saving} /></label><hr /><h3>Registrar movimiento manual</h3><form onSubmit={createMovement}><input type="date" value={movementForm.date} onChange={(event) => setMovementForm({ ...movementForm, date: event.target.value })} /><input type="number" placeholder="Monto abonado CLP" value={movementForm.amount} onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })} /><input placeholder="Descripcion" value={movementForm.description} onChange={(event) => setMovementForm({ ...movementForm, description: event.target.value })} /><input placeholder="Referencia / comprobante" value={movementForm.reference} onChange={(event) => setMovementForm({ ...movementForm, reference: event.target.value })} /><button className="primary-btn" disabled={saving}>Agregar movimiento</button></form></article><article className="finance-card"><h2>Movimientos cargados</h2><FinanceTable records={records} kind="movement" query={search} /></article></section> : null}

          {activeTab === "conciliacion" ? <section className="finance-card"><h2>Sugerencias de conciliacion</h2><p>La IA explica cada coincidencia. Las de confianza media o baja siempre requieren tu aprobacion.</p><div className="finance-suggestions">{suggestions.map((item) => <article key={`${item.movement.id}-${item.invoice.id}`}><div><b className={`finance-confidence ${item.level.toLowerCase()}`}>{item.confidence}% {item.level}</b><strong>{text(asData(item.movement).description, item.movement.title)}</strong><span>{money(asData(item.movement).amount)} · {shortDate(asData(item.movement).date)}</span></div><div><strong>{text(asData(item.invoice).invoiceNumber, item.invoice.title)}</strong><span>{text(asData(item.invoice).clientName)} · {money(asData(item.invoice).amount)}</span><small>{item.reasons.join(" · ")}</small></div><button className="primary-btn" type="button" disabled={saving} onClick={() => approveSuggestion(item)}>Confirmar</button></article>)}{!suggestions.length && !loading ? <p className="finance-empty">Aun no hay coincidencias. Carga facturas y movimientos para calcularlas.</p> : null}</div></section> : null}

          {activeTab === "excepciones" ? <section className="finance-grid"><form className="finance-card finance-form" onSubmit={createException}><h2>Nueva excepcion</h2><input placeholder="Ej. Pago parcial factura 1520" value={exceptionForm.title} onChange={(event) => setExceptionForm({ ...exceptionForm, title: event.target.value })} /><select value={exceptionForm.type} onChange={(event) => setExceptionForm({ ...exceptionForm, type: event.target.value })}><option>Pago parcial</option><option>Pago duplicado</option><option>Factura sin pago</option><option>Diferencia de monto</option><option>Transferencia desconocida</option></select><textarea placeholder="Contexto para quien revise el caso" value={exceptionForm.detail} onChange={(event) => setExceptionForm({ ...exceptionForm, detail: event.target.value })} /><button className="primary-btn" disabled={saving}>Enviar a revision</button></form><article className="finance-card"><h2>Casos pendientes</h2><FinanceTable records={records} kind="exception" query={search} /></article></section> : null}

          {activeTab === "cobranza" ? <section className="finance-grid"><article className="finance-card"><h2>Preparar cobranza responsable</h2><p>Genera casos para facturas vencidas. Antes de enviar WhatsApp, correo o SMS, el equipo debe revisar el mensaje, canal y consentimiento del cliente.</p><button className="primary-btn" type="button" onClick={generateCollections} disabled={saving}>Generar casos vencidos</button><div className="finance-note">La ejecucion multicanal se habilita cuando WhatsApp Business, correo o SMS esten conectados y aprobados para este tenant.</div></article><article className="finance-card"><h2>Casos de cobranza</h2><FinanceTable records={records} kind="collection" query={search} /></article></section> : null}

          {activeTab === "agentes" && agentWorkspace ? <section className="finance-agent-layout"><article className="finance-card finance-agent-intro"><div className="finance-agent-title-row"><div><h2>Tu equipo financiero de IA</h2><p>Cada agente trabaja sobre los registros del tenant y entrega acciones explicables. El equipo no confirma pagos, no modifica el ERP y no envía cobranzas sin una aprobacion autorizada.</p></div><button className="primary-btn" type="button" disabled={saving} onClick={analyzeAgents}>Analizar ahora</button></div><div className="finance-agent-priorities">{agentWorkspace.priority.length ? agentWorkspace.priority.map((item) => <div key={item.agent}><strong>{item.agent}</strong><span>{item.action}</span></div>) : <div><strong>Operacion estable</strong><span>No hay acciones financieras prioritarias.</span></div>}</div></article><article className="finance-card finance-agent-policy"><h2>Como se adapta a tu operacion</h2>{agentPolicy ? <><label>Confianza minima para mostrar una sugerencia<input type="range" min="50" max="99" value={agentPolicy.minimumConfidenceForSuggestion} onChange={(event) => setAgentPolicy({ ...agentPolicy, minimumConfidenceForSuggestion: Number(event.target.value) })} /><b>{agentPolicy.minimumConfidenceForSuggestion}%</b></label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.autoCreateExceptions} onChange={(event) => setAgentPolicy({ ...agentPolicy, autoCreateExceptions: event.target.checked })} /> Preparar automaticamente excepciones detectadas</label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.collectionsRequireApproval} onChange={(event) => setAgentPolicy({ ...agentPolicy, collectionsRequireApproval: event.target.checked })} /> Exigir aprobacion antes de una cobranza</label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.updateErpRequiresApproval} onChange={(event) => setAgentPolicy({ ...agentPolicy, updateErpRequiresApproval: event.target.checked })} /> Exigir aprobacion para actualizar ERP</label>{["OWNER", "ADMIN", "SUPER_ADMIN"].includes(String(agent?.role || "").toUpperCase()) ? <button className="primary-btn" type="button" disabled={saving} onClick={saveAgentPolicy}>Guardar politica</button> : <div className="finance-note">Solo una cuenta administradora puede cambiar esta politica.</div>}</> : null}</article><div className="finance-agent-grid">{agentWorkspace.agents.map((financeAgent) => <article className="finance-agent-card" key={financeAgent.code}><div className="finance-agent-card-head"><span>{financeAgent.code === "BANK_SYNC" ? "01" : financeAgent.code === "RECONCILIATOR" ? "02" : financeAgent.code === "EXCEPTIONS" ? "03" : financeAgent.code === "COLLECTIONS" ? "04" : "05"}</span><b className={`finance-agent-status ${financeAgent.status.toLowerCase()}`}>{financeAgent.status.replaceAll("_", " ")}</b></div><h3>{financeAgent.name}</h3><p>{financeAgent.purpose}</p><div className="finance-agent-metrics">{financeAgent.metrics.map((metric) => <div key={metric.label}><small>{metric.label}</small><strong>{typeof metric.value === "number" && /Monto|cobrar/i.test(metric.label) ? money(metric.value) : metric.value}</strong></div>)}</div><div className="finance-agent-next"><small>Siguiente accion</small><span>{financeAgent.nextAction}</span></div><small className="finance-agent-control">{financeAgent.humanControl}</small></article>)}</div><article className="finance-card finance-agent-safeguards"><h2>Reglas de seguridad del equipo</h2><div>{agentWorkspace.safeguards.map((safeguard) => <span key={safeguard}>{safeguard}</span>)}</div><p><strong>Confianza:</strong> {agentWorkspace.matchingPolicy.high} {agentWorkspace.matchingPolicy.medium} {agentWorkspace.matchingPolicy.low}</p></article></section> : null}
        </main>
      </div>
    </ModuleGate>
  );
}

function FinanceTable({ records, kind, query = "" }: { records: IndustryRecord[]; kind: "invoice" | "movement" | "exception" | "collection"; query?: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleRecords = normalizedQuery ? records.filter((record) => `${record.title} ${JSON.stringify(asData(record))}`.toLocaleLowerCase("es").includes(normalizedQuery)) : records;
  if (!visibleRecords.length) return <p className="finance-empty">{records.length ? "No hay registros que coincidan con la busqueda." : "Aun no hay registros en esta seccion."}</p>;
  return <div className="finance-table">{visibleRecords.map((record) => { const data = asData(record); return <div key={record.id}><div><strong>{record.title}</strong><span>{kind === "invoice" ? `${text(data.clientName)} · vence ${shortDate(data.dueDate)}` : kind === "movement" ? `${shortDate(data.date)} · ${text(data.reference, "Sin referencia")}` : text(data.type, text(data.detail, "Sin detalle"))}</span></div><b>{kind === "invoice" || kind === "movement" ? money(data.amount) : text(record.status)}</b></div>; })}</div>;
}
