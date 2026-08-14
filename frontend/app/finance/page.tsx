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
  getFinanceCustomers,
  getFinanceCollectionPortfolio,
  getFinanceDocuments,
  getFinanceIntegrations,
  getFinanceSyncHistory,
  getFinancePlan,
  getFinanceAgentWorkspace,
  getFinanceOverview,
  getFinancePayables,
  getFinanceReconciliationSuggestions,
  getIndustryRecords,
  importFinanceMigration,
  previewFinanceMigration,
  previewFinanceMigrationFile,
  prepareFinanceCollectionReminders,
  registerFinanceInvoiceReceipt,
  registerFinancePayablePayment,
  type FinanceOverview,
  type FinanceMigrationPreview,
  type FinancePayableSummary,
  type FinanceAgentPolicy,
  type FinanceAgentWorkspace,
  type FinanceCustomer,
  type FinanceCollectionPortfolioRow,
  type FinanceDocument,
  type FinanceIntegration,
  type FinanceSyncHistoryEntry,
  type FinancePlan,
  type FinanceReconciliationSuggestion,
  type IndustryRecord,
  updateFinanceAgentPolicy,
  syncFinanceNubox
} from "@/lib/api";
import { useAgentSession } from "@/lib/auth";
import type { ModuleAccessKey } from "@/lib/module-access";

type FinanceTab = "resumen" | "facturas" | "cartolas" | "conciliacion" | "excepciones" | "cobranza" | "pagos" | "migracion" | "aprobaciones" | "clientes" | "indicadores" | "integraciones" | "plan" | "agentes";
type FinanceDocumentStatusFilter = "all" | "paid" | "cancelled" | "pending" | "overdue";

