"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  advanceBrokerOperation,
  createBrokerOperation,
  createBrokerRecord,
  confirmBrokerSaleCheckpoint,
  getBrokerCatalog,
  getBrokerAccess,
  getBrokerAccessTeam,
  getBrokerHoldingConfig,
  getBrokerFinancing,
  getBrokerLegalReadiness,
  getBrokerMonthlyAdministration,
  getBrokerOperatingConfiguration,
  getBrokerOperations,
  getBrokerOverview,
  getBrokerPropertyExpedient,
  getBrokerSaleWorkspace,
  getBrokerRecords,
  advanceBrokerFinancing,
  previewBrokerCommission,
  prepareBrokerMonthlyLiquidation,
  runBrokerAutomationScan,
  saveBrokerAiEvaluation,
  saveBrokerSaleWorkspace,
  saveBrokerOperatingConfiguration,
  saveBrokerHoldingConfig,
  updateBrokerRecord,
  updateBrokerAccessProfile,
  updateBrokerMonthlyLiquidationStatus,
  type BrokerCatalog,
  type BrokerAiScenario,
  type BrokerOperation,
  type BrokerOperationType,
  type BrokerSaleWorkspace,
  type BrokerPropertyExpedient,
  type BrokerRecordArea,
  type BrokerRecordDefinition,
  type BrokerCommissionPreview,
  type BrokerMonthlyAdministration,
  type BrokerMonthlyAdministrationRow,
  type BrokerOperatingConfiguration,
  type BrokerLegalReadiness,
  type BrokerAccessProfile,
  type BrokerAccessTeamMember,
  type BrokerHoldingConfig,
  type IndustryRecord
} from "@/lib/api";

type Tab = "operations" | "agents" | "training" | "commissions" | "administration_preview" | "guides" | "configuration" | "compliance" | "access" | BrokerRecordArea;
type FieldConfig = { label: string; type?: "text" | "number" | "date" | "textarea"; placeholder?: string };

const OPERATION_LABELS: Record<BrokerOperationType, string> = {
  SALE: "Venta",
  RENTAL: "Arriendo",
  ADMINISTRATION: "Administración"
};

const BROKER_BUSINESS_ROLE_OPTIONS = [
  ["CEO", "Dirección general"], ["GERENTE_COMERCIAL", "Gerencia comercial"], ["COORDINADOR_COMERCIAL", "Coordinación comercial"], ["CORREDOR", "Corredor"], ["CAPTADOR", "Captador"], ["MARKETING", "Marketing"], ["TASADOR", "Tasador"], ["JURIDICO", "Jurídico"], ["ADMINISTRACION", "Administración"], ["FINANZAS", "Finanzas"], ["POSTVENTA", "Postventa"], ["LECTURA", "Solo lectura"],
] as const;
const BROKER_SCOPE_OPTIONS = [["ASSIGNED", "Solo registros asignados"], ["TEAM", "Mi equipo"], ["BRANCH", "Mi sucursal"], ["COMPANY", "Toda la empresa"], ["HOLDING", "Empresas autorizadas del holding"]] as const;
const FINANCING_TERMINAL_STAGES = new Set(["CIERRE", "RECHAZADO", "CANCELADO"]);
const ADMINISTRATION_LIQUIDATION_STAGES = ["DRAFT", "PENDING_APPROVAL", "ISSUED", "PAID"] as const;

function financingActionForStage(stage: string) {
  const normalized = String(stage || "").trim().toUpperCase();
  if (["RECHAZADO", "CANCELADO"].includes(normalized)) return "REJECT";
  if (["APROBACION", "DESEMBOLSO", "LIQUIDACION", "CIERRE"].includes(normalized)) return "APPROVE";
  return "EDIT";
}

function administrationActionForStage(stage: string) {
  const normalized = String(stage || "").trim().toUpperCase();
  return ["ISSUED", "PAID"].includes(normalized) ? "APPROVE" : "EDIT";
}

const AREA_CONFIG: Record<BrokerRecordArea, { label: string; description: string }> = {
  commercial: { label: "Comercial y cierre", description: "Tasaciones, mandatos, ofertas, promesas y liquidaciones de comision." },
  rentals: { label: "Arriendos y administracion", description: "Postulaciones, contratos, cobros y liquidaciones de administracion." },
  maintenance: { label: "Mantencion y proveedores", description: "Incidencias, proveedores, cotizaciones y compras asociadas a la propiedad." },
  projects: { label: "Proyectos y publicacion", description: "Remodelaciones, presupuestos, hitos y publicaciones comerciales." },
  post_sale: { label: "Postventa y garantias", description: "Inspecciones, entregas, casos de postventa y garantias." },
  documents: { label: "Expediente y documentos", description: "Documentos de la propiedad, antecedentes legales y firmas digitales." },
  financing: { label: "Financiamiento", description: "Solicitudes de financiamiento y gastos asociados a cada operacion." }
};

const FIELD_CONFIG: Record<string, FieldConfig> = {
  propertyId: { label: "Propiedad asociada" },
  ownerName: { label: "Propietario o mandante", placeholder: "Nombre o razon social" },
  startDate: { label: "Fecha de inicio", type: "date" },
  estimatedValue: { label: "Valor estimado", type: "number", placeholder: "Ej.: 185000000" },
  currency: { label: "Moneda", placeholder: "Ej.: CLP" },
  endDate: { label: "Fecha de término", type: "date" },
  exclusivityMonths: { label: "Meses de exclusividad", type: "number", placeholder: "Ej.: 6" },
  commissionRatePct: { label: "Comisión (%)", type: "number", placeholder: "Ej.: 2" },
  buyerName: { label: "Comprador o interesado", placeholder: "Nombre o empresa" },
  offerDate: { label: "Fecha de oferta", type: "date" },
  financingType: { label: "Tipo de financiamiento", placeholder: "Ej.: Crédito hipotecario" },
  agreedAmount: { label: "Monto acordado", type: "number", placeholder: "Ej.: 180000000" },
  penaltyRatePct: { label: "Multa acordada (%)", type: "number", placeholder: "Ej.: 10" },
  baseAmount: { label: "Base de cálculo", type: "number", placeholder: "Ej.: 180000000" },
  brokerSplitPct: { label: "Parte del corredor (%)", type: "number", placeholder: "Ej.: 50" },
  companySplitPct: { label: "Parte de la empresa (%)", type: "number", placeholder: "Ej.: 50" },
  brokerAmount: { label: "Monto corredor", type: "number", placeholder: "Ej.: 1800000" },
  companyAmount: { label: "Monto empresa", type: "number", placeholder: "Ej.: 1800000" },
  settlementDate: { label: "Fecha de liquidación", type: "date" },
  amount: { label: "Monto", type: "number", placeholder: "Ej.: 2500000" },
  signingDate: { label: "Fecha de firma", type: "date" },
  tenantName: { label: "Arrendatario", placeholder: "Nombre o razon social" },
  monthlyRent: { label: "Arriendo mensual", type: "number", placeholder: "Ej.: 750000" },
  taxEvaluation: { label: "Evaluación tributaria", placeholder: "Ej.: Aprobada / pendiente" },
  commercialEvaluation: { label: "Evaluación comercial", placeholder: "Ej.: Aprobada / pendiente" },
  paymentDay: { label: "Día de pago", type: "number", placeholder: "Ej.: 5" },
  depositAmount: { label: "Garantía", type: "number", placeholder: "Ej.: 750000" },
  managementRatePct: { label: "Administración (%)", type: "number", placeholder: "Ej.: 8" },
  ownerPaymentDay: { label: "Día de pago al propietario", type: "number", placeholder: "Ej.: 10" },
  ownerBankAccount: { label: "Cuenta del propietario", placeholder: "Banco y cuenta informada" },
  utilityType: { label: "Tipo de servicio", placeholder: "Ej.: Gastos comunes, agua, electricidad" },
  accountNumber: { label: "Número de cuenta", placeholder: "Número de cliente o cuenta" },
  managementFee: { label: "Honorario de administración", type: "number", placeholder: "Ej.: 60000" },
  ownerTransferAmount: { label: "Monto a transferir al propietario", type: "number", placeholder: "Ej.: 690000" },
  transferDate: { label: "Fecha estimada de transferencia", type: "date" },
  dueDate: { label: "Fecha de vencimiento", type: "date" },
  period: { label: "Periodo", placeholder: "Ej.: Agosto 2026" },
  category: { label: "Categoria", placeholder: "Ej.: Electricidad, gasfiteria" },
  description: { label: "Descripcion", type: "textarea", placeholder: "Describe el trabajo, alcance o antecedente relevante" },
  providerName: { label: "Proveedor", placeholder: "Nombre o razon social" },
  specialty: { label: "Especialidad", placeholder: "Ej.: Pintura, mantencion, fotografia" },
  supplierName: { label: "Proveedor o comercio", placeholder: "Nombre o razon social" },
  projectType: { label: "Tipo de proyecto", placeholder: "Ej.: Remodelacion de cocina" },
  budget: { label: "Presupuesto", type: "number", placeholder: "Ej.: 4000000" },
  milestoneDate: { label: "Fecha del hito", type: "date" },
  channel: { label: "Canal de publicacion", placeholder: "Ej.: Portal, Instagram, sitio web" },
  publicationStatus: { label: "Estado de publicacion", placeholder: "Ej.: Borrador, publicado" },
  inspectionDate: { label: "Fecha de inspeccion", type: "date" },
  checklist: { label: "Lista de revision", type: "textarea", placeholder: "Estado general, fotos, inventario y observaciones" },
  handoverDate: { label: "Fecha de entrega", type: "date" },
  recipientName: { label: "Quien recibe", placeholder: "Nombre de quien recibe la propiedad" },
  warrantyUntil: { label: "Garantia vigente hasta", type: "date" },
  documentType: { label: "Tipo de documento", placeholder: "Ej.: Escritura, cedula, certificado, acta" },
  signerName: { label: "Persona que firma", placeholder: "Nombre de firmante" },
  subjectName: { label: "Titular o persona autorizante", placeholder: "Nombre completo o razón social" },
  subjectRole: { label: "Rol de la persona", placeholder: "Ej.: Propietario, comprador, arrendatario" },
  consentPurpose: { label: "Finalidad autorizada", type: "textarea", placeholder: "Ej.: Evaluación comercial y gestión de la propiedad" },
  acceptedAt: { label: "Fecha de aceptación", type: "date" },
  evidenceReference: { label: "Referencia de evidencia", placeholder: "ID de documento, correo o respaldo verificable" },
  channels: { label: "Canales autorizados", placeholder: "Ej.: Correo, WhatsApp" },
  purpose: { label: "Destino del financiamiento", placeholder: "Ej.: Pie, remodelacion, credito hipotecario" },
  requestedAmount: { label: "Monto solicitado", type: "number", placeholder: "Ej.: 50000000" },
  financingId: { label: "ID de financiamiento", placeholder: "Copia el identificador de la solicitud" },
  concept: { label: "Concepto", placeholder: "Ej.: Tasacion, notaria, estudio de titulos" }
};

