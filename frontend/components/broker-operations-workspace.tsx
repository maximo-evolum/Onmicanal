"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  advanceBrokerOperation,
  createBrokerOperation,
  createBrokerRecord,
  getBrokerCatalog,
  getBrokerOperations,
  getBrokerOverview,
  getBrokerPropertyExpedient,
  getBrokerRecords,
  getIndustryRecords,
  updateBrokerRecord,
  type BrokerCatalog,
  type BrokerOperation,
  type BrokerOperationType,
  type BrokerPropertyExpedient,
  type BrokerRecordArea,
  type BrokerRecordDefinition,
  type IndustryRecord
} from "@/lib/api";

type Tab = "operations" | "agents" | BrokerRecordArea;
type FieldConfig = { label: string; type?: "text" | "number" | "date" | "textarea"; placeholder?: string };

const OPERATION_LABELS: Record<BrokerOperationType, string> = {
  SALE: "Venta",
  RENTAL: "Arriendo",
  ADMINISTRATION: "Administracion"
};

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
  buyerName: { label: "Comprador o interesado", placeholder: "Nombre o empresa" },
  amount: { label: "Monto", type: "number", placeholder: "Ej.: 2500000" },
  signingDate: { label: "Fecha de firma", type: "date" },
  tenantName: { label: "Arrendatario", placeholder: "Nombre o razon social" },
  monthlyRent: { label: "Arriendo mensual", type: "number", placeholder: "Ej.: 750000" },
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
  const [tab, setTab] = useState<Tab>("operations");
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getBrokerOverview>> | null>(null);
  const [catalog, setCatalog] = useState<BrokerCatalog | null>(null);
  const [operations, setOperations] = useState<BrokerOperation[]>([]);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [properties, setProperties] = useState<IndustryRecord[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [expedient, setExpedient] = useState<BrokerPropertyExpedient | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [operationType, setOperationType] = useState<BrokerOperationType>("SALE");
  const [recordType, setRecordType] = useState("");

  const load = useCallback(async () => {
    const [nextOverview, nextOperations, nextProperties, nextCatalog] = await Promise.all([
      getBrokerOverview(), getBrokerOperations(), getIndustryRecords("property"), getBrokerCatalog()
    ]);
    setOverview(nextOverview);
    setOperations(nextOperations);
    setProperties(nextProperties);
    setCatalog(nextCatalog);
  }, []);

  useEffect(() => {
    load().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar Broker OS."));
  }, [load]);

  useEffect(() => {
    if (tab === "operations" || tab === "agents") return;
    setRecords([]);
    getBrokerRecords(tab).then(setRecords).catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar el expediente."));
  }, [tab]);

  useEffect(() => {
    if (!catalog || tab === "operations" || tab === "agents") return;
    const options = catalog.areas[tab] || [];
    setRecordType((current) => options.includes(current) ? current : options[0] || "");
  }, [catalog, tab]);

  const summary = useMemo(() => overview?.kpis || {
    properties: 0, activeOperations: 0, scheduledVisits: 0, openAlerts: 0,
    activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0
  }, [overview]);
  const recommendations = overview?.recommendations || [];
  const currentArea = tab !== "operations" && tab !== "agents" ? tab : null;
  const currentDefinition = recordType ? catalog?.recordDefinitions[recordType] : undefined;
  const currentTypes = currentArea && catalog ? catalog.areas[currentArea] || [] : [];
  const operationStages = catalog?.operationStages[operationType] || [];

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

  return <main className="broker-os-workspace">
    <header className="broker-os-header">
      <div>
        <span>Broker OS</span><h1>Centro operativo inmobiliario</h1>
        <p>Controla venta, arriendo, administracion, documentos, mantenciones y postventa desde expedientes separados por propiedad.</p>
      </div>
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
      <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>Agentes IA</button>
    </nav>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}

    {tab === "operations" ? <>
      <section className="broker-recommendations" aria-label="Prioridades operativas">
        <div className="broker-list-heading"><span>Prioridades operativas</span><h2>Qué revisar a continuación</h2><p>Son sugerencias internas basadas en la cartera. EVOLUM no cambia estados, publica ni contacta personas por su cuenta.</p></div>
        {recommendations.length ? <div className="broker-recommendation-grid">{recommendations.map((recommendation) => <article key={recommendation.id} className={`broker-recommendation ${recommendation.priority.toLowerCase()}`}><b>{recommendation.priority === "HIGH" ? "Prioridad alta" : recommendation.priority === "MEDIUM" ? "Prioridad media" : "Informativa"}</b><h3>{recommendation.title}</h3><p>{recommendation.detail}</p><button type="button" className="secondary-btn" onClick={() => setTab(recommendation.area)}>{recommendation.requiresApproval ? "Revisar y confirmar" : "Completar ficha"}</button></article>)}</div> : <p className="broker-empty">La cartera no tiene prioridades pendientes por ahora.</p>}
      </section>
      <section className="broker-expedient-panel" aria-label="Expediente por propiedad">
        <div className="broker-list-heading"><span>Expediente digital</span><h2>Revisa una propiedad completa</h2><p>Consulta documentos, contratos, mantenciones, postventa y antecedentes sin cambiar de pantalla.</p></div>
        <div className="broker-expedient-controls"><select value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)}><option value="">Selecciona una propiedad</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select><button type="button" className="primary-btn" disabled={busy || !selectedPropertyId} onClick={openExpedient}>Abrir expediente</button></div>
        {expedient ? <div className="broker-expedient-summary"><div><b>{expedient.property.title}</b><p>{expedient.completion.complete ? "Ficha completa para operación y publicación." : `Falta completar: ${expedient.completion.missing.join(", ")}.`}</p></div><div className="broker-expedient-counts">{Object.entries(expedient.grouped).filter(([, items]) => items?.length).map(([area, items]) => <span key={area}><b>{items?.length}</b>{AREA_CONFIG[area as BrokerRecordArea]?.label || readable(area)}</span>)}</div></div> : null}
      </section>
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
          return <article key={operation.id} className="broker-operation-card"><div><span>{OPERATION_LABELS[operation.data.operationType]}</span><h3>{operation.title}</h3><p>{readable(operation.data.stage)} · {String(operation.data.clientName || "Sin contraparte registrada")}</p></div><div className="broker-stage"><div><i style={{ width: `${stages.length ? ((index + 1) / stages.length) * 100 : 0}%` }} /></div><small>Etapa {index + 1} de {stages.length}: {readable(stages[index])}</small></div><button className="secondary-btn" disabled={busy || !next} onClick={() => nextStage(operation)}>{next ? `Avanzar a ${readable(next)}` : "Flujo completado"}</button></article>;
        })}
      </section>
      </section>
    </> : null}

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

    {tab === "agents" ? <section className="broker-agents-panel"><div className="broker-list-heading"><span>Agentes de IA</span><h2>Asistentes especializados del Broker</h2><p>Los agentes disponibles preparan analisis y borradores; ninguna accion legal, pago, firma o comunicacion externa se ejecuta sin aprobacion humana.</p></div><div className="broker-agent-grid">{(overview?.agents || catalog?.agents || []).map((agent) => <article key={agent.key} className={`broker-agent-card ${agent.status === "AVAILABLE" ? "available" : "planned"}`}><span>{agent.status === "AVAILABLE" ? "Disponible" : "Proxima etapa"}</span><h3>{agent.name}</h3><p>{agent.description}</p><small>Modulo: {readable(agent.module)}</small></article>)}</div></section> : null}
  </main>;
}