const tabs: Array<{ key: FinanceTab; label: string; module: ModuleAccessKey; detail: string }> = [
  { key: "resumen", label: "Resumen financiero", module: "finance_analytics", detail: "Cartera, flujo esperado y estado de la operacion." },
  { key: "facturas", label: "Facturas por cobrar", module: "finance_invoices", detail: "Registra documentos pendientes de cobro." },
  { key: "cartolas", label: "Cartolas y movimientos", module: "finance_bank_sync", detail: "Importa movimientos bancarios para conciliarlos." },
  { key: "conciliacion", label: "Conciliación IA", module: "finance_reconciliation", detail: "Revisa sugerencias antes de confirmar cambios." },
  { key: "excepciones", label: "Excepciones financieras", module: "finance_exceptions", detail: "Ordena diferencias y casos que requieren revision." },
  { key: "cobranza", label: "Cobranza IA", module: "finance_collections", detail: "Prepara la cartera vencida para un seguimiento aprobado." },
  { key: "pagos", label: "Cuentas por pagar", module: "finance_payables", detail: "Registra proveedores, obligaciones y pagos con respaldo." },
  { key: "migracion", label: "Migración histórica", module: "finance_migration", detail: "Revisa un historial antes de incorporarlo a la operación financiera." },
  { key: "aprobaciones", label: "Aprobaciones financieras", module: "finance_reconciliation", detail: "Valida sugerencias antes de modificar la operación financiera." },
  { key: "clientes", label: "Clientes financieros", module: "finance_invoices", detail: "Consulta la cartera y el riesgo por cliente." },
  { key: "indicadores", label: "Indicadores financieros", module: "finance_analytics", detail: "Revisa caja, cartera, DSO y proyecciones." },
  { key: "integraciones", label: "Integraciones financieras", module: "finance_analytics", detail: "Estado seguro de las fuentes que alimentan el ciclo." },
  { key: "plan", label: "Plan y uso financiero", module: "finance_analytics", detail: "Consulta el consumo de documentos de tu plan financiero." },
  { key: "agentes", label: "Equipo IA financiero", module: "finance_analytics", detail: "Cinco agentes especializados coordinados con controles humanos." }
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

// Los estados se almacenan como códigos internos para que el backend pueda
// procesarlos de manera consistente. Esta capa los presenta en español sin
// exponer esos códigos ni los prefijos de datos de demostración al usuario.
function financeLabel(value: unknown, fallback = "-") {
  const source = text(value, fallback).replace(/^TRAINING-\d{4}-\d{2}-\d{2}\s*\|\s*/i, "");
  const labels: Record<string, string> = {
    OPEN: "Abierta",
    PENDING: "Pendiente",
    ACTIVE: "Activa",
    DRAFT: "Borrador",
    SCHEDULED: "Programada",
    APPLIED: "Aplicada",
    RECEIVED: "Recibido",
    SENT: "Enviado",
    PAID: "Pagada",
    CANCELLED: "Cancelada",
    CANCELED: "Cancelada",
    ANNULLED: "Anulada",
    PARTIAL: "Pago parcial",
    REGISTERED: "Registrado",
    OVERDUE: "Vencida",
    MATCHED: "Conciliado",
    APPROVED: "Aprobada",
    RESOLVED: "Resuelta",
    CLOSED: "Cerrada",
    MANUAL: "Manual",
    READY: "Listo",
    CLEAR: "Sin alertas",
    WAITING_FOR_DATA: "Esperando datos",
    NEEDS_REVIEW: "Requiere revisión",
    READY_FOR_REVIEW: "Lista para revisar",
    HIGH: "Alta",
    MEDIUM: "Media",
    LOW: "Baja"
  };
  const normalized = source.toUpperCase().replace(/[\s-]+/g, "_");
  return labels[normalized] || source;
}

function financeConfidenceLabel(value: unknown) {
  return financeLabel(String(value || "LOW").toUpperCase(), "Baja");
}

function financeAgentStatusLabel(value: unknown) {
  return financeLabel(value, "Sin información");
}

function financeConfidenceClass(value: unknown) {
  const normalized = String(value || "LOW").trim().toLowerCase();
  return ["high", "medium", "low"].includes(normalized) ? normalized : "low";
}

function financeReasons(value: unknown) {
  return Array.isArray(value) ? value.filter(Boolean).map(String).join(" · ") : "Sin detalle adicional";
}

function normalizeFinanceSuggestions(suggestions: FinanceReconciliationSuggestion[] | unknown) {
  if (!Array.isArray(suggestions)) return [] as FinanceReconciliationSuggestion[];
  return suggestions.map((suggestion) => ({
    ...suggestion,
    level: String(suggestion?.level || "LOW").toUpperCase(),
    reasons: Array.isArray(suggestion?.reasons) ? suggestion.reasons.filter(Boolean).map(String) : []
  }));
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
  return <Suspense fallback={<div className="module-access-state">Cargando Finanzas...</div>}><FinanceWorkspace /></Suspense>;
}

function FinanceWorkspace() {
  const params = useSearchParams();
  const [activeTab, setActiveTab] = useState<FinanceTab>(() => resolveFinanceTab(params.get("tab")));
  const active = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const agent = useAgentSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [suggestions, setSuggestions] = useState<FinanceReconciliationSuggestion[]>([]);
  const [agentWorkspace, setAgentWorkspace] = useState<FinanceAgentWorkspace | null>(null);
  const [financeCustomers, setFinanceCustomers] = useState<FinanceCustomer[]>([]);
  const [financeIntegrations, setFinanceIntegrations] = useState<FinanceIntegration[]>([]);
  const [financeSyncHistory, setFinanceSyncHistory] = useState<FinanceSyncHistoryEntry[]>([]);
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [payableSummary, setPayableSummary] = useState<FinancePayableSummary | null>(null);
  const [migrationPreview, setMigrationPreview] = useState<FinanceMigrationPreview | null>(null);
  const [migrationRows, setMigrationRows] = useState<Array<Record<string, unknown>>>([]);
  const [migrationSourceFile, setMigrationSourceFile] = useState("");
  const [agentPolicy, setAgentPolicy] = useState<FinanceAgentPolicy | null>(null);
  const [financeDocuments, setFinanceDocuments] = useState<FinanceDocument[]>([]);
  const [documentFilter, setDocumentFilter] = useState<"all" | "customers" | "suppliers">("all");
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentStatusFilter, setDocumentStatusFilter] = useState<FinanceDocumentStatusFilter>("all");
  const [collectionPortfolio, setCollectionPortfolio] = useState<FinanceCollectionPortfolioRow[]>([]);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<FinanceDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingNubox, setSyncingNubox] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [invoiceForm, setInvoiceForm] = useState({ number: "", client: "", rut: "", amount: "", dueDate: "" });
  const [payableForm, setPayableForm] = useState({ number: "", supplier: "", rut: "", category: "", amount: "", dueDate: "" });
  const [movementForm, setMovementForm] = useState({ date: "", amount: "", description: "", reference: "" });
  const [exceptionForm, setExceptionForm] = useState({ title: "", type: "Diferencia de monto", detail: "" });

  useEffect(() => {
    function syncBrowserNavigation() {
      setActiveTab(resolveFinanceTab(new URLSearchParams(window.location.search).get("tab")));
    }

    window.addEventListener("popstate", syncBrowserNavigation);
    return () => window.removeEventListener("popstate", syncBrowserNavigation);
  }, []);

  // Los enlaces del menú EV cambian ?tab= sin recargar el workspace.
  // Mantenemos el panel financiero sincronizado con el enlace seleccionado.
  useEffect(() => {
    const requestedTab = resolveFinanceTab(params.get("tab"));
    setActiveTab((current) => current === requestedTab ? current : requestedTab);
  }, [params]);

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
      if (activeTab === "facturas") setFinanceDocuments((await getFinanceDocuments(documentFilter)).documents);
      if (activeTab === "cartolas") setRecords(await getIndustryRecords("bank_movement"));
      if (activeTab === "excepciones") setRecords(await getIndustryRecords("finance_exception"));
      if (activeTab === "cobranza") setCollectionPortfolio((await getFinanceCollectionPortfolio()).portfolio);
      if (activeTab === "pagos") setPayableSummary(await getFinancePayables());
      if (activeTab === "conciliacion") setSuggestions(normalizeFinanceSuggestions((await getFinanceReconciliationSuggestions()).suggestions));
      if (activeTab === "aprobaciones") setSuggestions(normalizeFinanceSuggestions((await getFinanceReconciliationSuggestions()).suggestions));
      if (activeTab === "clientes") setFinanceCustomers((await getFinanceCustomers()).customers);
      if (activeTab === "indicadores") setOverview(await getFinanceOverview());
      if (activeTab === "integraciones") {
        const [integrations, history] = await Promise.all([getFinanceIntegrations(), getFinanceSyncHistory()]);
        setFinanceIntegrations(integrations.integrations);
        setFinanceSyncHistory(history.entries || []);
      }
      if (activeTab === "plan") setFinancePlan(await getFinancePlan());
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

  useEffect(() => { void load(); }, [activeTab, documentFilter]);

  const headline = useMemo(() => {
    if (!overview) return null;
    return [
      { label: "Por cobrar", value: money(overview.invoices.pendingAmount), help: `${overview.invoices.pending} facturas abiertas` },
      { label: "Vencido", value: money(overview.invoices.overdueAmount), help: `${overview.invoices.overdue} facturas vencidas` },
      { label: "Conciliado", value: `${overview.reconciliation.rate}%`, help: `${overview.reconciliation.matchedMovements} movimientos confirmados` },
      { label: "DSO estimado", value: `${overview.collection.dsoDays} dias`, help: "Promedio de cobro de la cartera pagada" }
    ];
  }, [overview]);

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

  async function createPayable(event: FormEvent) {
    event.preventDefault();
    if (!payableForm.number || !payableForm.supplier || !payableForm.amount || !payableForm.dueDate) {
      return setMessage("Completa documento, proveedor, monto y vencimiento de la cuenta por pagar.");
    }
    setSaving(true);
    try {
      const total = amount(payableForm.amount);
      await createIndustryRecord({
        recordType: "finance_payable",
        title: `Cuenta por pagar ${payableForm.number} - ${payableForm.supplier}`,
        status: "OPEN",
        data: {
          documentNumber: payableForm.number,
          supplierName: payableForm.supplier,
          supplierRut: payableForm.rut,
          category: payableForm.category,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: payableForm.dueDate,
          amount: total,
          balance: total,
          paidAmount: 0,
          currency: "CLP"
        }
      });
      setPayableForm({ number: "", supplier: "", rut: "", category: "", amount: "", dueDate: "" });
      setMessage("Cuenta por pagar registrada. El pago se confirma solo cuando una persona autorizada lo registra.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la cuenta por pagar."); }
    finally { setSaving(false); }
  }

  async function registerPayablePayment(record: IndustryRecord) {
    const data = asData(record);
    const pending = amount(data.balance ?? data.amount);
    const amountValue = window.prompt(`Monto a pagar (saldo pendiente ${money(pending)}):`, String(pending));
    if (amountValue === null) return;
    const paymentAmount = amount(amountValue.replace(/\./g, "").replace(",", "."));
    if (!paymentAmount) return setMessage("Ingresa un monto de pago válido.");
    const reference = window.prompt("Referencia o comprobante del pago (opcional):", "") || "";
    setSaving(true);
    try {
      await registerFinancePayablePayment(record.id, { amount: paymentAmount, reference });
      setMessage("Pago registrado. La cuenta queda actualizada con su saldo restante.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar el pago."); }
    finally { setSaving(false); }
  }

  async function registerInvoiceReceipt(document: FinanceDocument) {
    const pending = amount(document.balance);
    const amountValue = window.prompt(`Monto recibido (saldo pendiente ${money(pending)}):`, String(pending));
    if (amountValue === null) return;
    const receiptAmount = amount(amountValue.replace(/\./g, "").replace(",", "."));
    if (!receiptAmount) return setMessage("Ingresa un monto de cobro válido.");
    const reference = window.prompt("Referencia o comprobante del cobro (opcional):", "") || "";
    setSaving(true);
    try {
      await registerFinanceInvoiceReceipt(document.id, { amount: receiptAmount, reference });
      setMessage("Cobro registrado con trazabilidad. No se envió ninguna cobranza ni se modificó el ERP.");
      setOpenActionId(null);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar el cobro."); }
    finally { setSaving(false); }
  }

  async function prepareReminder(row: FinanceCollectionPortfolioRow) {
    setSaving(true);
    try {
      const result = await prepareFinanceCollectionReminders(row.key);
      setMessage(`${result.count} borrador(es) de recordatorio preparados para revisión. No se envió ningún mensaje.`);
      setOpenActionId(null);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar el recordatorio."); }
    finally { setSaving(false); }
  }

  async function copyFinanceText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage("No se pudo copiar desde este navegador.");
    }
    setOpenActionId(null);
  }

  async function previewHistoricalMigration(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(csv|xlsx|xlsm)$/i.test(file.name)) {
      return setMessage("Selecciona un CSV o Excel (.xlsx). Los PDF e imágenes se adjuntan en Documentos y requieren revisión humana.");
    }
    setSaving(true);
    try {
      const preview = /\.csv$/i.test(file.name)
        ? await previewFinanceMigration(parseDelimitedRows(await file.text()))
        : await previewFinanceMigrationFile(file);
      const sourceRows = preview.sourceRows || [];
      if (!sourceRows.length) throw new Error("No se detectaron filas en el archivo histórico.");
      setMigrationRows(sourceRows.slice(0, preview.maxRows));
      setMigrationPreview(preview);
      setMigrationSourceFile(preview.sourceFile || file.name);
      setMessage("Vista previa lista. Revisa los totales y las filas marcadas antes de importar.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar la migración histórica."); }
    finally { setSaving(false); }
  }

  async function importHistoricalMigration() {
    if (!migrationPreview || !migrationRows.length) return;
    setSaving(true);
    try {
      const result = await importFinanceMigration({ sourceFile: migrationSourceFile || "migracion-historica.csv", rows: migrationRows });
      setMigrationPreview(null);
      setMigrationRows([]);
      setMigrationSourceFile("");
      setMessage(`${result.imported} registros históricos incorporados. ${result.requiresReview} quedaron en Excepciones para revisión humana.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo importar el historial."); }
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

  async function synchronizeNubox() {
    setSyncingNubox(true);
    try {
      const result = await syncFinanceNubox();
      setMessage(result.pending ? (result.message || "Ya existe una sincronización en curso.") : `Nubox sincronizado: ${result.created || 0} nuevos y ${result.updated || 0} actualizados.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo sincronizar Nubox.");
    } finally {
      setSyncingNubox(false);
    }
  }

  const canManageFinance = ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(String(agent?.role || "").toUpperCase());

  return (
    <ModuleGate moduleKey="finance_analytics">
      <div className={`module-with-menu-shell product-workspace finance-shell finance-product-workspace ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active={active.label} isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} showNotificationCenter={false} />
        <main className="finance-workspace">
          <header className="finance-header">
            <div className="finance-title"><span>EVOLUM FINANZAS</span><h1>{activeTab === "resumen" ? `Hola, ${agent?.name?.split(" ")[0] || "equipo"}` : active.label}</h1><p>{activeTab === "resumen" ? "Esto es lo que necesita tu atencion financiera hoy." : active.detail}</p></div>
            <div className="finance-header-actions"><label className="finance-search"><svg className="finance-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg><input aria-label="Buscar en Finanzas" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar facturas, clientes o movimientos" /></label><AccountPill fallbackName={agent?.name || "Usuario"} /></div>
          </header>
          {message ? <div className="finance-message">{message}</div> : null}
          {loading ? <div className="finance-loading">Actualizando informacion financiera...</div> : null}

          {activeTab === "resumen" && overview ? <>
          <section className="finance-kpis finance-kpis-v3">{headline?.map((item) => <article key={item.label}><small>{item.label}</small><strong>{item.value}</strong><span>{item.help}</span></article>)}</section>
            <FinanceCycle overview={overview} onSelect={selectTab} />
            <section className="finance-overview-layout">
              <article className="finance-card finance-reconciliation-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Conciliacion activa</span><h2>Movimientos que esperan revision</h2></div><button type="button" className="finance-link-button" onClick={() => selectTab("conciliacion")}>Ver sugerencias</button></div>
                <div className="finance-overview-list">{overview.recent?.invoices?.slice(0, 4).map((invoice) => <div key={invoice.id}><span className="finance-record-mark">{financeLabel(asData(invoice).invoiceNumber, "FC").slice(0, 4)}</span><div><strong>{financeLabel(asData(invoice).clientName, financeLabel(invoice.title))}</strong><small>Factura {financeLabel(asData(invoice).invoiceNumber, "sin número")} · vence {shortDate(asData(invoice).dueDate)}</small></div><b>{money(asData(invoice).balance ?? asData(invoice).amount)}</b></div>)}{!overview.recent?.invoices?.length ? <p className="finance-empty">Carga una factura y una cartola para iniciar la conciliación guiada.</p> : null}</div>
              </article>
              <article className="finance-card finance-projection-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Analitica financiera</span><h2>Proyeccion de cobro</h2></div><strong>{money(overview.collection.expectedNext30Days)}</strong></div><div className="finance-projection-bars" aria-label="Proyeccion de cobro de seis semanas">{[42, 54, 37, 68, 82, 61].map((value, index) => <div key={index}><i style={{ height: `${value}%` }} /><span>S{index + 1}</span></div>)}</div><p>Estimacion basada en cartera abierta, vencimiento y promesas de pago registradas.</p></article>
            </section>
            <section className="finance-grid finance-summary-bottom">
              <article className="finance-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Cartera</span><h2>Antiguedad de cobro</h2></div><button className="finance-link-button" type="button" onClick={() => selectTab("cobranza")}>Gestionar cobranza</button></div>{overview.aging.map((bucket) => <div className="finance-aging" key={bucket.label}><span>{bucket.label}</span><i><b style={{ width: `${Math.min(100, overview.invoices.pendingAmount ? (bucket.amount / overview.invoices.pendingAmount) * 100 : 0)}%` }} /></i><strong>{money(bucket.amount)}</strong></div>)}</article>
              <article className="finance-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Conexiones</span><h2>Estado de integraciones</h2></div><button className="finance-link-button" type="button" onClick={() => window.location.assign("/connections")}>Ver conexiones</button></div>{overview.integrationReadiness.map((item) => <div className="finance-readiness" key={item.key}><b className={item.status}>{item.status === "ready" ? "Lista" : item.status === "manual" ? "Manual" : "Requiere configuración"}</b><div><strong>{item.label}</strong><span>{item.note}</span></div></div>)}</article>
            </section>
          </> : null}

          {activeTab === "facturas" ? <section className="finance-document-workspace">
            <article className="finance-card finance-document-portal">
              <div className="finance-card-heading finance-document-heading"><div><span className="finance-eyebrow">Portal documental</span><h2>Facturas y documentos financieros</h2><p>Consulta por separado las facturas emitidas a clientes y las obligaciones registradas de proveedores.</p></div><button type="button" className="secondary-btn" onClick={() => setSelectedDocument(null)}>Limpiar detalle</button></div>
              <div className="finance-document-filters" role="group" aria-label="Filtrar documentos"><button type="button" className={documentFilter === "all" ? "is-active" : ""} onClick={() => setDocumentFilter("all")}>Todos</button><button type="button" className={documentFilter === "customers" ? "is-active" : ""} onClick={() => setDocumentFilter("customers")}>Facturas de clientes</button><button type="button" className={documentFilter === "suppliers" ? "is-active" : ""} onClick={() => setDocumentFilter("suppliers")}>Facturas de proveedores</button></div>
              <div className="finance-document-tools" aria-label="Búsqueda y filtros del portal documental">
                <label className="finance-document-search"><span>Buscar documento</span><input type="search" value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Folio, RUT o razón social" /></label>
                <label className="finance-document-status-filter"><span>Estado</span><select value={documentStatusFilter} onChange={(event) => setDocumentStatusFilter(event.target.value as FinanceDocumentStatusFilter)}><option value="all">Todos los estados</option><option value="paid">Pagadas</option><option value="cancelled">Canceladas</option><option value="pending">Pendientes</option><option value="overdue">Vencidas</option></select></label>
                <button type="button" className="secondary-btn finance-clear-document-filters" disabled={!documentQuery && documentStatusFilter === "all"} onClick={() => { setDocumentQuery(""); setDocumentStatusFilter("all"); }}>Limpiar filtros</button>
              </div>
              <FinanceDocumentsTable documents={financeDocuments} documentFilter={documentFilter} query={documentQuery} statusFilter={documentStatusFilter} saving={saving} openActionId={openActionId} selectedDocument={selectedDocument} onToggleActions={setOpenActionId} onSelect={setSelectedDocument} onCloseDetail={() => setSelectedDocument(null)} onRegisterReceipt={registerInvoiceReceipt} onPrepareReminder={(document) => prepareReminder({ key: document.partyRut?.replace(/[^0-9kK]/g, "") || document.partyName.toLocaleLowerCase("es"), name: document.partyName, rut: document.partyRut, documents: 0, openDocuments: 0, overdueDocuments: 0, dueSoonAmount: 0, overdueAmount: 0, totalDebt: 0, oldestInvoiceDate: null, averagePaymentDays: null, reminders: 0, lastReminderAt: null, latestCaseId: null, reminderStatus: "" })} onCopy={copyFinanceText} onOpenCollections={() => selectTab("cobranza")} onOpenPayables={() => selectTab("pagos")} />
            </article>
            <form className="finance-card finance-form finance-document-entry" onSubmit={createInvoice}><span className="finance-eyebrow">Registro manual</span><h2>Nueva factura de cliente</h2><p>Registra una factura emitida. El cobro y cualquier aviso posterior quedan siempre bajo revisión humana.</p><input required placeholder="Número de factura" value={invoiceForm.number} onChange={(event) => setInvoiceForm({ ...invoiceForm, number: event.target.value })} /><input required placeholder="Cliente o empresa" value={invoiceForm.client} onChange={(event) => setInvoiceForm({ ...invoiceForm, client: event.target.value })} /><input placeholder="RUT cliente (opcional)" value={invoiceForm.rut} onChange={(event) => setInvoiceForm({ ...invoiceForm, rut: event.target.value })} /><input required type="number" placeholder="Monto CLP" value={invoiceForm.amount} onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })} /><label>Vencimiento<input required type="date" value={invoiceForm.dueDate} onChange={(event) => setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })} /></label><button className="primary-btn" disabled={saving}>Guardar factura</button></form>
          </section> : null}

          {activeTab === "cartolas" ? <section className="finance-grid"><article className="finance-card finance-form"><h2>Importar cartola</h2><p>CSV queda listo para conciliacion. PDF y Excel pueden guardarse en Archivos mientras se activa el parser de la integracion contratada.</p><label className="finance-upload">Seleccionar cartola CSV<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={saving} /></label><hr /><h3>Registrar movimiento manual</h3><form onSubmit={createMovement}><input type="date" value={movementForm.date} onChange={(event) => setMovementForm({ ...movementForm, date: event.target.value })} /><input type="number" placeholder="Monto abonado CLP" value={movementForm.amount} onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })} /><input placeholder="Descripcion" value={movementForm.description} onChange={(event) => setMovementForm({ ...movementForm, description: event.target.value })} /><input placeholder="Referencia / comprobante" value={movementForm.reference} onChange={(event) => setMovementForm({ ...movementForm, reference: event.target.value })} /><button className="primary-btn" disabled={saving}>Agregar movimiento</button></form></article><article className="finance-card"><h2>Movimientos cargados</h2><FinanceTable records={records} kind="movement" query={search} /></article></section> : null}

          {activeTab === "conciliacion" ? <section className="finance-card"><h2>Sugerencias de conciliación</h2><p>La IA explica cada coincidencia. Las de confianza media o baja siempre requieren tu aprobación.</p><div className="finance-suggestions">{suggestions.map((item) => <article key={`${item.movement.id}-${item.invoice.id}`}><div><b className={`finance-confidence ${item.level.toLowerCase()}`}>{item.confidence}% {financeConfidenceLabel(item.level)}</b><strong>{financeLabel(asData(item.movement).description, financeLabel(item.movement.title))}</strong><span>{money(asData(item.movement).amount)} · {shortDate(asData(item.movement).date)}</span></div><div><strong>{financeLabel(asData(item.invoice).invoiceNumber, financeLabel(item.invoice.title))}</strong><span>{financeLabel(asData(item.invoice).clientName)} · {money(asData(item.invoice).amount)}</span><small>{financeReasons(item.reasons)}</small></div><button className="primary-btn" type="button" disabled={saving} onClick={() => approveSuggestion(item)}>Confirmar</button></article>)}{!suggestions.length && !loading ? <p className="finance-empty">Aún no hay coincidencias. Carga facturas y movimientos para calcularlas.</p> : null}</div></section> : null}

          {activeTab === "excepciones" ? <section className="finance-grid"><form className="finance-card finance-form" onSubmit={createException}><h2>Nueva excepcion</h2><input placeholder="Ej. Pago parcial factura 1520" value={exceptionForm.title} onChange={(event) => setExceptionForm({ ...exceptionForm, title: event.target.value })} /><select value={exceptionForm.type} onChange={(event) => setExceptionForm({ ...exceptionForm, type: event.target.value })}><option>Pago parcial</option><option>Pago duplicado</option><option>Factura sin pago</option><option>Diferencia de monto</option><option>Transferencia desconocida</option></select><textarea placeholder="Contexto para quien revise el caso" value={exceptionForm.detail} onChange={(event) => setExceptionForm({ ...exceptionForm, detail: event.target.value })} /><button className="primary-btn" disabled={saving}>Enviar a revision</button></form><article className="finance-card"><h2>Casos pendientes</h2><FinanceTable records={records} kind="exception" query={search} /></article></section> : null}

          {activeTab === "cobranza" ? <section className="finance-collections-workspace">
            <article className="finance-card finance-collections-portal"><div className="finance-card-heading"><div><span className="finance-eyebrow">Cartera de cobranza</span><h2>Seguimiento por cliente</h2><p>Prioriza documentos vencidos, prepara acciones y conserva la trazabilidad por razón social.</p></div><button className="primary-btn" type="button" onClick={generateCollections} disabled={saving}>Generar casos vencidos</button></div><div className="finance-note">Los recordatorios que prepares aquí son borradores internos. Nunca se envían por WhatsApp, correo o SMS sin canal, consentimiento y aprobación humana.</div></article>
            <FinanceCollectionsTable portfolio={collectionPortfolio} query={search} saving={saving} openActionId={openActionId} onToggleActions={setOpenActionId} onPrepareReminder={prepareReminder} onOpenDocuments={() => { setDocumentFilter("customers"); selectTab("facturas"); }} onCopy={copyFinanceText} />
          </section> : null}

          {activeTab === "pagos" ? <section className="finance-grid finance-payables-workspace">
            <form className="finance-card finance-form" onSubmit={createPayable}>
              <span className="finance-eyebrow">Nueva obligación</span><h2>Cuenta por pagar</h2>
              <input required placeholder="Folio o número de documento" value={payableForm.number} onChange={(event) => setPayableForm({ ...payableForm, number: event.target.value })} />
              <input required placeholder="Proveedor o colaborador" value={payableForm.supplier} onChange={(event) => setPayableForm({ ...payableForm, supplier: event.target.value })} />
              <input placeholder="RUT proveedor (opcional)" value={payableForm.rut} onChange={(event) => setPayableForm({ ...payableForm, rut: event.target.value })} />
              <input placeholder="Categoría o centro de costo" value={payableForm.category} onChange={(event) => setPayableForm({ ...payableForm, category: event.target.value })} />
              <input required type="number" min="1" placeholder="Monto CLP" value={payableForm.amount} onChange={(event) => setPayableForm({ ...payableForm, amount: event.target.value })} />
              <label>Vencimiento<input required type="date" value={payableForm.dueDate} onChange={(event) => setPayableForm({ ...payableForm, dueDate: event.target.value })} /></label>
              <button className="primary-btn" disabled={saving}>Guardar cuenta</button>
            </form>
            <article className="finance-card finance-payable-summary"><div className="finance-card-heading"><div><span className="finance-eyebrow">Control de egresos</span><h2>Estado de proveedores</h2></div><span>{payableSummary?.summary.total || 0} cuentas</span></div><div className="finance-payable-kpis"><div><small>Por pagar</small><strong>{money(payableSummary?.summary.pendingAmount)}</strong></div><div><small>Vencido</small><strong className="is-overdue">{money(payableSummary?.summary.overdueAmount)}</strong></div><div><small>Pagadas</small><strong>{payableSummary?.summary.paid || 0}</strong></div></div><p>Registrar un pago deja trazabilidad; no modifica el banco ni el ERP conectado.</p></article>
            <article className="finance-card finance-payable-list"><span className="finance-eyebrow">Cuentas registradas</span><h2>Pagos y saldos pendientes</h2><PayablesTable records={payableSummary?.payables || []} query={search} saving={saving} onRegisterPayment={registerPayablePayment} /></article>
          </section> : null}

          {activeTab === "migracion" ? <ModuleGate moduleKey="finance_migration"><section className="finance-grid finance-migration-workspace">
            <article className="finance-card finance-migration-upload"><span className="finance-eyebrow">Ingreso histórico</span><h2>Traer tu cartera anterior</h2><p>Sube una exportación CSV o Excel desde tu ERP, banco o sistema anterior. EVOLUM identifica documentos pagados, abiertos, vencidos y parciales antes de guardar nada.</p><label className="finance-upload">Seleccionar historial CSV o Excel<input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsm" onChange={previewHistoricalMigration} disabled={saving} /></label><div className="finance-note">Columnas sugeridas: folio, cliente o proveedor, RUT, monto, saldo, pagado, estado, fecha de emisión y vencimiento.</div><p className="finance-muted">Los PDF, imágenes y documentos sin columnas estructuradas se conservan en Documentos y se revisan manualmente; no se inventan datos financieros.</p></article>
            <article className="finance-card finance-migration-preview"><div className="finance-card-heading"><div><span className="finance-eyebrow">Vista previa</span><h2>{migrationPreview ? "Historial listo para revisar" : "Aún no hay archivo seleccionado"}</h2></div>{migrationPreview ? <button className="primary-btn" type="button" onClick={importHistoricalMigration} disabled={saving}>Importar historial</button> : null}</div>{migrationPreview ? <><div className="finance-migration-kpis"><div><small>Filas</small><strong>{migrationPreview.summary.totalRows}</strong></div><div><small>Por cobrar</small><strong>{money(migrationPreview.summary.openReceivables)}</strong></div><div><small>Por pagar</small><strong>{money(migrationPreview.summary.openPayables)}</strong></div><div><small>Revisión</small><strong className={migrationPreview.summary.reviewRows ? "is-overdue" : ""}>{migrationPreview.summary.reviewRows}</strong></div></div><div className="finance-migration-statuses">{Object.entries(migrationPreview.summary.byStatus).filter(([, value]) => value).map(([status, value]) => <span key={status}>{financeLabel(status)}: <b>{value}</b></span>)}</div><div className="finance-migration-table"><div><span>Fila</span><span>Tipo</span><span>Documento / contraparte</span><span>Saldo</span><span>Estado</span></div>{migrationPreview.rows.slice(0, 12).map((row) => <div key={String(row.rowNumber)} className={row.needsReview ? "needs-review" : ""}><span>{String(row.rowNumber)}</span><span>{row.kind === "PAYABLE" ? "Por pagar" : "Por cobrar"}</span><span>{financeLabel(row.documentNumber, "Sin folio")} · {financeLabel(row.partyName, "Sin contraparte")}</span><span>{money(row.balance)}</span><span>{row.needsReview ? "Revisar" : financeLabel(row.status)}</span></div>)}</div></> : <p className="finance-empty">Selecciona un CSV para ver la clasificación, los saldos de apertura y los registros que requieren revisión.</p>}</article>
          </section></ModuleGate> : null}

          {activeTab === "agentes" && agentWorkspace ? <section className="finance-agent-layout"><article className="finance-card finance-agent-intro"><div className="finance-agent-title-row"><div><h2>Tu equipo financiero de IA</h2><p>Cada agente trabaja sobre los registros de esta cuenta y entrega acciones explicables. El equipo no confirma pagos, no modifica el ERP y no envía cobranzas sin una aprobación autorizada.</p></div><button className="primary-btn" type="button" disabled={saving} onClick={analyzeAgents}>Analizar ahora</button></div><div className="finance-agent-priorities">{agentWorkspace.priority.length ? agentWorkspace.priority.map((item) => <div key={item.agent}><strong>{financeLabel(item.agent)}</strong><span>{financeLabel(item.action)}</span></div>) : <div><strong>Operación estable</strong><span>No hay acciones financieras prioritarias.</span></div>}</div></article><article className="finance-card finance-agent-policy"><h2>Cómo se adapta a tu operación</h2>{agentPolicy ? <><label>Confianza mínima para mostrar una sugerencia<input type="range" min="50" max="99" value={agentPolicy.minimumConfidenceForSuggestion} onChange={(event) => setAgentPolicy({ ...agentPolicy, minimumConfidenceForSuggestion: Number(event.target.value) })} /><b>{agentPolicy.minimumConfidenceForSuggestion}%</b></label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.autoCreateExceptions} onChange={(event) => setAgentPolicy({ ...agentPolicy, autoCreateExceptions: event.target.checked })} /> Preparar automáticamente excepciones detectadas</label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.collectionsRequireApproval} onChange={(event) => setAgentPolicy({ ...agentPolicy, collectionsRequireApproval: event.target.checked })} /> Exigir aprobación antes de una cobranza</label><label className="finance-toggle"><input type="checkbox" checked={agentPolicy.updateErpRequiresApproval} onChange={(event) => setAgentPolicy({ ...agentPolicy, updateErpRequiresApproval: event.target.checked })} /> Exigir aprobación para actualizar ERP</label>{["OWNER", "ADMIN", "SUPER_ADMIN"].includes(String(agent?.role || "").toUpperCase()) ? <button className="primary-btn" type="button" disabled={saving} onClick={saveAgentPolicy}>Guardar política</button> : <div className="finance-note">Solo una cuenta administradora puede cambiar esta política.</div>}</> : null}</article><div className="finance-agent-grid">{agentWorkspace.agents.map((financeAgent) => <article className="finance-agent-card" key={financeAgent.code}><div className="finance-agent-card-head"><span>{financeAgent.code === "BANK_SYNC" ? "01" : financeAgent.code === "RECONCILIATOR" ? "02" : financeAgent.code === "EXCEPTIONS" ? "03" : financeAgent.code === "COLLECTIONS" ? "04" : "05"}</span><b className={`finance-agent-status ${financeAgent.status.toLowerCase()}`}>{financeAgentStatusLabel(financeAgent.status)}</b></div><h3>{financeLabel(financeAgent.name)}</h3><p>{financeLabel(financeAgent.purpose)}</p><div className="finance-agent-metrics">{financeAgent.metrics.map((metric) => <div key={metric.label}><small>{financeLabel(metric.label)}</small><strong>{typeof metric.value === "number" && /Monto|cobrar/i.test(metric.label) ? money(metric.value) : financeLabel(metric.value)}</strong></div>)}</div><div className="finance-agent-next"><small>Siguiente acción</small><span>{financeLabel(financeAgent.nextAction)}</span></div><small className="finance-agent-control">{financeLabel(financeAgent.humanControl)}</small></article>)}</div><article className="finance-card finance-agent-safeguards"><h2>Reglas de seguridad del equipo</h2><div>{agentWorkspace.safeguards.map((safeguard) => <span key={safeguard}>{financeLabel(safeguard)}</span>)}</div><p><strong>Confianza:</strong> {financeLabel(agentWorkspace.matchingPolicy.high)} {financeLabel(agentWorkspace.matchingPolicy.medium)} {financeLabel(agentWorkspace.matchingPolicy.low)}</p></article></section> : null}
          {activeTab === "aprobaciones" ? <section className="finance-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Control humano</span><h2>Aprobaciones pendientes</h2></div><span className="finance-approval-count">{suggestions.length}</span></div><p>Las conciliaciones sugeridas no modifican facturas ni movimientos hasta que una persona autorizada las confirme.</p><div className="finance-suggestions">{suggestions.map((item) => <article key={`${item.movement.id}-${item.invoice.id}`}><div><b className={`finance-confidence ${item.level.toLowerCase()}`}>{item.confidence}% {financeConfidenceLabel(item.level)}</b><strong>{financeLabel(asData(item.movement).description, financeLabel(item.movement.title))}</strong><span>{money(asData(item.movement).amount)} · {shortDate(asData(item.movement).date)}</span></div><div><strong>{financeLabel(asData(item.invoice).invoiceNumber, financeLabel(item.invoice.title))}</strong><span>{financeLabel(asData(item.invoice).customerName)} · {money(asData(item.invoice).amount)}</span><small>{financeReasons(item.reasons)}</small></div><button className="primary-btn" type="button" disabled={saving} onClick={() => approveSuggestion(item)}>Aprobar</button></article>)}{!suggestions.length && !loading ? <p className="finance-empty">No hay aprobaciones financieras pendientes.</p> : null}</div></section> : null}
          {activeTab === "clientes" ? <section className="finance-card"><div className="finance-card-heading"><div><span className="finance-eyebrow">Cartera de clientes</span><h2>Riesgo y saldo por cliente</h2></div><span>{financeCustomers.length} clientes</span></div><div className="finance-client-table"><div className="finance-client-table-head"><span>Cliente</span><span>Facturas</span><span>Por cobrar</span><span>Vencido</span></div>{financeCustomers.filter((item) => `${item.name} ${item.rut || ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).map((item) => <div key={item.key}><div><strong>{financeLabel(item.name)}</strong><small>{item.rut || "Sin RUT registrado"}</small></div><span>{item.openInvoices}/{item.invoices}</span><b>{money(item.outstandingAmount)}</b><b className={item.overdueAmount ? "is-overdue" : ""}>{money(item.overdueAmount)}</b></div>)}{!financeCustomers.length && !loading ? <p className="finance-empty">Aún no hay facturas para construir la cartera de clientes.</p> : null}</div></section> : null}
          {activeTab === "indicadores" && overview ? <section className="finance-indicator-layout"><article className="finance-card"><span className="finance-eyebrow">Flujo de caja proyectado</span><h2>{money(overview.collection.expectedNext30Days)}</h2><p>Estimación de cobros para los próximos 30 días, basada en vencimientos y saldos abiertos.</p><div className="finance-projection-bars">{[28, 44, 57, 43, 70, 86].map((value, index) => <div key={index}><i style={{ height: `${value}%` }} /><span>S{index + 1}</span></div>)}</div></article><article className="finance-card"><span className="finance-eyebrow">Indicadores clave</span><div className="finance-indicator-list"><div><span>Tasa de recuperación</span><strong>{overview.collection.rate}%</strong></div><div><span>DSO</span><strong>{overview.collection.dsoDays} días</strong></div><div><span>Conciliación automática</span><strong>{overview.reconciliation.rate}%</strong></div><div><span>Excepciones críticas</span><strong>{overview.exceptions.critical}</strong></div></div></article></section> : null}
          {activeTab === "integraciones" ? <section className="finance-grid finance-integrations-workspace">
            <article className="finance-card">
              <span className="finance-eyebrow">Fuentes del ciclo</span>
              <h2>Integraciones autorizadas</h2>
              <p>Solo se muestra el estado operativo. Las credenciales, tokens e identificadores técnicos nunca se exponen en esta pantalla.</p>
              <div className="finance-integration-grid">{financeIntegrations.map((item) => <article key={item.key}><span className={`finance-integration-dot ${item.status}`} /><div><strong>{item.label}</strong><p>{item.detail}</p></div><b>{item.status === "connected" ? "Conectada" : item.status === "manual_ready" ? "Carga manual" : "Sin conectar"}</b></article>)}{!financeIntegrations.length && !loading ? <p className="finance-empty">No se pudo obtener el estado de las integraciones.</p> : null}</div>
              <button className="primary-btn" type="button" onClick={() => window.location.assign("/connections")}>Gestionar conexiones</button>
            </article>
            <article className="finance-card finance-sync-card">
              <span className="finance-eyebrow">Automatización segura</span>
              <h2>Sincronización Nubox</h2>
              <p>Cuando Nubox esté conectado, EVOLUM actualiza las facturas en segundo plano y prepara el análisis para revisión humana. No confirma pagos, no modifica el ERP ni envía cobranzas.</p>
              {canManageFinance ? <button className="primary-btn" type="button" disabled={syncingNubox} onClick={synchronizeNubox}>{syncingNubox ? "Sincronizando..." : "Sincronizar ahora"}</button> : <div className="finance-note">Solo una cuenta administradora puede iniciar una sincronización manual.</div>}
              <div className="finance-sync-history"><h3>Historial reciente</h3>{financeSyncHistory.slice(0, 5).map((entry) => <div key={entry.id}><b className={entry.action === "NUBOX_SALES_SYNC_FAILED" ? "is-error" : "is-success"}>{entry.action === "NUBOX_SALES_SYNCED" ? "Sincronización completada" : entry.action === "NUBOX_SALES_SYNC_FAILED" ? "Sincronización con incidencia" : "Análisis preparado"}</b><span>{shortDate(entry.createdAt)}</span></div>)}{!financeSyncHistory.length && !loading ? <p className="finance-empty">Aún no hay sincronizaciones registradas.</p> : null}</div>
            </article>
          </section> : null}
          {activeTab === "plan" ? <section className="finance-grid"><article className="finance-card finance-plan-card"><span className="finance-eyebrow">Plan actual</span><h2>{financePlan?.plan || "Cargando plan"}</h2><p>El uso contabiliza facturas y movimientos procesados en esta cuenta financiera.</p>{financePlan ? <><div className="finance-plan-usage"><span style={{ width: `${financePlan.usage.percentage ?? 0}%` }} /></div><strong>{financePlan.usage.processedDocuments}{financePlan.usage.limit ? ` / ${financePlan.usage.limit}` : " documentos procesados"}</strong></> : null}</article><article className="finance-card"><span className="finance-eyebrow">Escalabilidad</span><h2>Cuando tu operación crezca</h2><p>Los límites comerciales se administran desde Planes y módulos. Ningún dato financiero se elimina al cambiar de plan.</p><button className="primary-btn" type="button" onClick={() => window.location.assign("/saas")}>Ver planes y módulos</button></article></section> : null}
        </main>
      </div>
    </ModuleGate>
  );
}