const VISIBLE_STATUS_LABELS: Record<string, string> = {
  SALE: "Venta",
  RENTAL: "Arriendo",
  ADMINISTRATION: "Administración",
  LEAD: "Contacto inicial",
  CONTACT: "Contactado",
  QUALIFIED: "Calificado",
  VISIT_SCHEDULED: "Visita agendada",
  OFFER: "Oferta",
  NEGOTIATION: "Negociación",
  CLOSING: "Cierre",
  POSTSALE: "Postventa",
  CAPTACION: "Captación",
  TASACION: "Tasación",
  MANDATO: "Mandato",
  PUBLICACION: "Publicación",
  CALIFICACION: "Calificación",
  VISITA: "Visita",
  NEGOCIACION: "Negociación",
  PROMESA: "Promesa",
  ESCRITURA: "Escritura",
  POSTVENTA: "Postventa",
  POSTULACION: "Postulación",
  EVALUACION: "Evaluación",
  APROBACION: "Aprobación",
  CONTRATO: "Contrato",
  ENTREGA: "Entrega",
  ARRENDADO: "Arrendado",
  RENOVACION: "Renovación",
  INCORPORACION: "Incorporación",
  COBRO: "Cobro",
  LIQUIDACION: "Liquidación",
  DRAFT: "Borrador",
  REVIEW: "En revisión",
  APPROVED: "Aprobado",
  PENDING_SIGNATURE: "Pendiente de firma",
  SIGNED: "Firmado",
  EXPIRED: "Vencido",
  SUBMITTED: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazado",
  WITHDRAWN: "Retirada",
  RECEIVED: "Recibida",
  UNDER_REVIEW: "En revisión",
  ACTIVE: "Activo",
  ENDING: "Por finalizar",
  ENDED: "Finalizado",
  PENDING: "Pendiente",
  PAID: "Pagado",
  OVERDUE: "Vencido",
  WAIVED: "Eximido",
  PENDING_APPROVAL: "Pendiente de aprobación",
  ISSUED: "Emitida",
  REPORTED: "Reportada",
  QUOTING: "En cotización",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  SUSPENDED: "Suspendido",
  ARCHIVED: "Archivado",
  PLANNED: "Planificado",
  ON_HOLD: "En pausa",
  PUBLISHED: "Publicado",
  PAUSED: "Pausado",
  SCHEDULED: "Programada",
  REQUIRES_ACTION: "Requiere acción",
  OPEN: "Abierto",
  WAITING_PROVIDER: "Esperando proveedor",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
  DIAGNOSIS: "Diagnóstico",
  LEGAL_CHECK: "Revisión legal",
  ESTIMATING: "En evaluación",
  REQUESTED: "Solicitado",
  DISBURSED: "Desembolsado",
  SETTLED: "Liquidado",
  RECONCILED: "Conciliado"
  ,EVALUACION_COMERCIAL: "Evaluación comercial", MANDATO_Y_PUBLICACION: "Mandato y publicación", CALIFICACION_Y_VISITAS: "Calificación y visitas", OFERTA_Y_NEGOCIACION: "Oferta y negociación", ESTUDIO_DE_TITULO: "Estudio de título", INSCRIPCION_CBR: "Inscripción en CBR", ENTREGA_Y_POSTVENTA: "Entrega y postventa", DEFINICION_DE_PRECIO: "Definición de precio", EXCLUSIVIDAD: "Exclusividad", PREPARACION_INMUEBLE: "Preparación del inmueble", GENERACION_DE_LEADS: "Generación de interesados", EVALUACION_ARRENDATARIO: "Evaluación de arrendatario", RESERVA: "Reserva", PAGO_INICIAL: "Pago inicial", ENTREGA_LLAVES: "Entrega de llaves", REVISION_MENSUAL: "Revisión mensual", COBRO_Y_CONCILIACION: "Cobro y conciliación", LIQUIDACION_Y_TRANSFERENCIA: "Liquidación y transferencia", MANTENCIONES_Y_SERVICIOS: "Mantenciones y servicios", LISTA_PARA_OPERAR: "Lista para operar", EN_PREPARACION: "En preparación", INCOMPLETA: "Incompleta"
};