function FinanceDocumentsTable({ documents, documentFilter, query, statusFilter, saving, openActionId, selectedDocument, onToggleActions, onSelect, onCloseDetail, onRegisterReceipt, onPrepareReminder, onCopy, onOpenCollections, onOpenPayables }: { documents: FinanceDocument[]; documentFilter: "all" | "customers" | "suppliers"; query: string; statusFilter: FinanceDocumentStatusFilter; saving: boolean; openActionId: string | null; selectedDocument: FinanceDocument | null; onToggleActions: (id: string | null) => void; onSelect: (document: FinanceDocument) => void; onCloseDetail: () => void; onRegisterReceipt: (document: FinanceDocument) => void; onPrepareReminder: (document: FinanceDocument) => void; onCopy: (value: string, successMessage: string) => void; onOpenCollections: () => void; onOpenPayables: () => void }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visible = documents.filter((item) => {
    const status = String(item.status || "").toUpperCase();
    const balance = amount(item.balance);
    const isCancelled = ["CANCELLED", "CANCELED", "ANNULLED"].includes(status);
    const matchesQuery = !normalizedQuery || `${item.documentNumber} ${item.partyName} ${item.partyRut || ""}`.toLocaleLowerCase("es").includes(normalizedQuery);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "paid" && (status === "PAID" || (balance <= 0 && !isCancelled)))
      || (statusFilter === "cancelled" && isCancelled)
      || (statusFilter === "pending" && ["OPEN", "PENDING", "PARTIAL"].includes(status) && balance > 0)
      || (statusFilter === "overdue" && status === "OVERDUE");
    return matchesQuery && matchesStatus;
  });

  if (!visible.length) return <p className="finance-empty">{documents.length ? "No hay documentos que coincidan con la búsqueda y los filtros aplicados." : documentFilter === "suppliers" ? "Aún no hay documentos de proveedores registrados. Puedes crear una cuenta por pagar o importar el historial de proveedores." : "No hay documentos para este filtro. Puedes registrar una factura de cliente o una obligación de proveedor."}</p>;

  return <div className="finance-document-table-wrap"><div className="finance-document-table" role="table" aria-label="Documentos financieros">
    <div className="finance-document-table-head" role="row"><span>Documento</span><span>Estado</span><span>Fecha de emisión</span><span>Registro de cobro / pago</span><span>Monto total</span><span>Acciones</span></div>
    {visible.map((document) => {
      const isCustomer = document.side === "CUSTOMER";
      const isPaid = String(document.status).toUpperCase() === "PAID" || document.balance <= 0;
      const actionId = `document-${document.id}`;
      const showDetail = selectedDocument?.id === document.id;

      return <div className={`finance-document-row-group${showDetail ? " is-selected" : ""}`} key={document.id}>
        <div className="finance-document-row" role="row">
          <div><b className={`finance-document-side ${isCustomer ? "customer" : "supplier"}`}>{isCustomer ? "Cliente" : "Proveedor"}</b><strong>{financeLabel(document.documentNumber)}</strong><small>{financeLabel(document.partyName)}{document.partyRut ? ` · ${document.partyRut}` : ""}</small></div>
          <span className={`finance-document-status ${String(document.status).toLowerCase()}`}>{financeLabel(document.status)}</span>
          <span>{shortDate(document.issueDate)}</span>
          <div><strong>{isPaid ? "Registrado" : isCustomer ? "Pendiente de cobro" : "Pendiente de pago"}</strong><small>{isPaid ? `${money(document.paidAmount)} aplicado` : `Saldo ${money(document.balance)}`}</small></div>
          <b>{money(document.amount)}</b>
          <div className="finance-row-actions"><button className="secondary-btn finance-actions-trigger" type="button" aria-expanded={openActionId === actionId} onClick={() => onToggleActions(openActionId === actionId ? null : actionId)}>Acciones <span aria-hidden="true">⌄</span></button>{openActionId === actionId ? <div className="finance-actions-menu" role="menu"><button type="button" onClick={() => { onSelect(document); onToggleActions(null); }}>Ver detalle</button><button type="button" onClick={() => onCopy(document.documentNumber, "Folio copiado.")}>Copiar folio</button>{isCustomer ? <><button type="button" disabled={saving || isPaid} onClick={() => onRegisterReceipt(document)}>{isPaid ? "Cobro registrado" : "Registrar cobro"}</button><button type="button" disabled={saving || isPaid} onClick={() => onPrepareReminder(document)}>Preparar recordatorio</button><button type="button" onClick={onOpenCollections}>Abrir cobranza</button></> : <button type="button" onClick={onOpenPayables}>Ir a cuentas por pagar</button>}</div> : null}</div>
        </div>
        {showDetail ? <div className="finance-document-inline-detail"><FinanceDocumentDetail document={selectedDocument} onClose={onCloseDetail} /></div> : null}
      </div>;
    })}
  </div></div>;
}

function FinanceDocumentDetail({ document, onClose }: { document: FinanceDocument; onClose: () => void }) {
  return <section className="finance-document-detail" aria-label="Detalle del documento seleccionado"><div><span className="finance-eyebrow">Documento seleccionado</span><h3>{financeLabel(document.documentNumber)} · {financeLabel(document.partyName)}</h3><p>{document.side === "CUSTOMER" ? "Factura emitida a cliente" : "Documento recibido de proveedor"}{document.partyRut ? ` · RUT ${document.partyRut}` : ""}</p></div><div className="finance-document-detail-values"><span><small>Estado</small><b>{financeLabel(document.status)}</b></span><span><small>Emisión</small><b>{shortDate(document.issueDate)}</b></span><span><small>Saldo</small><b>{money(document.balance)}</b></span></div><button type="button" className="secondary-btn" onClick={onClose}>Cerrar detalle</button></section>;
}

function FinanceCollectionsTable({ portfolio, query, saving, openActionId, onToggleActions, onPrepareReminder, onOpenDocuments, onCopy }: { portfolio: FinanceCollectionPortfolioRow[]; query: string; saving: boolean; openActionId: string | null; onToggleActions: (id: string | null) => void; onPrepareReminder: (row: FinanceCollectionPortfolioRow) => void; onOpenDocuments: () => void; onCopy: (value: string, successMessage: string) => void }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visible = normalizedQuery ? portfolio.filter((item) => `${item.name} ${item.rut || ""}`.toLocaleLowerCase("es").includes(normalizedQuery)) : portfolio;
  if (!visible.length) return <p className="finance-empty">Aún no hay clientes con facturas registradas para construir la cartera de cobranza.</p>;
  return <div className="finance-collections-table-wrap"><div className="finance-collections-table" role="table" aria-label="Cartera de cobranza"><div className="finance-collections-table-head" role="row"><span>Razón social</span><span>Días promedio de pago</span><span>Último recordatorio</span><span>Factura más antigua</span><span>Recordatorios enviados</span><span>Documentos</span><span>Por vencer</span><span>Vencido</span><span>Total deudas</span><span>Acciones</span></div>{visible.map((row) => { const actionId = `collection-${row.key}`; return <div className="finance-collections-row" role="row" key={row.key}><div><strong>{financeLabel(row.name)}</strong><small>{row.rut || "Sin RUT registrado"}</small></div><span>{row.averagePaymentDays === null ? "Sin pagos" : `${row.averagePaymentDays} días`}</span><span>{row.lastReminderAt ? shortDate(row.lastReminderAt) : "Sin recordatorio"}</span><span>{shortDate(row.oldestInvoiceDate)}</span><span>{row.reminders ? `${row.reminders} preparado(s)` : "Sin enviar"}</span><span>{row.documents}<small>{row.overdueDocuments ? `${row.overdueDocuments} vencido(s)` : "Sin vencidos"}</small></span><b>{money(row.dueSoonAmount)}</b><b className={row.overdueAmount ? "is-overdue" : ""}>{money(row.overdueAmount)}</b><b>{money(row.totalDebt)}</b><div className="finance-row-actions"><button className="secondary-btn finance-actions-trigger" type="button" aria-expanded={openActionId === actionId} onClick={() => onToggleActions(openActionId === actionId ? null : actionId)}>Acciones <span aria-hidden="true">⌄</span></button>{openActionId === actionId ? <div className="finance-actions-menu" role="menu"><button type="button" onClick={onOpenDocuments}>Ver documentos</button><button type="button" disabled={saving || !row.totalDebt} onClick={() => onPrepareReminder(row)}>Preparar recordatorio</button>{row.rut ? <button type="button" onClick={() => onCopy(row.rut || "", "RUT copiado.")}>Copiar RUT</button> : null}</div> : null}</div></div>; })}</div></div>;
}