function readable(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "Sin información";
  return VISIBLE_STATUS_LABELS[raw.toUpperCase()]
    || raw.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function stageIndex(operation: BrokerOperation, catalog: BrokerCatalog | null) {
  const stages = catalog?.operationStages[operation.data.operationType] || [];
  const index = stages.indexOf(String(operation.data.stage || "").toUpperCase());
  return Math.max(0, index);
}

function recordSummary(record: IndustryRecord, definition?: BrokerRecordDefinition) {
  const data = record.data as Record<string, unknown>;
  const keys = (definition?.required || []).filter((key) => key !== "propertyId").slice(0, 2);
  const values = keys.map((key) => String(data[key] || "").trim()).filter(Boolean);
  return values.length ? values.join(" · ") : "Sin datos adicionales";
}

export function BrokerOperationsPageContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("operations");
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getBrokerOverview>> | null>(null);
  const [catalog, setCatalog] = useState<BrokerCatalog | null>(null);
  const [operations, setOperations] = useState<BrokerOperation[]>([]);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [financingRecords, setFinancingRecords] = useState<IndustryRecord[]>([]);
  const [financingExpenses, setFinancingExpenses] = useState<IndustryRecord[]>([]);
  const [financingNotes, setFinancingNotes] = useState<Record<string, string>>({});
  const [properties, setProperties] = useState<IndustryRecord[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [expedient, setExpedient] = useState<BrokerPropertyExpedient | null>(null);
  const [saleWorkspace, setSaleWorkspace] = useState<BrokerSaleWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [operationType, setOperationType] = useState<BrokerOperationType>("SALE");
  const [recordType, setRecordType] = useState("");
  const [selectedScenarioKey, setSelectedScenarioKey] = useState("");
  const [evaluationNote, setEvaluationNote] = useState("");
  const [commissionPreview, setCommissionPreview] = useState<BrokerCommissionPreview | null>(null);
  const [monthlyAdministration, setMonthlyAdministration] = useState<BrokerMonthlyAdministration | null>(null);
  const [administrationPeriod, setAdministrationPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [administrationNotes, setAdministrationNotes] = useState<Record<string, string>>({});
  const [operatingConfiguration, setOperatingConfiguration] = useState<BrokerOperatingConfiguration | null>(null);
  const [legalReadiness, setLegalReadiness] = useState<BrokerLegalReadiness | null>(null);
  const [access, setAccess] = useState<BrokerAccessProfile | null>(null);
  const [accessTeam, setAccessTeam] = useState<BrokerAccessTeamMember[]>([]);
  const [holdingConfig, setHoldingConfig] = useState<BrokerHoldingConfig | null>(null);

  const load = useCallback(async () => {
    const [nextOverview, nextOperations, nextCatalog, nextConfiguration, nextLegalReadiness, nextAccess, nextAccessTeam, nextHolding] = await Promise.all([
      getBrokerOverview(), getBrokerOperations(), getBrokerCatalog(), getBrokerOperatingConfiguration().catch(() => null), getBrokerLegalReadiness().catch(() => null), getBrokerAccess(), getBrokerAccessTeam().catch(() => ({ users: [] })), getBrokerHoldingConfig().catch(() => null)
    ]);
    setOverview(nextOverview);
    setOperations(nextOperations);
    setProperties(nextOverview.properties);
    setCatalog(nextCatalog);
    setOperatingConfiguration(nextConfiguration);
    setLegalReadiness(nextLegalReadiness);
    setAccess(nextAccess);
    setAccessTeam(nextAccessTeam.users);
    setHoldingConfig(nextHolding);
  }, []);

  useEffect(() => {
    load().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar Broker OS."));
  }, [load]);

  // El menú EV puede abrir un área concreta del workspace sin montar una
  // segunda pantalla de documentos, arriendos o postventa. Así el expediente
  // sigue siendo la fuente oficial de esos antecedentes por propiedad.
  useEffect(() => {
    const requestedArea = searchParams.get("area");
    const requestedTab = searchParams.get("tab");
    if (requestedArea && Object.prototype.hasOwnProperty.call(AREA_CONFIG, requestedArea)) {
      setTab(requestedArea as BrokerRecordArea);
      return;
    }
    if (requestedTab === "agents" || requestedTab === "training" || requestedTab === "operations" || requestedTab === "commissions" || requestedTab === "administration_preview" || requestedTab === "guides" || requestedTab === "configuration" || requestedTab === "compliance" || requestedTab === "access") {
      setTab(requestedTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (tab === "financing") {
      Promise.all([getBrokerFinancing(), getBrokerRecords("financing")]).then(([requests, allRecords]) => {
        setFinancingRecords(requests);
        setFinancingExpenses(allRecords.filter((record) => record.recordType === "operation_financing_expense"));
      }).catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar el financiamiento."));
      return;
    }
    if (tab === "administration_preview") {
      getBrokerMonthlyAdministration(administrationPeriod).then(setMonthlyAdministration).catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar la administración mensual."));
      return;
    }
    if (tab === "operations" || tab === "agents" || tab === "training" || tab === "commissions" || tab === "guides" || tab === "configuration" || tab === "compliance" || tab === "access") return;
    setRecords([]);
    getBrokerRecords(tab).then(setRecords).catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar el expediente."));
  }, [tab, administrationPeriod]);

  useEffect(() => {
    if (!catalog || tab === "financing" || tab === "operations" || tab === "agents" || tab === "training" || tab === "commissions" || tab === "administration_preview" || tab === "guides" || tab === "configuration" || tab === "compliance" || tab === "access") return;
    const options = catalog.areas[tab] || [];
    setRecordType((current) => options.includes(current) ? current : options[0] || "");
  }, [catalog, tab]);

  const summary = useMemo(() => overview?.kpis || {
    properties: 0, activeOperations: 0, scheduledVisits: 0, openAlerts: 0,
    activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0
  }, [overview]);
  const recommendations = overview?.recommendations || [];
  const currentArea = tab !== "financing" && tab !== "operations" && tab !== "agents" && tab !== "training" && tab !== "commissions" && tab !== "administration_preview" && tab !== "guides" && tab !== "configuration" && tab !== "compliance" && tab !== "access" ? tab : null;
  const currentDefinition = recordType ? catalog?.recordDefinitions[recordType] : undefined;
  const currentTypes = currentArea && catalog ? catalog.areas[currentArea] || [] : [];
  const operationStages = catalog?.operationStages[operationType] || [];
  const scenarios = overview?.aiTraining?.scenarios || catalog?.aiScenarios || [];
  const evaluations = overview?.aiTraining?.evaluations || [];
  const automationRules = overview?.aiTraining?.automationRules || catalog?.automationRules || [];
  const financingStages = catalog?.financingStages || [];
  const financingRequestedTotal = financingRecords.reduce((sum, record) => sum + Number((record.data as Record<string, unknown>).requestedAmount || 0), 0);
  const financingInReview = financingRecords.filter((record) => !FINANCING_TERMINAL_STAGES.has(String(record.status || (record.data as Record<string, unknown>).stage || "").toUpperCase())).length;
  const financingExpensesTotal = financingExpenses.reduce((sum, record) => sum + Number((record.data as Record<string, unknown>).amount || 0), 0);
  const canFinanceAction = (action: string) => {
    if (!access) return false;
    if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(access.technicalRole)) return true;
    const allowed = access.policy.actions.financing || access.policy.actions["*"] || [];
    return allowed.includes(action);
  };
  const canAdministrationAction = (action: string) => {
    if (!access) return false;
    if (["SUPER_ADMIN", "OWNER", "ADMIN"].includes(access.technicalRole)) return true;
    const allowed = access.policy.actions.administration || access.policy.actions["*"] || [];
    return allowed.includes(action);
  };
  const selectedScenario = scenarios.find((scenario) => scenario.key === selectedScenarioKey) || scenarios[0];
  const reporting = overview?.reporting;

  useEffect(() => {
    if (!selectedScenarioKey && scenarios[0]?.key) setSelectedScenarioKey(scenarios[0].key);
  }, [scenarios, selectedScenarioKey]);

  async function createOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setBusy(true); setNotice("");
    try {
      await createBrokerOperation({
        title,
        operationType,
        propertyId: String(form.get("propertyId") || "") || undefined,
        data: { clientName: String(form.get("clientName") || ""), notes: String(form.get("notes") || "") }
      });
      event.currentTarget.reset();
      await load();
      setNotice("Operacion creada. La primera etapa quedo registrada en su linea de tiempo.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo crear la operacion.");
    } finally { setBusy(false); }
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentDefinition || !recordType || !currentArea) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    const data = Object.fromEntries(currentDefinition.required.map((key) => [key, String(form.get(key) || "").trim()]));
    setBusy(true); setNotice("");
    try {
      await createBrokerRecord({ recordType, title, status: currentDefinition.statuses[0], data });
      event.currentTarget.reset();
      setRecords(await getBrokerRecords(currentArea));
      setNotice("Registro guardado en el expediente de la propiedad.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar el registro.");
    } finally { setBusy(false); }
  }

  async function nextStage(operation: BrokerOperation) {
    const index = stageIndex(operation, catalog);
    const next = (catalog?.operationStages[operation.data.operationType] || [])[index + 1];
    if (!next) return setNotice("Esta operacion ya completo su flujo. Puedes abrir postventa o crear una nueva operacion.");
    setBusy(true); setNotice("");
    try {
      await advanceBrokerOperation(operation.id, { stage: next, note: `Avance confirmado a ${readable(next)}.` });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo avanzar la etapa.");
    } finally { setBusy(false); }
  }

  async function openSaleWorkspace(operation: BrokerOperation) {
    setBusy(true); setNotice("");
    try {
      setSaleWorkspace(await getBrokerSaleWorkspace(operation.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo abrir el expediente de venta.");
    } finally { setBusy(false); }
  }

  async function saveSaleWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saleWorkspace) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || "").trim();
    const number = (name: string) => value(name) === "" ? null : Number(value(name));
    setBusy(true); setNotice("");
    try {
      const updated = await saveBrokerSaleWorkspace(saleWorkspace.operation.id, {
        buyerName: value("buyerName"),
        buyerQualificationStatus: value("buyerQualificationStatus"),
        preapprovalBank: value("preapprovalBank"),
        preapprovalAmount: number("preapprovalAmount"),
        preapprovalExpiresAt: value("preapprovalExpiresAt") || null,
        offerAmount: number("offerAmount"),
        offerStatus: value("offerStatus"),
        offerReceivedAt: value("offerReceivedAt") || null,
        offerRespondedAt: value("offerRespondedAt") || null,
        offerConditions: value("offerConditions"),
        promiseStatus: value("promiseStatus"),
        promiseSignedAt: value("promiseSignedAt") || null,
        promiseAmount: number("promiseAmount"),
        promisePenaltyPct: number("promisePenaltyPct"),
        titleStudyStatus: value("titleStudyStatus"),
        titleStudyNotes: value("titleStudyNotes"),
        financingStatus: value("financingStatus"),
        bankAppraisalStatus: value("bankAppraisalStatus"),
        deedStatus: value("deedStatus"),
        deedScheduledAt: value("deedScheduledAt") || null,
        deedSignedAt: value("deedSignedAt") || null,
        cbrStatus: value("cbrStatus"),
        cbrEntryNumber: value("cbrEntryNumber"),
        cbrRegisteredAt: value("cbrRegisteredAt") || null,
        handoverStatus: value("handoverStatus"),
        handoverAt: value("handoverAt") || null,
        handoverRecipient: value("handoverRecipient"),
      });
      setSaleWorkspace(updated);
      await load();
      setNotice("Expediente de venta guardado. Los cambios no ejecutan firmas, pagos ni inscripciones externas.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar el expediente de venta.");
    } finally { setBusy(false); }
  }

  async function confirmSaleCheckpoint(checkpoint: "oferta" | "promesa" | "titulos" | "escritura" | "inscripcion" | "entrega") {
    if (!saleWorkspace) return;
    setBusy(true); setNotice("");
    try {
      const updated = await confirmBrokerSaleCheckpoint(saleWorkspace.operation.id, { checkpoint, note: "Revisión humana confirmada desde el expediente de venta." });
      setSaleWorkspace(updated);
      setNotice("Revisión humana registrada en la trazabilidad de la venta.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo confirmar la revisión humana.");
    } finally { setBusy(false); }
  }

  async function setRecordStatus(record: IndustryRecord, status: string) {
    if (!currentArea) return;
    setBusy(true); setNotice("");
    try {
      await updateBrokerRecord(record.id, { status });
      setRecords(await getBrokerRecords(currentArea));
      setNotice("Estado del registro actualizado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
    } finally { setBusy(false); }
  }

  async function openExpedient() {
    if (!selectedPropertyId) return setNotice("Selecciona una propiedad para revisar su expediente.");
    setBusy(true); setNotice("");
    try {
      setExpedient(await getBrokerPropertyExpedient(selectedPropertyId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo abrir el expediente de esta propiedad.");
    } finally { setBusy(false); }
  }

  async function saveEvaluation(decision: "CONFIRMED" | "ADJUSTMENT_NEEDED" | "DISCARDED") {
    if (!selectedScenario) return;
    setBusy(true); setNotice("");
    try {
      await saveBrokerAiEvaluation({
        scenarioKey: selectedScenario.key,
        decision,
        outcome: `Revisión humana registrada para: ${selectedScenario.title}.`,
        note: evaluationNote
      });
      setEvaluationNote("");
      await load();
      setNotice("La evaluación quedó registrada. La sugerencia no ejecutó acciones sobre la cartera.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar la evaluación del agente.");
    } finally { setBusy(false); }
  }

  async function calculateCommission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try {
      const preview = await previewBrokerCommission({
        baseAmount: Number(form.get("baseAmount") || 0), commissionRatePct: Number(form.get("commissionRatePct") || 0),
        brokerSplitPct: Number(form.get("brokerSplitPct") || 0), companySplitPct: Number(form.get("companySplitPct") || 0)
      });
      setCommissionPreview(preview);
      setNotice("Vista previa calculada. No se creó ninguna liquidación ni pago.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo calcular la comisión."); }
    finally { setBusy(false); }
  }

  async function refreshMonthlyAdministration() {
    const snapshot = await getBrokerMonthlyAdministration(administrationPeriod);
    setMonthlyAdministration(snapshot);
    await load();
  }

  async function prepareMonthlyLiquidation(row: BrokerMonthlyAdministrationRow, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try {
      await prepareBrokerMonthlyLiquidation({
        propertyId: row.propertyId,
        period: administrationPeriod,
        monthlyRent: Number(form.get("monthlyRent") || row.monthlyRent),
        paidAmount: Number(form.get("paidAmount") || row.paidAmount),
        commonExpenses: Number(form.get("commonExpenses") || row.commonExpenses),
        utilities: Number(form.get("utilities") || row.utilities),
        maintenanceCost: Number(form.get("maintenanceCost") || row.maintenanceCost),
        managementRatePct: Number(form.get("managementRatePct") || row.managementRatePct),
      });
      await refreshMonthlyAdministration();
      setNotice(`Liquidación de ${row.propertyTitle} preparada para revisión humana.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo preparar la liquidación mensual."); }
    finally { setBusy(false); }
  }

  async function moveMonthlyLiquidation(row: BrokerMonthlyAdministrationRow, status: "PENDING_APPROVAL" | "ISSUED" | "PAID") {
    if (!row.liquidation) return;
    setBusy(true); setNotice("");
    try {
      const note = administrationNotes[row.liquidation.id]?.trim() || `Estado confirmado: ${readable(status)}.`;
      await updateBrokerMonthlyLiquidationStatus(row.liquidation.id, { status, note });
      setAdministrationNotes((current) => ({ ...current, [row.liquidation!.id]: "" }));
      await refreshMonthlyAdministration();
      setNotice(`Liquidación actualizada a ${readable(status)}. No se ejecutó ninguna transferencia.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo actualizar la liquidación mensual."); }
    finally { setBusy(false); }
  }

  async function executeAutomationScan() {
    setBusy(true); setNotice("");
    try {
      const result = await runBrokerAutomationScan();
      await load();
      setNotice(result.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo ejecutar la revisión automática."); }
    finally { setBusy(false); }
  }

  async function saveOperatingConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = operatingConfiguration?.policy;
    if (!current) return;
    setBusy(true); setNotice("");
    try {
      const saved = await saveBrokerOperatingConfiguration({
        ...current,
        sales: { sellerCommissionPct: Number(form.get("sellerCommissionPct")), buyerCommissionPct: Number(form.get("buyerCommissionPct")), brokerSplitPct: Number(form.get("brokerSplitPct")), companySplitPct: Number(form.get("companySplitPct")) },
        rentalPlacement: { landlordMonths: Number(form.get("landlordMonths")), tenantMonths: Number(form.get("tenantMonths")), withholdingRatePct: String(form.get("withholdingRatePct") || "").trim() ? Number(form.get("withholdingRatePct")) : null },
        administration: { ownerPaymentDay: Number(form.get("ownerPaymentDay")), tiers: current.administration.tiers.map((tier, index) => index === 0 ? { ...tier, ratePct: Number(form.get("adminRate1")) } : index === 1 ? { ...tier, ratePct: Number(form.get("adminRate2")) } : tier) },
        slas: { firstLeadContactMinutes: Number(form.get("firstLeadContactMinutes")), propertyPublicationHours: Number(form.get("propertyPublicationHours")), legalReviewHours: Number(form.get("legalReviewHours")), criticalIncidentHours: Number(form.get("criticalIncidentHours")) },
        financing: { ...current.financing, interestRatePct: String(form.get("interestRatePct") || "").trim() ? Number(form.get("interestRatePct")) : null, riskThreshold: String(form.get("riskThreshold") || "").trim() ? Number(form.get("riskThreshold")) : null, requiresHumanApproval: true, automaticDisbursement: false }
      });
      setOperatingConfiguration(saved);
      setNotice("Configuración guardada. Los parámetros no ejecutan cobros, pagos, financiamiento ni comunicaciones de manera automática.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo guardar la configuración."); }
    finally { setBusy(false); }
  }

  async function saveAccessProfile(user: BrokerAccessTeamMember, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try {
      await updateBrokerAccessProfile(user.id, {
        businessRole: String(form.get("businessRole") || user.profile.businessRole),
        accessScope: String(form.get("accessScope") || user.profile.accessScope),
        teamKey: String(form.get("teamKey") || "").trim(),
        branchKey: String(form.get("branchKey") || "").trim(),
      });
      const next = await getBrokerAccessTeam();
      setAccessTeam(next.users);
      setNotice(`Acceso actualizado para ${user.name}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo actualizar el acceso."); }
    finally { setBusy(false); }
  }

  async function saveHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdingConfig?.canConfigure) return;
    const form = new FormData(event.currentTarget);
    const tenantSlugs = Array.from(form.getAll("tenantSlugs")).map(String);
    const userIds = Array.from(form.getAll("holdingUserIds")).map(String);
    setBusy(true); setNotice("");
    try {
      await saveBrokerHoldingConfig({ code: String(form.get("holdingCode") || "").trim(), name: String(form.get("holdingName") || "").trim(), tenantSlugs, userIds });
      setHoldingConfig(await getBrokerHoldingConfig());
      setNotice("Holding configurado. El acceso entre empresas seguirá requiriendo el alcance Holding y autorización explícita.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo guardar el holding."); }
    finally { setBusy(false); }
  }

  async function refreshFinancing() {
    const [requests, allRecords] = await Promise.all([getBrokerFinancing(), getBrokerRecords("financing")]);
    setFinancingRecords(requests);
    setFinancingExpenses(allRecords.filter((record) => record.recordType === "operation_financing_expense"));
    await load();
  }

  async function createFinancing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const propertyId = String(form.get("propertyId") || "").trim();
    const purpose = String(form.get("purpose") || "").trim();
    const requestedAmount = String(form.get("requestedAmount") || "").trim();
    if (!title || !propertyId || !purpose || !requestedAmount) return;
    setBusy(true); setNotice("");
    try {
      await createBrokerRecord({
        recordType: "operation_financing",
        title,
        propertyId,
        data: {
          propertyId,
          purpose,
          requestedAmount,
          buyerName: String(form.get("buyerName") || "").trim(),
          financingType: String(form.get("financingType") || "").trim(),
          institution: String(form.get("institution") || "").trim(),
          estimatedExpenses: String(form.get("estimatedExpenses") || "").trim(),
        }
      });
      event.currentTarget.reset();
      await refreshFinancing();
      setNotice("Solicitud registrada en diagnóstico financiero. No se realizó ninguna evaluación crediticia, aprobación ni desembolso.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo registrar la solicitud de financiamiento.");
    } finally { setBusy(false); }
  }

  async function createFinancingExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const financingId = String(form.get("financingId") || "").trim();
    const concept = String(form.get("concept") || "").trim();
    const amount = String(form.get("amount") || "").trim();
    if (!financingId || !concept || !amount) return;
    setBusy(true); setNotice("");
    try {
      await createBrokerRecord({
        recordType: "operation_financing_expense",
        title: String(form.get("title") || concept).trim(),
        data: { financingId, concept, amount, dueDate: String(form.get("dueDate") || "").trim(), notes: String(form.get("notes") || "").trim() }
      });
      event.currentTarget.reset();
      await refreshFinancing();
      setNotice("Gasto asociado registrado. Requiere revisión humana antes de aprobar o pagar.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo registrar el gasto asociado.");
    } finally { setBusy(false); }
  }

  async function moveFinancingStage(record: IndustryRecord, stage: string) {
    setBusy(true); setNotice("");
    try {
      const note = financingNotes[record.id]?.trim() || `Etapa confirmada: ${readable(stage)}.`;
      await advanceBrokerFinancing(record.id, stage, note);
      setFinancingNotes((current) => ({ ...current, [record.id]: "" }));
      await refreshFinancing();
      setNotice(`Financiamiento actualizado a ${readable(stage)}. La trazabilidad quedó registrada.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar la etapa del financiamiento.");
    } finally { setBusy(false); }
  }

  return <main className="broker-os-workspace">
    <header className="broker-os-header">
      <div>
        <span>Broker OS</span><h1>Centro operativo inmobiliario</h1>
        <p>Controla venta, arriendo, administracion, documentos, mantenciones y postventa desde expedientes separados por propiedad.</p>
      </div>
      {access ? <aside className="broker-access-summary" aria-label="Alcance de tu acceso"><span>Tu acceso</span><b>{access.profileLabel}</b><p>{access.scopeDescription}</p></aside> : null}
      <div className="broker-kpis">
        <b>{summary.properties}<small>propiedades</small></b>
        <b>{summary.activeOperations}<small>operaciones activas</small></b>
        <b>{summary.activeRentals}<small>arriendos vigentes</small></b>
        <b>{summary.activeFinancing}<small>financiamientos</small></b>
      </div>
    </header>

    <nav className="broker-os-tabs" aria-label="Areas de Broker OS">
      <button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}>Operaciones</button>
      {Object.entries(AREA_CONFIG).map(([key, value]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key as BrokerRecordArea)}>{value.label}</button>)}
      <button className={tab === "commissions" ? "active" : ""} onClick={() => setTab("commissions")}>Comisiones</button>
      <button className={tab === "administration_preview" ? "active" : ""} onClick={() => setTab("administration_preview")}>Liquidación mensual</button>
      <button className={tab === "guides" ? "active" : ""} onClick={() => setTab("guides")}>Guías operativas</button>
      <button className={tab === "configuration" ? "active" : ""} onClick={() => setTab("configuration")}>Parámetros</button>
      {accessTeam.length ? <button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Roles y accesos</button> : null}
      <button className={tab === "compliance" ? "active" : ""} onClick={() => setTab("compliance")}>Cumplimiento</button>
      <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>Agentes IA</button>
      <button className={tab === "training" ? "active" : ""} onClick={() => setTab("training")}>Entrenamiento IA</button>
    </nav>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}

    {tab === "operations" ? <>
      <section className="broker-recommendations" aria-label="Prioridades operativas">
        <div className="broker-list-heading"><span>Prioridades operativas</span><h2>Qué revisar a continuación</h2><p>Son sugerencias internas basadas en la cartera. EVOLUM no cambia estados, publica ni contacta personas por su cuenta.</p></div>
        <div className="broker-list-heading"><button type="button" className="secondary-btn" disabled={busy} onClick={executeAutomationScan}>Revisar cartera y crear alertas internas</button><p>La revisión detecta pendientes y crea alertas internas; no publica, envía mensajes ni modifica operaciones.</p></div>
        {recommendations.length ? <div className="broker-recommendation-grid">{recommendations.map((recommendation) => <article key={recommendation.id} className={`broker-recommendation ${recommendation.priority.toLowerCase()}`}><b>{recommendation.priority === "HIGH" ? "Prioridad alta" : recommendation.priority === "MEDIUM" ? "Prioridad media" : "Informativa"}</b><h3>{recommendation.title}</h3><p>{recommendation.detail}</p><button type="button" className="secondary-btn" onClick={() => setTab(recommendation.area)}>{recommendation.requiresApproval ? "Revisar y confirmar" : "Completar ficha"}</button></article>)}</div> : <p className="broker-empty">La cartera no tiene prioridades pendientes por ahora.</p>}
      </section>
      <section className="broker-expedient-panel" aria-label="Expediente por propiedad">
        <div className="broker-list-heading"><span>Expediente digital</span><h2>Revisa una propiedad completa</h2><p>Consulta documentos, contratos, mantenciones, postventa y antecedentes sin cambiar de pantalla.</p></div>
        <div className="broker-expedient-controls"><select value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)}><option value="">Selecciona una propiedad</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select><button type="button" className="primary-btn" disabled={busy || !selectedPropertyId} onClick={openExpedient}>Abrir expediente</button></div>
        {expedient ? <><div className="broker-expedient-summary"><div><b>{expedient.property.title}</b><p>{expedient.completion.complete ? "Ficha completa para operación y publicación." : `Falta completar: ${expedient.completion.missing.join(", ")}.`}</p><p><strong>Salud del expediente: {expedient.health.score}% · {readable(expedient.health.status)}</strong></p></div><div className="broker-expedient-counts">{Object.entries(expedient.grouped).filter(([, items]) => items?.length).map(([area, items]) => <span key={area}><b>{items?.length}</b>{AREA_CONFIG[area as BrokerRecordArea]?.label || readable(area)}</span>)}</div></div>{expedient.journey ? <div className="broker-expedient-timeline"><b>Journey de la propiedad</b><p>Propietarios: {expedient.journey.people.propietarios.join(", ") || "Sin registrar"} · Interesados: {expedient.journey.people.interesados.join(", ") || "Sin registrar"}</p><p>{Object.entries(expedient.journey.control).map(([key, value]) => `${readable(key)}: ${value}`).join(" · ")}</p></div> : null}<div className="broker-expedient-timeline"><b>Últimos movimientos</b>{expedient.timeline.slice(0, 5).map((item, index) => <p key={`${item.at}-${index}`}><span>{item.at ? new Date(item.at).toLocaleDateString("es-CL") : "Sin fecha"}</span>{item.title} · {readable(item.status)}{item.note ? ` — ${item.note}` : ""}</p>)}</div></> : null}
      </section>
      {reporting ? <section className="broker-reporting" aria-label="Indicadores y aprendizaje de Broker OS">
        <article><span>Valor de cartera</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(reporting.portfolioValue)}</b><small>Inventario de propiedades</small></article>
        <article><span>Comisión proyectada</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(reporting.projectedCommission)}</b><small>Según operaciones activas</small></article>
        <article><span>Fichas completas</span><b>{reporting.propertyCompleteness}%</b><small>Datos listos para publicar</small></article>
        <article><span>Salud de cartera</span><b>{reporting.portfolioHealth}%</b><small>{reporting.propertiesReady} propiedades listas para operar</small></article>
        <article><span>Aprendizajes IA</span><b>{reporting.aiEvaluations.confirmed}/{reporting.aiEvaluations.total}</b><small>Confirmados por el equipo</small></article>
      </section> : null}
      <section className="broker-os-grid">
      <form className="broker-os-form" onSubmit={createOperation}>
        <span>Ingreso operativo</span><h2>Nueva operacion</h2><p>Selecciona el flujo correcto. EVOLUM no permite saltar etapas sensibles.</p>
        <div className="broker-type-picker">{(Object.keys(OPERATION_LABELS) as BrokerOperationType[]).map((type) => <button type="button" key={type} className={operationType === type ? "selected" : ""} onClick={() => setOperationType(type)}>{OPERATION_LABELS[type]}</button>)}</div>
        <label>Nombre de la operacion<input name="title" placeholder="Ej.: Venta departamento Providencia" required /></label>
        <label>Propiedad asociada<select name="propertyId"><option value="">Sin asignar por ahora</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>
        <label>Cliente o contraparte<input name="clientName" placeholder="Nombre, empresa o interesado" /></label>
        <label>Nota inicial<textarea name="notes" placeholder="Antecedentes, objetivo o acuerdo inicial" rows={3} /></label>
        <button className="primary-btn" disabled={busy}>Crear operacion de {OPERATION_LABELS[operationType].toLowerCase()}</button>
      </form>
      <section className="broker-os-list"><div className="broker-list-heading"><span>Seguimiento</span><h2>Operaciones activas</h2><p>Avanza una etapa por vez y conserva una trazabilidad real.</p></div>
        {operations.length === 0 ? <p className="broker-empty">Aun no hay operaciones. Crea la primera para iniciar el flujo comercial.</p> : operations.map((operation) => {
          const stages = catalog?.operationStages[operation.data.operationType] || [];
          const index = stageIndex(operation, catalog);
          const next = stages[index + 1];
          return <article key={operation.id} className="broker-operation-card"><div><span>{OPERATION_LABELS[operation.data.operationType]}</span><h3>{operation.title}</h3><p>{readable(operation.data.stage)} · {String(operation.data.clientName || "Sin contraparte registrada")}</p></div><div className="broker-stage"><div><i style={{ width: `${stages.length ? ((index + 1) / stages.length) * 100 : 0}%` }} /></div><small>Etapa {index + 1} de {stages.length}: {readable(stages[index])}</small></div><div className="broker-operation-actions">{operation.data.operationType === "SALE" ? <button className="secondary-btn" type="button" disabled={busy} onClick={() => openSaleWorkspace(operation)}>Abrir expediente</button> : null}<button className="primary-btn" type="button" disabled={busy || !next} onClick={() => nextStage(operation)}>{next ? `Avanzar a ${readable(next)}` : "Flujo completado"}</button></div></article>;
        })}
      </section>
      </section>
      {saleWorkspace ? <section className="broker-sale-case-panel" aria-label="Expediente completo de venta">
        <header><div><span>Venta de punta a punta</span><h2>{saleWorkspace.operation.title}</h2><p>{saleWorkspace.property.title} · Etapa actual: <b>{readable(saleWorkspace.saleCase.currentStage)}</b></p></div><button type="button" className="secondary-btn" onClick={() => setSaleWorkspace(null)}>Cerrar expediente</button></header>
        <div className="broker-sale-readiness"><div><b>{saleWorkspace.nextStage ? `Siguiente hito: ${readable(saleWorkspace.nextStage)}` : "Venta finalizada"}</b><p>{saleWorkspace.readiness.ready ? "Los antecedentes mínimos están completos para el siguiente hito." : "Completa los puntos pendientes antes de avanzar."}</p></div>{saleWorkspace.readiness.requirements.length ? <ul>{saleWorkspace.readiness.requirements.map((item) => <li key={item.key} className={item.ready ? "ready" : "pending"}>{item.ready ? "✓" : "○"} {item.label}</li>)}</ul> : <p>El flujo no tiene más etapas pendientes.</p>}</div>
        <form key={saleWorkspace.saleCase.updatedAt || saleWorkspace.saleCase.id} className="broker-sale-case-form" onSubmit={saveSaleWorkspace}>
          <section><h3>Comprador y capacidad de compra</h3><label>Comprador<input name="buyerName" defaultValue={saleWorkspace.saleCase.buyerName || ""} placeholder="Nombre de la persona o empresa" /></label><label>Calificación<select name="buyerQualificationStatus" defaultValue={saleWorkspace.saleCase.buyerQualificationStatus}>{saleWorkspace.options.qualificationStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Banco o institución<input name="preapprovalBank" defaultValue={saleWorkspace.saleCase.preapprovalBank || ""} placeholder="Ej.: Banco informado por comprador" /></label><label>Monto preaprobado<input name="preapprovalAmount" type="number" min="0" defaultValue={saleWorkspace.saleCase.preapprovalAmount ?? ""} /></label><label>Vigencia preaprobación<input name="preapprovalExpiresAt" type="date" defaultValue={saleWorkspace.saleCase.preapprovalExpiresAt?.slice(0, 10) || ""} /></label><label>Financiamiento<select name="financingStatus" defaultValue={saleWorkspace.saleCase.financingStatus}>{saleWorkspace.options.financingStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label></section>
          <section><h3>Oferta y promesa</h3><label>Monto de oferta<input name="offerAmount" type="number" min="0" defaultValue={saleWorkspace.saleCase.offerAmount ?? ""} /></label><label>Estado de oferta<select name="offerStatus" defaultValue={saleWorkspace.saleCase.offerStatus}>{saleWorkspace.options.offerStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Oferta recibida<input name="offerReceivedAt" type="date" defaultValue={saleWorkspace.saleCase.offerReceivedAt?.slice(0, 10) || ""} /></label><label>Respuesta de oferta<input name="offerRespondedAt" type="date" defaultValue={saleWorkspace.saleCase.offerRespondedAt?.slice(0, 10) || ""} /></label><label>Condiciones<textarea name="offerConditions" rows={3} defaultValue={saleWorkspace.saleCase.offerConditions || ""} placeholder="Forma de pago, fechas, bienes incluidos y condiciones relevantes" /></label><label>Estado de promesa<select name="promiseStatus" defaultValue={saleWorkspace.saleCase.promiseStatus}>{saleWorkspace.options.promiseStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Monto de promesa<input name="promiseAmount" type="number" min="0" defaultValue={saleWorkspace.saleCase.promiseAmount ?? ""} /></label><label>Firma de promesa<input name="promiseSignedAt" type="date" defaultValue={saleWorkspace.saleCase.promiseSignedAt?.slice(0, 10) || ""} /></label><label>Cláusula de incumplimiento (%)<input name="promisePenaltyPct" type="number" min="0" max="100" step="0.01" defaultValue={saleWorkspace.saleCase.promisePenaltyPct ?? ""} /></label></section>
          <section><h3>Revisión jurídica y escritura</h3><label>Estudio de títulos<select name="titleStudyStatus" defaultValue={saleWorkspace.saleCase.titleStudyStatus}>{saleWorkspace.options.titleStudyStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Observaciones de títulos<textarea name="titleStudyNotes" rows={3} defaultValue={saleWorkspace.saleCase.titleStudyNotes || ""} placeholder="Observaciones y responsable de la revisión jurídica" /></label><label>Tasación bancaria<select name="bankAppraisalStatus" defaultValue={saleWorkspace.saleCase.bankAppraisalStatus}>{saleWorkspace.options.bankAppraisalStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Estado de escritura<select name="deedStatus" defaultValue={saleWorkspace.saleCase.deedStatus}>{saleWorkspace.options.deedStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Fecha programada<input name="deedScheduledAt" type="date" defaultValue={saleWorkspace.saleCase.deedScheduledAt?.slice(0, 10) || ""} /></label><label>Fecha de firma<input name="deedSignedAt" type="date" defaultValue={saleWorkspace.saleCase.deedSignedAt?.slice(0, 10) || ""} /></label></section>
          <section><h3>Inscripción y entrega</h3><label>Estado CBR<select name="cbrStatus" defaultValue={saleWorkspace.saleCase.cbrStatus}>{saleWorkspace.options.cbrStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Número de ingreso o inscripción<input name="cbrEntryNumber" defaultValue={saleWorkspace.saleCase.cbrEntryNumber || ""} /></label><label>Fecha de inscripción<input name="cbrRegisteredAt" type="date" defaultValue={saleWorkspace.saleCase.cbrRegisteredAt?.slice(0, 10) || ""} /></label><label>Estado de entrega<select name="handoverStatus" defaultValue={saleWorkspace.saleCase.handoverStatus}>{saleWorkspace.options.handoverStatuses.map((status) => <option key={status}>{readable(status)}</option>)}</select></label><label>Fecha de entrega<input name="handoverAt" type="date" defaultValue={saleWorkspace.saleCase.handoverAt?.slice(0, 10) || ""} /></label><label>Quién recibe<input name="handoverRecipient" defaultValue={saleWorkspace.saleCase.handoverRecipient || ""} /></label></section>
          <footer><p className="broker-human-note">Este expediente ordena evidencia y controles internos. No firma documentos, aprueba créditos, inscribe ante CBR ni ejecuta pagos por cuenta propia.</p><button className="primary-btn" disabled={busy}>Guardar controles de venta</button></footer>
        </form>
        <div className="broker-sale-confirmations"><h3>Confirmaciones humanas obligatorias</h3><p>Registra la revisión responsable una vez que el antecedente haya sido comprobado fuera de EVOLUM OS.</p><div>{(["oferta", "promesa", "titulos", "escritura", "inscripcion", "entrega"] as const).map((checkpoint) => <button type="button" key={checkpoint} className={saleWorkspace.saleCase.checkpoints?.[checkpoint] ? "secondary-btn confirmed" : "secondary-btn"} disabled={busy} onClick={() => confirmSaleCheckpoint(checkpoint)}>{saleWorkspace.saleCase.checkpoints?.[checkpoint] ? `✓ ${readable(checkpoint)} confirmado` : `Confirmar ${readable(checkpoint)}`}</button>)}</div></div>
      </section> : null}
    </> : null}

    {tab === "financing" ? <section className="broker-financing-workspace" aria-label="Financiamiento operativo">
      <div className="broker-list-heading"><span>Financiamiento operativo</span><h2>Controla antecedentes, etapas y gastos</h2><p>Broker OS organiza el seguimiento de cada solicitud. Las decisiones de entidades financieras, desembolsos y pagos siempre se registran con respaldo y revisión humana.</p></div>
      <section className="broker-reporting broker-financing-kpis">
        <article><span>Solicitudes activas</span><b>{financingInReview}</b><small>Con una etapa pendiente de confirmar</small></article>
        <article><span>Monto solicitado</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(financingRequestedTotal)}</b><small>Según lo informado por el equipo</small></article>
        <article><span>Gastos asociados</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(financingExpensesTotal)}</b><small>No representa pagos ejecutados</small></article>
        <article><span>Revisión humana</span><b>Obligatoria</b><small>No se conceden créditos ni se desembolsan fondos</small></article>
      </section>
      <section className="broker-financing-create">
        <form className="broker-os-form" onSubmit={createFinancing}>
          <span>Nueva solicitud</span><h2>Registrar financiamiento</h2><p>Inicia en diagnóstico financiero y avanza con antecedentes verificables.</p>
          <label>Nombre de la solicitud<input name="title" required placeholder="Ej.: Crédito hipotecario · depto Providencia" /></label>
          <label>Propiedad asociada<select name="propertyId" required><option value="">Selecciona una propiedad</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>
          <label>Destino del financiamiento<input name="purpose" required placeholder="Ej.: Crédito hipotecario para compra" /></label>
          <label>Monto solicitado<input name="requestedAmount" type="number" min="0" required placeholder="Ej.: 120000000" /></label>
          <label>Comprador o solicitante<input name="buyerName" placeholder="Nombre o razón social" /></label>
          <label>Tipo de financiamiento<input name="financingType" placeholder="Ej.: Hipotecario, mutuo o capital de trabajo" /></label>
          <label>Institución o canal<input name="institution" placeholder="Ej.: Banco informado por cliente" /></label>
          <label>Gastos estimados<input name="estimatedExpenses" type="number" min="0" placeholder="Ej.: 2500000" /></label>
          {!canFinanceAction("CREATE") ? <p className="broker-human-note">Tu perfil puede revisar las solicitudes, pero no crear nuevas. Solicita la gestión a Finanzas o a un administrador.</p> : null}
          <button className="primary-btn" disabled={busy || !canFinanceAction("CREATE")}>Registrar solicitud</button>
        </form>
        <form className="broker-os-form broker-financing-expense-form" onSubmit={createFinancingExpense}>
          <span>Gasto asociado</span><h2>Registrar antecedente de gasto</h2><p>Relaciona tasación, estudio, seguros u otros costos a una solicitud existente.</p>
          <label>Solicitud de financiamiento<select name="financingId" required><option value="">Selecciona una solicitud</option>{financingRecords.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label>
          <label>Concepto<input name="concept" required placeholder="Ej.: Tasación bancaria" /></label>
          <label>Monto informado<input name="amount" type="number" min="0" required placeholder="Ej.: 180000" /></label>
          <label>Fecha de vencimiento<input name="dueDate" type="date" /></label>
          <label>Nombre o referencia<input name="title" placeholder="Ej.: Tasación Banco · Providencia" /></label>
          <label>Observación<textarea name="notes" rows={3} placeholder="Respaldo, proveedor o condición informada" /></label>
          {!canFinanceAction("CREATE") ? <p className="broker-human-note">Solo perfiles autorizados pueden registrar gastos asociados.</p> : null}
          <button className="secondary-btn" disabled={busy || !financingRecords.length || !canFinanceAction("CREATE")}>Guardar gasto asociado</button>
        </form>
      </section>
      <section className="broker-financing-list">
        <div className="broker-list-heading"><span>Seguimiento</span><h2>Solicitudes y etapas</h2><p>Avanza solo la etapa que haya sido confirmada. El historial conserva quién registró cada cambio y cuándo lo hizo.</p></div>
        {!financingRecords.length ? <p className="broker-empty">Aún no hay solicitudes de financiamiento. Registra la primera desde el panel superior.</p> : financingRecords.map((record) => {
          const data = record.data as Record<string, unknown>;
          const stage = String(record.status || data.stage || financingStages[0] || "DIAGNOSTICO_FINANCIERO").toUpperCase();
          const index = Math.max(0, financingStages.indexOf(stage));
          const next = financingStages[index + 1];
          const relatedExpenses = financingExpenses.filter((expense) => String((expense.data as Record<string, unknown>).financingId || "") === record.id);
          const timeline = Array.isArray(data.timeline) ? data.timeline as Array<{ at?: string; stage?: string; note?: string; by?: string }> : [];
          const terminal = FINANCING_TERMINAL_STAGES.has(stage);
          return <article key={record.id} className="broker-financing-card">
            <header><div><span>{terminal ? "Proceso finalizado" : "En seguimiento"}</span><h3>{record.title}</h3><p>{String(data.purpose || "Sin destino informado")} · {String(data.buyerName || "Solicitante pendiente")}</p></div><b>{readable(stage)}</b></header>
            <div className="broker-financing-details"><span><b>Monto:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(data.requestedAmount || 0))}</span><span><b>Tipo:</b> {String(data.financingType || "Pendiente")}</span><span><b>Institución:</b> {String(data.institution || "Pendiente")}</span><span><b>Gastos estimados:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(data.estimatedExpenses || 0))}</span></div>
            <div className="broker-financing-progress" aria-label={`Etapa ${index + 1} de ${financingStages.length}`}><div><i style={{ width: `${financingStages.length ? ((index + 1) / financingStages.length) * 100 : 0}%` }} /></div><small>{terminal ? "Flujo finalizado" : `Etapa ${index + 1} de ${financingStages.length}: ${readable(stage)}`}</small></div>
            <div className="broker-financing-body"><section><h4>Checklist de esta etapa</h4><ul>{(Array.isArray(data.checklist) ? data.checklist : []).map((item) => <li key={String(item)}>{String(item)}</li>)}</ul></section><section><h4>Gastos asociados ({relatedExpenses.length})</h4>{relatedExpenses.length ? <ul>{relatedExpenses.map((expense) => { const expenseData = expense.data as Record<string, unknown>; return <li key={expense.id}>{String(expenseData.concept || expense.title)} · {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(expenseData.amount || 0))} · {readable(expense.status)}</li>; })}</ul> : <p>Sin gastos vinculados.</p>}</section><section><h4>Últimos movimientos</h4>{timeline.length ? <ul>{timeline.slice(-3).reverse().map((item, itemIndex) => <li key={`${item.at || "sin-fecha"}-${itemIndex}`}><b>{item.at ? new Date(item.at).toLocaleDateString("es-CL") : "Sin fecha"}</b> · {readable(item.stage || stage)}{item.note ? `: ${item.note}` : ""}</li>)}</ul> : <p>Sin movimientos registrados.</p>}</section></div>
            {!terminal ? <footer><label>Comentario del responsable<textarea value={financingNotes[record.id] || ""} onChange={(event) => setFinancingNotes((current) => ({ ...current, [record.id]: event.target.value }))} rows={2} placeholder="Indica el respaldo o motivo del avance" /></label><div><button type="button" className="primary-btn" disabled={busy || !next || !canFinanceAction(financingActionForStage(next || ""))} onClick={() => next && moveFinancingStage(record, next)}>{next ? `Confirmar ${readable(next)}` : "Sin etapa siguiente"}</button><button type="button" className="secondary-btn" disabled={busy || !canFinanceAction("REJECT")} onClick={() => moveFinancingStage(record, "RECHAZADO")}>Registrar rechazo</button><button type="button" className="secondary-btn" disabled={busy || !canFinanceAction("REJECT")} onClick={() => moveFinancingStage(record, "CANCELADO")}>Cancelar solicitud</button></div></footer> : <p className="broker-human-note">Proceso cerrado. Broker OS conserva el historial, pero no ejecuta pagos, desembolsos ni comunicaciones externas.</p>}
          </article>;
        })}
      </section>
    </section> : null}

    {currentArea ? <section className="broker-os-grid broker-area-grid">
      <form className="broker-os-form" onSubmit={createRecord}>
        <span>Expediente operativo</span><h2>{AREA_CONFIG[currentArea].label}</h2><p>{AREA_CONFIG[currentArea].description}</p>
        <label>Tipo de registro<select value={recordType} onChange={(event) => setRecordType(event.target.value)}>{currentTypes.map((type) => <option key={type} value={type}>{catalog?.recordDefinitions[type]?.label || readable(type)}</option>)}</select></label>
        <label>Nombre o referencia<input name="title" placeholder={`Ej.: ${currentDefinition?.label || "registro"}`} required /></label>
        {currentDefinition?.required.map((field) => {
          const config = FIELD_CONFIG[field] || { label: readable(field) };
          if (field === "propertyId") return <label key={field}>{config.label}<select name={field} required><option value="">Selecciona una propiedad</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>;
          if (config.type === "textarea") return <label key={field}>{config.label}<textarea name={field} rows={3} placeholder={config.placeholder} required /></label>;
          return <label key={field}>{config.label}<input name={field} type={config.type || "text"} placeholder={config.placeholder} required /></label>;
        })}
        <label>Estado inicial<select name="status" disabled><option>{readable(currentDefinition?.statuses[0])}</option></select></label>
        <button className="primary-btn" disabled={busy || !currentDefinition}>Guardar en expediente</button>
      </form>
      <section className="broker-os-list"><div className="broker-list-heading"><span>Registros</span><h2>{AREA_CONFIG[currentArea].label}</h2><p>Consulta cada antecedente sin mezclarlo con otra propiedad u operacion.</p></div>
        {records.length === 0 ? <p className="broker-empty">Aun no hay registros en esta area. Crea el primero desde el panel superior.</p> : records.map((record) => {
          const definition = catalog?.recordDefinitions[record.recordType];
          return <article key={record.id} className="broker-record-card"><div><span>{definition?.label || readable(record.recordType)}</span><h3>{record.title}</h3><p>{recordSummary(record, definition)}</p></div><div className="broker-record-state"><b>{readable(record.status)}</b>{definition?.statuses?.length ? <select aria-label={`Cambiar estado de ${record.title}`} value={record.status} disabled={busy} onChange={(event) => setRecordStatus(record, event.target.value)}>{definition.statuses.map((status) => <option key={status} value={status}>{readable(status)}</option>)}</select> : null}</div></article>;
        })}
      </section>
    </section> : null}

    {tab === "commissions" ? <section className="broker-os-grid broker-area-grid">
      <form className="broker-os-form" onSubmit={calculateCommission}>
        <span>Simulador interno</span><h2>Comisiones</h2><p>Calcula una proyección para revisar el reparto. Este simulador no crea pagos, liquidaciones ni transferencias.</p>
        <label>Base de cálculo<input name="baseAmount" type="number" min="0" placeholder="Ej.: 180000000" required /></label>
        <label>Comisión total (%)<input name="commissionRatePct" type="number" min="0" step="0.01" placeholder="Ej.: 2" required /></label>
        <label>Parte corredor (%)<input name="brokerSplitPct" type="number" min="0" max="100" defaultValue="50" required /></label>
        <label>Parte empresa (%)<input name="companySplitPct" type="number" min="0" max="100" defaultValue="50" required /></label>
        <button className="primary-btn" disabled={busy}>Calcular proyección</button>
      </form>
      <section className="broker-os-list broker-commission-result"><div className="broker-list-heading"><span>Resultado estimado</span><h2>Distribución para revisión</h2><p>Confirma las condiciones comerciales antes de registrar una regla o liquidación en el expediente.</p></div>{commissionPreview?.ok ? <div className="broker-reporting"><article><span>Comisión total</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(commissionPreview.totalCommission || 0)}</b><small>Sobre la base informada</small></article><article><span>Corredor</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(commissionPreview.brokerAmount || 0)}</b><small>{commissionPreview.brokerSplitPct}% de distribución</small></article><article><span>Empresa</span><b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(commissionPreview.companyAmount || 0)}</b><small>{commissionPreview.companySplitPct}% de distribución</small></article></div> : <p className="broker-empty">Ingresa los valores para obtener una proyección. El cálculo es informativo y requiere validación humana.</p>}</section>
    </section> : null}

    {tab === "administration_preview" ? <section className="broker-monthly-administration" aria-label="Administración mensual recurrente">
      <header className="broker-monthly-header"><div><span>Administración recurrente</span><h2>Liquidaciones mensuales por propiedad</h2><p>Consolida contratos, cobros y gastos registrados para preparar cada liquidación. El sistema no transfiere dinero ni emite cobros por su cuenta.</p></div><label>Período de trabajo<input type="month" value={administrationPeriod} onChange={(event) => setAdministrationPeriod(event.target.value)} /></label><button type="button" className="secondary-btn" disabled={busy} onClick={() => refreshMonthlyAdministration().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo actualizar el período."))}>Actualizar período</button></header>
      {monthlyAdministration ? <><section className="broker-reporting broker-monthly-kpis"><article><span>Propiedades administradas</span><b>{monthlyAdministration.summary.managedProperties}</b><small>Con ficha activa de administración</small></article><article><span>Listas para preparar</span><b>{monthlyAdministration.summary.readyToPrepare}</b><small>Con contrato y renta mensual vigentes</small></article><article><span>Pendientes de aprobación</span><b>{monthlyAdministration.summary.pendingApproval}</b><small>Requieren una persona autorizada</small></article><article><span>Pagos registrados</span><b>{monthlyAdministration.summary.paid}</b><small>Solo estado informado, sin transferencias</small></article></section><section className="broker-monthly-summary"><span>Resumen del período {monthlyAdministration.period}</span><p>Renta esperada: <b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(monthlyAdministration.summary.expectedRent)}</b> · Cobros registrados: <b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(monthlyAdministration.summary.paidRent)}</b> · Monto propuesto a propietarios: <b>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(monthlyAdministration.summary.proposedOwnerAmount)}</b></p></section><section className="broker-monthly-list">{monthlyAdministration.rows.length ? monthlyAdministration.rows.map((row) => { const status = row.liquidation?.status || "DRAFT"; const stageIndex = ADMINISTRATION_LIQUIDATION_STAGES.indexOf(status); const nextStatus = (row.liquidation ? ADMINISTRATION_LIQUIDATION_STAGES[stageIndex + 1] : null) as "PENDING_APPROVAL" | "ISSUED" | "PAID" | null; const liquidationId = row.liquidation?.id || ""; return <article key={row.propertyId} className="broker-monthly-card"><header><div><span>{row.liquidation ? "Liquidación preparada" : "Pendiente de preparar"}</span><h3>{row.propertyTitle}</h3><p>{row.ownerName} · Arrendatario: {row.tenantName}</p></div><b>{row.liquidation ? readable(status) : row.readyToPrepare ? "Lista para preparar" : "Faltan antecedentes"}</b></header><div className="broker-monthly-data"><span><b>Renta:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.monthlyRent)}</span><span><b>Cobrado:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.paidAmount)}</span><span><b>Gastos:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.preview.totalExpenses)}</span><span><b>Honorario:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.preview.managementFee)}</span><span><b>Propuesta propietario:</b> {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(row.preview.ownerTransferAmount)}</span></div><div className="broker-monthly-context"><p><b>Contrato:</b> {readable(row.contractStatus)} · <b>Cobros:</b> {row.paymentCount} · <b>Servicios:</b> {row.utilityCount} · <b>Mantenciones:</b> {row.maintenanceCount}</p><p>Fecha referencial de pago al propietario: día {row.ownerPaymentDay || "pendiente"}. Requiere revisión humana.</p></div>{(!row.liquidation || row.liquidation.status === "DRAFT") && row.readyToPrepare ? <form className="broker-monthly-form" onSubmit={(event) => prepareMonthlyLiquidation(row, event)}><label>Renta mensual<input name="monthlyRent" type="number" min="0" defaultValue={row.monthlyRent} required /></label><label>Cobro informado<input name="paidAmount" type="number" min="0" defaultValue={row.paidAmount} required /></label><label>Gastos comunes<input name="commonExpenses" type="number" min="0" defaultValue={row.commonExpenses} required /></label><label>Servicios<input name="utilities" type="number" min="0" defaultValue={row.utilities} required /></label><label>Mantenciones<input name="maintenanceCost" type="number" min="0" defaultValue={row.maintenanceCost} required /></label><label>Honorario (%)<input name="managementRatePct" type="number" min="0" max="100" step="0.01" defaultValue={row.managementRatePct} required /></label>{!canAdministrationAction("CREATE") ? <p className="broker-human-note">Tu perfil puede revisar el período, pero no preparar liquidaciones.</p> : null}<button className="primary-btn" disabled={busy || !canAdministrationAction("CREATE")}>{row.liquidation ? "Actualizar borrador" : "Preparar liquidación"}</button></form> : null}{row.liquidation ? <footer><label>Comentario del responsable<textarea value={administrationNotes[liquidationId] || ""} onChange={(event) => setAdministrationNotes((current) => ({ ...current, [liquidationId]: event.target.value }))} rows={2} placeholder="Respaldo, observación o confirmación del período" /></label><div>{nextStatus ? <button type="button" className="primary-btn" disabled={busy || !canAdministrationAction(administrationActionForStage(nextStatus))} onClick={() => moveMonthlyLiquidation(row, nextStatus)}>{nextStatus === "PENDING_APPROVAL" ? "Enviar a aprobación" : nextStatus === "ISSUED" ? "Confirmar emisión" : "Registrar pago informado"}</button> : <span className="broker-monthly-complete">Período finalizado</span>}</div></footer> : null}{!row.readyToPrepare ? <p className="broker-human-note">Para preparar esta liquidación necesitas una ficha de administración activa y un contrato vigente con renta mensual.</p> : null}</article>; }) : <p className="broker-empty">No hay propiedades con administración activa para este período.</p>}</section><p className="broker-human-note">“Emitida” y “pagada” son estados documentales dentro de Broker OS. No activan transferencias bancarias, pagos, cobros, boletas ni comunicaciones externas.</p></> : <p className="broker-empty">Cargando administración mensual...</p>}
    </section> : null}

    {tab === "guides" ? <section className="broker-training-panel"><div className="broker-list-heading"><span>Guías operativas</span><h2>Qué revisar en cada etapa</h2><p>Lista interna de verificación para trabajar con orden. Las revisiones jurídicas, firmas, pagos y comunicaciones externas siempre requieren una persona responsable.</p></div><div className="broker-guide-grid">{(Object.keys(OPERATION_LABELS) as BrokerOperationType[]).map((type) => <article key={type}><h3>{OPERATION_LABELS[type]}</h3>{(catalog?.operationStages[type] || []).map((stage) => <section key={stage}><b>{readable(stage)}</b><ul>{(catalog?.operationChecklists?.[type]?.[stage] || []).map((item) => <li key={item}>{item}</li>)}</ul></section>)}</article>)}</div><div className="broker-guide-grid">{(catalog?.sopLibrary || []).map((sop) => <article key={sop.key}><h3>{sop.title}</h3><ul>{sop.steps.map((step) => <li key={step}>{step}</li>)}</ul></article>)}</div><div className="broker-guide-grid">{(catalog?.roleTemplates || []).map((role) => <article key={role.key}><h3>{role.label}</h3><p>{role.scope}</p><ul>{role.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul></article>)}</div></section> : null}

    {tab === "configuration" ? <section className="broker-training-panel"><div className="broker-list-heading"><span>Parámetros comerciales</span><h2>Configura sin dejar condiciones rígidas en el código</h2><p>Valores de operación por empresa. Deben ser revisados y aprobados por la administración antes de utilizarse con clientes reales.</p></div>{operatingConfiguration ? <form className="broker-policy-form" onSubmit={saveOperatingConfiguration}>
      <section><h3>Venta y reparto</h3><label>Comisión vendedor (%)<input name="sellerCommissionPct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.sales.sellerCommissionPct} required /></label><label>Comisión comprador (%)<input name="buyerCommissionPct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.sales.buyerCommissionPct} required /></label><label>Parte corredor (%)<input name="brokerSplitPct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.sales.brokerSplitPct} required /></label><label>Parte empresa (%)<input name="companySplitPct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.sales.companySplitPct} required /></label></section>
      <section><h3>Arriendo y administración</h3><label>Honorario propietario (meses de renta)<input name="landlordMonths" type="number" step="0.01" min="0" defaultValue={operatingConfiguration.policy.rentalPlacement.landlordMonths} required /></label><label>Honorario arrendatario (meses de renta)<input name="tenantMonths" type="number" step="0.01" min="0" defaultValue={operatingConfiguration.policy.rentalPlacement.tenantMonths} required /></label><label>Retención referencial (%)<input name="withholdingRatePct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.rentalPlacement.withholdingRatePct ?? ""} placeholder="Debe confirmar contador" /></label><label>Administración 1ª propiedad (%)<input name="adminRate1" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.administration.tiers[0]?.ratePct ?? ""} required /></label><label>Administración desde 2ª (%)<input name="adminRate2" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.administration.tiers[1]?.ratePct ?? ""} required /></label><label>Día de liquidación al propietario<input name="ownerPaymentDay" type="number" min="1" max="28" defaultValue={operatingConfiguration.policy.administration.ownerPaymentDay} required /></label></section>
      <section><h3>SLA y financiamiento</h3><label>Primer contacto (minutos)<input name="firstLeadContactMinutes" type="number" min="1" defaultValue={operatingConfiguration.policy.slas.firstLeadContactMinutes} required /></label><label>Publicación (horas)<input name="propertyPublicationHours" type="number" min="1" defaultValue={operatingConfiguration.policy.slas.propertyPublicationHours} required /></label><label>Revisión legal (horas)<input name="legalReviewHours" type="number" min="1" defaultValue={operatingConfiguration.policy.slas.legalReviewHours} required /></label><label>Incidencia crítica (horas)<input name="criticalIncidentHours" type="number" min="1" defaultValue={operatingConfiguration.policy.slas.criticalIncidentHours} required /></label><label>Interés de financiamiento (%)<input name="interestRatePct" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.financing.interestRatePct ?? ""} placeholder="Pendiente de definir" /></label><label>Umbral de riesgo (%)<input name="riskThreshold" type="number" step="0.01" min="0" max="100" defaultValue={operatingConfiguration.policy.financing.riskThreshold ?? ""} placeholder="Pendiente de definir" /></label></section>
      <p className="broker-human-note">Financiamiento, desembolsos, pagos, firmas y comunicaciones se mantienen con aprobación humana obligatoria. Los campos vacíos quedan pendientes de definición comercial, tributaria o jurídica.</p><button className="primary-btn" disabled={busy}>Guardar parámetros</button>
    </form> : <p className="broker-empty">Cargando parámetros comerciales...</p>}</section> : null}

    {tab === "access" ? <section className="broker-training-panel"><div className="broker-list-heading"><span>Roles, permisos y alcance</span><h2>Define qué puede hacer cada persona</h2><p>El rol de negocio determina las acciones; el alcance limita los registros visibles. Los cambios quedan auditados y no modifican el rol global de EVOLUM OS.</p></div>{holdingConfig?.canConfigure ? <form className="broker-policy-form broker-holding-form" onSubmit={saveHolding}><section><h3>Gobierno Holding</h3><p>Une empresas inmobiliarias solo cuando exista una relación comercial y personas autorizadas. Ninguna cuenta obtiene acceso entre empresas por defecto.</p><label>Nombre del holding<input name="holdingName" defaultValue={holdingConfig.holding?.name || ""} placeholder="Ej.: Grupo Broker Chile" required /></label><label>Código interno<input name="holdingCode" defaultValue={holdingConfig.holding?.code || ""} placeholder="grupo-broker-chile" required /></label></section><section><h3>Empresas incluidas</h3>{holdingConfig.availableTenants.map((tenant) => <label key={tenant.id} className="broker-check-option"><input type="checkbox" name="tenantSlugs" value={tenant.slug} defaultChecked={holdingConfig.holding?.tenants.some((item) => item.id === tenant.id) || false} />{tenant.name} <small>({tenant.slug})</small></label>)}</section><section><h3>Usuarios autorizados</h3>{accessTeam.map((user) => <label key={user.id} className="broker-check-option"><input type="checkbox" name="holdingUserIds" value={user.id} defaultChecked={holdingConfig.holding?.accesses.some((item) => item.userId === user.id) || false} />{user.name} <small>{user.email}</small></label>)}<p className="broker-human-note">Después de guardarlo, asigna el alcance “Holding” solo a las personas que realmente deben consultar varias empresas.</p><button className="primary-btn" disabled={busy}>Guardar gobierno Holding</button></section></form> : access?.holding ? <p className="broker-human-note">Holding activo: <b>{access.holding.name}</b>. Tu cuenta puede consultar {access.holding.tenantCount} empresas autorizadas.</p> : null}<div className="broker-access-grid">{accessTeam.map((user) => <form key={user.id} className="broker-access-card" onSubmit={(event) => saveAccessProfile(user, event)}><div><b>{user.name}</b><span>{user.email} · {user.jobTitle || user.role}</span></div><label>Rol de negocio<select name="businessRole" defaultValue={user.profile.businessRole}>{BROKER_BUSINESS_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Alcance<select name="accessScope" defaultValue={user.profile.accessScope}>{BROKER_SCOPE_OPTIONS.filter(([value]) => value !== "HOLDING" || access?.technicalRole === "SUPER_ADMIN").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Equipo<input name="teamKey" defaultValue={user.profile.teamKey || ""} placeholder="Ej.: ventas-norte" /></label><label>Sucursal<input name="branchKey" defaultValue={user.profile.branchKey || ""} placeholder="Ej.: santiago" /></label><button type="submit" className="secondary-btn" disabled={busy}>Guardar acceso</button></form>)}</div></section> : null}

    {tab === "compliance" ? <section className="broker-training-panel"><div className="broker-list-heading"><span>Preparación legal y externa</span><h2>Qué está listo y qué requiere validación</h2><p>Este panel organiza evidencia y dependencias. No sustituye asesoría legal, tributaria ni la habilitación formal de un proveedor.</p></div>{legalReadiness ? <><section className="broker-reporting"><article><span>Consentimientos otorgados</span><b>{legalReadiness.summary.GRANTED}</b><small>Con evidencia registrada</small></article><article><span>Pendientes</span><b>{legalReadiness.summary.PENDING}</b><small>Antes de proponer uso externo</small></article><article><span>Revocados o vencidos</span><b>{legalReadiness.summary.REVOKED + legalReadiness.summary.EXPIRED}</b><small>Requieren bloqueo o renovación</small></article><article><span>Proveedores externos</span><b>{legalReadiness.providers.length}</b><small>Todos desactivados hasta su validación</small></article></section><div className="broker-compliance-grid"><section><h3>Proveedores y dependencias</h3>{legalReadiness.providers.map((item) => <article key={item.key}><b>{item.label}</b><span>{item.category} · {item.status === "HUMAN_REVIEW" ? "Revisión humana" : "Pendiente de proveedor"}</span><p>{item.description}</p></article>)}</section><section><h3>Consentimientos registrados</h3>{legalReadiness.consents.length ? legalReadiness.consents.map((item) => <article key={item.id}><b>{item.title}</b><span>{readable(item.status)}</span><p>{recordSummary(item, catalog?.recordDefinitions[item.recordType])}</p></article>) : <p className="broker-empty">Aún no hay consentimientos registrados. Puedes crearlos desde “Expediente y documentos”.</p>}</section></div><p className="broker-human-note">Para registrar una autorización utiliza el área “Expediente y documentos”. El sistema exige titular, finalidad, fecha y referencia de evidencia; una autorización registrada no activa por sí misma ningún envío, firma, publicación, acceso bancario ni integración.</p></> : <p className="broker-empty">Cargando estado de cumplimiento...</p>}</section> : null}

    {tab === "agents" ? <section className="broker-agents-panel"><div className="broker-list-heading"><span>Agentes de IA</span><h2>Asistentes especializados del Broker</h2><p>Los agentes disponibles preparan análisis y borradores; ninguna acción legal, pago, firma o comunicación externa se ejecuta sin aprobación humana.</p></div><div className="broker-agent-grid">{(overview?.agents || catalog?.agents || []).map((agent) => <article key={agent.key} className={`broker-agent-card ${agent.status === "AVAILABLE" ? "available" : "planned"}`}><span>{agent.status === "AVAILABLE" ? "Disponible" : "Próxima etapa"}</span><h3>{agent.name}</h3><p>{agent.description}</p><small>Módulo: {readable(agent.module)}</small></article>)}</div></section> : null}

    {tab === "training" ? <section className="broker-training-panel"><div className="broker-list-heading"><span>Entrenamiento supervisado</span><h2>Evalúa sugerencias antes de usarlas</h2><p>Estos escenarios de demostración permiten registrar el criterio del equipo. El resultado mejora las reglas operativas, pero nunca activa comunicaciones, firmas, pagos ni cambios de estado automáticamente.</p></div><div className="broker-training-grid"><section className="broker-training-scenarios">{scenarios.map((scenario: BrokerAiScenario) => { const evaluation = evaluations.find((item) => item.scenarioKey === scenario.key); return <button type="button" key={scenario.key} onClick={() => setSelectedScenarioKey(scenario.key)} className={selectedScenario?.key === scenario.key ? "selected" : ""}><strong>{scenario.title}</strong><span>{evaluation ? readable(evaluation.decision) : "Pendiente de revisión"}</span><small>{scenario.trigger}</small></button>; })}</section><section className="broker-training-review">{selectedScenario ? <><span>Escenario seleccionado</span><h3>{selectedScenario.title}</h3><p><b>Cuando ocurre:</b> {selectedScenario.trigger}</p><p><b>La IA propone:</b> {selectedScenario.expectedRecommendation}</p><p className="broker-human-note">Requiere confirmación humana antes de afectar la operación.</p><label>Comentario del equipo<textarea value={evaluationNote} onChange={(event) => setEvaluationNote(event.target.value)} rows={4} placeholder="Qué fue útil, qué debe cambiar o qué evidencia faltó" /></label><div><button className="primary-btn" disabled={busy} onClick={() => saveEvaluation("CONFIRMED")}>Confirmar sugerencia</button><button className="secondary-btn" disabled={busy} onClick={() => saveEvaluation("ADJUSTMENT_NEEDED")}>Pedir ajuste</button><button className="secondary-btn" disabled={busy} onClick={() => saveEvaluation("DISCARDED")}>Descartar</button></div></> : <p className="broker-empty">No hay escenarios de entrenamiento disponibles.</p>}</section></div><section className="broker-automation-rules"><span>Automatizaciones seguras</span><div>{automationRules.map((rule) => <article key={rule.key}><b>{rule.title}</b><p><strong>Disparador:</strong> {rule.trigger}</p><p><strong>Acción interna:</strong> {rule.action}</p><small>{rule.approval}</small></article>)}</div></section></section> : null}
  </main>;
}