function FinanceTable({ records, kind, query = "" }: { records: IndustryRecord[]; kind: "invoice" | "movement" | "exception" | "collection"; query?: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleRecords = normalizedQuery ? records.filter((record) => `${record.title} ${JSON.stringify(asData(record))}`.toLocaleLowerCase("es").includes(normalizedQuery)) : records;
  if (!visibleRecords.length) return <p className="finance-empty">{records.length ? "No hay registros que coincidan con la búsqueda." : "Aún no hay registros en esta sección."}</p>;
  return <div className="finance-table">{visibleRecords.map((record) => { const data = asData(record); return <div key={record.id}><div><strong>{financeLabel(record.title)}</strong><span>{kind === "invoice" ? `${financeLabel(data.clientName)} · vence ${shortDate(data.dueDate)}` : kind === "movement" ? `${shortDate(data.date)} · ${financeLabel(data.reference, "Sin referencia")}` : financeLabel(data.type, financeLabel(data.detail, "Sin detalle"))}</span></div><b>{kind === "invoice" || kind === "movement" ? money(data.amount) : financeLabel(record.status)}</b></div>; })}</div>;
}

function PayablesTable({ records, query = "", saving, onRegisterPayment }: { records: IndustryRecord[]; query?: string; saving: boolean; onRegisterPayment: (record: IndustryRecord) => void }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleRecords = normalizedQuery ? records.filter((record) => `${record.title} ${JSON.stringify(asData(record))}`.toLocaleLowerCase("es").includes(normalizedQuery)) : records;
  if (!visibleRecords.length) return <p className="finance-empty">Aún no hay cuentas por pagar registradas.</p>;
  return <div className="finance-payables-table">{visibleRecords.map((record) => {
    const data = asData(record);
    const balance = amount(data.balance ?? data.amount);
    const status = financeLabel(record.status || data.status);
    return <article key={record.id}><div><strong>{financeLabel(data.supplierName, financeLabel(record.title))}</strong><span>{financeLabel(data.documentNumber, "Sin folio")} · vence {shortDate(data.dueDate)}</span><small>{financeLabel(data.category, "Sin categoría")}</small></div><div><small>Saldo</small><b className={status === "Vencida" ? "is-overdue" : ""}>{money(balance)}</b></div><span className={`finance-payable-status ${String(record.status || data.status || "OPEN").toLowerCase()}`}>{status}</span><button type="button" className="secondary-btn" disabled={saving || balance <= 0} onClick={() => onRegisterPayment(record)}>{balance <= 0 ? "Pagada" : "Registrar pago"}</button></article>;
  })}</div>;
}

function FinanceCycle({ overview, onSelect }: { overview: FinanceOverview; onSelect: (tab: FinanceTab) => void }) {
  const steps: Array<{ number: string; title: string; detail: string; tab: FinanceTab; value: string }> = [
    { number: "01", title: "Facturas", detail: "Monto facturado", tab: "facturas", value: money(overview.invoices.issued) },
    { number: "02", title: "Cartolas", detail: "Movimientos disponibles", tab: "cartolas", value: String(overview.reconciliation.totalMovements) },
    { number: "03", title: "Conciliación IA", detail: "Coincidencias para aprobar", tab: "conciliacion", value: `${overview.reconciliation.rate}%` },
    { number: "04", title: "Excepciones", detail: "Casos a revisar", tab: "excepciones", value: String(overview.exceptions.open) },
    { number: "05", title: "Cobranza", detail: "Promesas y seguimiento", tab: "cobranza", value: String(overview.collections.open) }
  ];
  return <section className="finance-cycle" aria-label="Ciclo de cuentas por cobrar"><div className="finance-cycle-intro"><span className="finance-eyebrow">Ciclo financiero</span><h2>Desde la factura hasta el cobro</h2><p>El equipo mantiene cada etapa trazable y siempre deja las decisiones sensibles para tu aprobacion.</p></div><div className="finance-cycle-steps">{steps.map((step) => <button key={step.tab} type="button" onClick={() => onSelect(step.tab)}><span>{step.number}</span><strong>{step.title}</strong><small>{step.detail}</small><b>{step.value}</b></button>)}</div></section>;
}
