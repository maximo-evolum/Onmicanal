"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { DataManagementWorkspace } from "@/components/data-management-workspace";
import { createIndustryRecord, getIndustryRecords, getMe, type IndustryRecord } from "@/lib/api";
import { useAgentSession } from "@/lib/auth";
import type { ModuleAccessKey } from "@/lib/module-access";

type Entity = { type: string; label: string; fields: string[]; description: string };
type Profile = { industry: string; module: ModuleAccessKey; eyebrow: string; title: string; summary: string; safeNotice: string; entities: Entity[]; steps: string[] };

const profiles: Record<string, Profile> = {
  gastronomy: {
    industry: "GASTRONOMY", module: "gastronomy_operations", eyebrow: "OPERACIÓN GASTRONÓMICA", title: "Servicio de restaurante", summary: "Controla mesas, comandas, clientes frecuentes y el cierre diario. Agenda, pagos, campañas y dashboard siguen siendo parte del Core EVOLUM.", safeNotice: "El asistente operativo ordena pendientes y cobertura; no crea cobros ni publica cambios sin confirmación.",
    entities: [
      { type: "restaurant_table", label: "Mesa", fields: ["numero", "sector", "capacidad", "estado"], description: "Disponibilidad y capacidad de cada mesa." },
      { type: "restaurant_order", label: "Comanda", fields: ["mesa", "cliente", "items", "responsable", "total", "estado"], description: "Pedido abierto, preparación, entrega y cierre." },
      { type: "restaurant_guest", label: "Cliente frecuente", fields: ["nombre", "telefono", "preferencias", "observaciones"], description: "Preferencias e historial de atención." },
      { type: "restaurant_daily_close", label: "Cierre diario", fields: ["fecha", "ventas", "pagos", "diferencias", "responsable", "notas"], description: "Resumen operativo para revisión del encargado." }
    ],
    steps: ["Recibe reserva o llegada", "Asigna mesa", "Abre y atiende comanda", "Confirma pago en el Core", "Revisa y guarda cierre diario"]
  },
  dental: {
    industry: "DENTAL", module: "dental_care", eyebrow: "ATENCIÓN DENTAL", title: "Operación odontológica", summary: "Reúne ficha dental, odontograma, tratamiento y consentimiento en un flujo independiente de otras clínicas.", safeNotice: "La ayuda IA solo organiza datos y pendientes. Todo diagnóstico, tratamiento, consentimiento y decisión clínica requiere revisión de un profesional autorizado.",
    entities: [
      { type: "dental_patient", label: "Ficha dental", fields: ["nombre", "telefono", "antecedentes", "alergias", "observaciones"], description: "Identificación y antecedentes declarados por el paciente." },
      { type: "dental_odontogram", label: "Odontograma", fields: ["paciente", "pieza", "estado", "profesional", "observaciones"], description: "Registro por pieza dental, validado por el profesional." },
      { type: "dental_treatment", label: "Tratamiento", fields: ["paciente", "tipo", "presupuesto", "profesional", "estado", "notas"], description: "Plan de trabajo y presupuesto sujeto a aprobación." },
      { type: "dental_consent", label: "Consentimiento", fields: ["paciente", "tratamiento", "fecha", "estado", "archivo"], description: "Control de consentimiento y documentos asociados." }
    ],
    steps: ["Crea ficha", "Registra odontograma", "Prepara tratamiento y presupuesto", "Gestiona consentimiento", "Agenda y realiza seguimiento"]
  },
  health: {
    industry: "HEALTH", module: "health_care", eyebrow: "ATENCIÓN CLÍNICA", title: "Operación clínica", summary: "Gestiona fichas, atenciones, órdenes y seguimientos administrativos sin mezclar información con dental o veterinaria.", safeNotice: "La ayuda IA es administrativa: identifica información faltante y próximos pasos. Nunca diagnostica, indica tratamientos ni sustituye una decisión clínica.",
    entities: [
      { type: "clinical_patient", label: "Ficha clínica", fields: ["nombre", "telefono", "antecedentes", "alergias", "contacto_emergencia"], description: "Datos de identificación y antecedentes informados." },
      { type: "clinical_attention", label: "Atención", fields: ["paciente", "profesional", "especialidad", "fecha", "motivo", "estado"], description: "Registro de la atención y su estado operativo." },
      { type: "clinical_order", label: "Orden o presupuesto", fields: ["paciente", "tipo", "profesional", "monto", "estado", "notas"], description: "Órdenes y presupuestos para control administrativo." },
      { type: "clinical_followup", label: "Seguimiento", fields: ["paciente", "fecha", "canal", "estado", "notas"], description: "Recordatorios y continuidad coordinada por el equipo." }
    ],
    steps: ["Crea ficha", "Agenda atención", "Registra atención", "Emite orden o presupuesto", "Revisión profesional", "Da seguimiento"]
  },
  veterinary: {
    industry: "VETERINARY", module: "veterinary_care", eyebrow: "ATENCIÓN VETERINARIA", title: "Operación veterinaria", summary: "Administra mascotas y tutores, vacunas, hospitalización y documentos de atención en una vertical separada.", safeNotice: "La ayuda IA organiza agenda, vacunas y pendientes. Un veterinario autorizado debe revisar cualquier diagnóstico, receta, indicación u hospitalización.",
    entities: [
      { type: "veterinary_pet", label: "Mascota y tutor", fields: ["nombre", "especie", "raza", "edad", "tutor", "telefono_tutor", "antecedentes"], description: "Ficha del paciente animal y de su responsable." },
      { type: "veterinary_vaccine", label: "Vacuna o control", fields: ["mascota", "vacuna", "fecha", "proxima_fecha", "profesional", "estado"], description: "Vacunas, controles y próximos recordatorios." },
      { type: "veterinary_hospitalization", label: "Hospitalización", fields: ["mascota", "ingreso", "estado", "responsable", "observaciones"], description: "Control operativo con responsable asignado." },
      { type: "veterinary_prescription", label: "Receta o presupuesto", fields: ["mascota", "tipo", "profesional", "monto", "estado", "notas"], description: "Documento clínico sujeto a aprobación veterinaria." }
    ],
    steps: ["Crea ficha de mascota", "Agenda atención", "Registra vacuna o control", "Gestiona hospitalización", "Revisión veterinaria", "Da seguimiento al tutor"]
  }
};

const fieldLabels: Record<string, string> = { numero: "Número", sector: "Sector", capacidad: "Capacidad", estado: "Estado", mesa: "Mesa", cliente: "Cliente", items: "Pedido / ítems", responsable: "Responsable", total: "Total", nombre: "Nombre", telefono: "Teléfono", preferencias: "Preferencias", observaciones: "Observaciones", fecha: "Fecha", ventas: "Ventas", pagos: "Pagos", diferencias: "Diferencias", notas: "Notas", antecedentes: "Antecedentes", alergias: "Alergias", paciente: "Paciente", pieza: "Pieza dental", profesional: "Profesional", tipo: "Tipo", presupuesto: "Presupuesto", tratamiento: "Tratamiento", archivo: "Documento", contacto_emergencia: "Contacto de emergencia", especialidad: "Especialidad", motivo: "Motivo", canal: "Canal", especie: "Especie", raza: "Raza", edad: "Edad", tutor: "Tutor", telefono_tutor: "Teléfono del tutor", mascota: "Mascota", vacuna: "Vacuna", proxima_fecha: "Próxima fecha", ingreso: "Fecha de ingreso", monto: "Monto" };

function industryMatches(current: string | null, expected: string) {
  const value = String(current || "").toUpperCase();
  if (expected === "GASTRONOMY") return value.includes("GASTRON");
  if (expected === "HEALTH") return value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC");
  return value.includes(expected);
}

function displayValue(value: unknown) { return value === undefined || value === null || value === "" ? "Sin información" : String(value); }

const recordFieldAliases: Record<string, string[]> = {
  nombre: ["nombre", "name", "customerName", "client"], telefono: ["telefono", "phone"],
  paciente: ["paciente", "patient", "patientName", "patientId", "name"], mascota: ["mascota", "pet", "petName", "petId", "name"],
  numero: ["numero", "number"], mesa: ["mesa", "table", "tableNumber", "tableId"], fecha: ["fecha", "date", "scheduledAt", "admissionDate", "nextDueDate"],
  profesional: ["profesional", "professional", "responsible"], responsable: ["responsable", "responsible", "professional"],
  tipo: ["tipo", "type", "vaccine"], estado: ["estado", "status"], tratamiento: ["tratamiento", "treatment", "type"],
  vacuna: ["vacuna", "vaccine"], ingreso: ["ingreso", "admissionDate", "date"], monto: ["monto", "amount", "budget", "total"],
  ventas: ["ventas", "sales"], pagos: ["pagos", "payments"], preferencias: ["preferencias", "preferences"], items: ["items"],
  antecedentes: ["antecedentes", "history"], observaciones: ["observaciones", "observations"], contacto_emergencia: ["contacto_emergencia", "emergencyContact"],
  alergias: ["alergias", "allergies"], pieza: ["pieza", "piece"], presupuesto: ["presupuesto", "budget", "amount"],
  archivo: ["archivo", "file"], especialidad: ["especialidad", "specialty"], motivo: ["motivo", "reason"], canal: ["canal", "channel"],
  especie: ["especie", "species"], raza: ["raza", "breed"], edad: ["edad", "age"], telefono_tutor: ["telefono_tutor", "phone"],
  proxima_fecha: ["proxima_fecha", "nextDueDate"], capacidad: ["capacidad", "capacity"], diferencias: ["diferencias", "differences"],
};

const dataFieldLabels: Record<string, string> = {
  name: "Nombre", phone: "Teléfono", patientId: "Paciente", petId: "Mascota", professional: "Profesional",
  responsible: "Responsable", specialty: "Especialidad", reason: "Motivo", date: "Fecha", amount: "Monto",
  budget: "Presupuesto", type: "Tipo", status: "Estado", nextDueDate: "Próxima fecha", admissionDate: "Fecha de ingreso",
  startTime: "Hora de inicio", endTime: "Hora de término", coverage: "Cobertura",
};

function recordFieldValue(record: IndustryRecord, field: string) {
  const data = record.data || {};
  const key = (recordFieldAliases[field] || [field]).find((candidate) => data[candidate] !== undefined && data[candidate] !== null && data[candidate] !== "");
  return key ? displayValue(data[key]) : "Sin información";
}

function displayFieldLabel(key: string) { return dataFieldLabels[key] || fieldLabels[key] || key.replace(/([A-Z])/g, " $1").replaceAll("_", " "); }
function displayRecordTitle(value: string) { return value.replace(/^TRAINING-[^|]+\|\s*/i, ""); }
function recordStatusLabel(status?: string | null) {
  const labels: Record<string, string> = { ACTIVE: "Activo", PENDING: "Pendiente", SCHEDULED: "Agendado", OPEN: "Abierto", DRAFT: "Borrador", APPLIED: "Aplicado", READY: "Listo", CLOSED: "Cerrado", PROPOSED: "Propuesto", MONITORING: "En observación", PENDING_SIGNATURE: "Pendiente de firma" };
  return labels[String(status || "").toUpperCase()] || String(status || "Pendiente").replaceAll("_", " ");
}

function recordFieldDisplay(record: IndustryRecord, field: string, references: Map<string, string>) {
  const data = record.data || {};
  const key = (recordFieldAliases[field] || [field]).find((candidate) => data[candidate] !== undefined && data[candidate] !== null && data[candidate] !== "");
  if (!key && field === "estado") return displayValue(record.status);
  const value = key ? data[key] : undefined;
  if (typeof value === "string" && references.has(value)) return references.get(value) || "Sin información";
  if (Array.isArray(value)) return value.join(", ");
  return key ? displayValue(value) : "Sin información";
}

export default function VerticalOperationsPage() {
  const params = useParams<{ vertical: string }>();
  const profile = profiles[String(params?.vertical || "").toLowerCase()];
  const session = useAgentSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [industry, setIndustry] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, IndustryRecord[]>>({});
  const [selectedType, setSelectedType] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<IndustryRecord | null>(null);

  const entity = profile?.entities.find((item) => item.type === selectedType) || profile?.entities[0];
  const totalRecords = useMemo(() => Object.values(records).reduce((total, list) => total + list.length, 0), [records]);
  const selectedRecords = useMemo(() => entity ? records[entity.type] || [] : [], [entity, records]);
  const referenceTitles = useMemo(() => new Map(Object.values(records).flat().map((record) => [record.id, displayRecordTitle(record.title)])), [records]);
  const visibleFields = entity?.fields.slice(0, 3) || [];

  async function load() {
    if (!profile) return;
    const me = await getMe();
    setIndustry(me.tenant?.industry || null);
    if (!industryMatches(me.tenant?.industry || null, profile.industry) && me.user?.role !== "SUPER_ADMIN") return;
    const values = await Promise.all(profile.entities.map(async (item) => [item.type, await getIndustryRecords(item.type)] as const));
    setRecords(Object.fromEntries(values));
  }

  useEffect(() => { if (profile) { setSelectedType(profile.entities[0].type); void load().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudo cargar la operación.")); } }, [params?.vertical]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entity) return;
    const title = values.nombre || values.mascota || values.paciente || values.numero || values.mesa || values.fecha || entity.label;
    if (!String(title).trim()) { setNotice("Completa al menos el dato principal para guardar el registro."); return; }
    setSaving(true); setNotice(null);
    try {
      await createIndustryRecord({ recordType: entity.type, title: String(title).trim(), status: values.estado || "PENDING", data: { ...values, vertical: profile?.industry, createdFrom: "vertical_operations" } });
      setValues({});
      setNotice(`${entity.label} guardado. El equipo puede continuar el flujo desde este mismo módulo.`);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo guardar el registro."); }
    finally { setSaving(false); }
  }

  if (!profile) return <main className="vertical-page"><section className="vertical-card"><h1>Vertical no encontrada</h1><p>Selecciona una operación válida desde el menú EV.</p></section></main>;
  if (industry && !industryMatches(industry, profile.industry) && session?.role !== "SUPER_ADMIN") return <main className="vertical-page"><section className="vertical-card"><h1>Esta operación pertenece a otro rubro</h1><p>EVOLUM protege la información de cada vertical y no permite abrirla desde esta cuenta.</p></section></main>;

  return <div className={`vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
    <EvolumSidebar active={profile.title} isDeveloper={session?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
    <main className="vertical-page industry-service-page operations-page">
      <ModuleGate moduleKey={profile.module}>
        <header className="vertical-hero service-hero operations-hero"><div><span>{profile.eyebrow}</span><h1>{profile.title}</h1><p>{profile.summary}</p></div><div className="vertical-hero-stats"><article><strong>{totalRecords}</strong><span>registros operativos</span></article><article><strong>{entity?.fields.length || 0}</strong><span>datos por ficha</span></article></div></header>
        <DataManagementWorkspace
          className="operations-data-workspace"
          eyebrow="NUEVO REGISTRO"
          title={entity?.label || "Registro"}
          description={entity?.description || "Completa los datos esenciales para iniciar el proceso."}
          onSubmit={submit}
          primaryFields={<>
            <div className="data-field-wide operations-entity-tabs">{profile.entities.map((item) => <button type="button" className={entity?.type === item.type ? "active" : ""} key={item.type} onClick={() => { setSelectedType(item.type); setValues({}); setSelectedRecord(null); }}>{item.label}</button>)}</div>
            {entity?.fields.slice(0, 3).map((field) => <label key={field}>{fieldLabels[field] || field}<input value={values[field] || ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} placeholder={fieldLabels[field] || field} /></label>)}
          </>}
          advancedFields={<>{entity?.fields.slice(3).map((field) => <label key={field}>{fieldLabels[field] || field}<input value={values[field] || ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} placeholder={fieldLabels[field] || field} /></label>)}</>}
          actions={<><button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : `Guardar ${entity?.label.toLowerCase()}`}</button>{notice ? <p className="operations-notice">{notice}</p> : null}</>}
          support={<><span>ASISTENTE OPERATIVO</span><h2>Ayuda para el equipo</h2><p>{profile.safeNotice}</p><div className="operations-agent-status"><strong>{totalRecords ? "Operación en curso" : "Preparado para comenzar"}</strong><small>{totalRecords ? `Hay ${totalRecords} registros disponibles para revisar y continuar.` : "Crea el primer registro para activar el flujo de trabajo."}</small></div><ul><li>Revisa datos faltantes antes de pasar a la siguiente etapa.</li><li>Organiza pendientes y seguimiento de la jornada.</li><li>Deja decisiones sensibles para aprobación humana.</li></ul></>}
          recordsTitle={entity ? `Registros de ${entity.label}` : "Registros de la vertical"}
          recordsDescription="La tabla muestra exactamente los datos principales que se solicitan en el formulario de esta ficha."
          records={<div className="operations-data-table operations-entity-table" role="table" aria-label={`Registros de ${entity?.label || "la vertical"}`}><div className="operations-data-table-head" role="row"><span>Registro</span>{visibleFields.map((field) => <span key={field}>{fieldLabels[field] || field}</span>)}<span>Estado</span><span>Actualizado</span></div>{selectedRecords.length ? selectedRecords.map((record) => <button type="button" role="row" className={`operations-data-row ${selectedRecord?.id === record.id ? "selected" : ""}`} key={record.id} onClick={() => setSelectedRecord(record)}><span className="operations-record-name"><b>{displayRecordTitle(record.title)}</b><small>Ver ficha completa</small></span>{visibleFields.map((field) => <span className="operations-record-summary" key={field}>{recordFieldDisplay(record, field, referenceTitles)}</span>)}<span><em className={`operations-status status-${String(record.status || "pending").toLowerCase()}`}>{recordStatusLabel(record.status)}</em></span><time dateTime={record.updatedAt}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(record.updatedAt))}</time></button>) : <p className="operations-table-empty">Aún no hay {entity?.label.toLowerCase() || "registros"}. Crea el primero desde el formulario superior.</p>}</div>}
          detail={selectedRecord && entity ? <><div><span>FICHA SELECCIONADA</span><h2>{displayRecordTitle(selectedRecord.title)}</h2></div><dl className="data-detail-grid">{entity.fields.map((field) => <div key={field}><dt>{fieldLabels[field] || displayFieldLabel(field)}</dt><dd>{recordFieldDisplay(selectedRecord, field, referenceTitles)}</dd></div>)}</dl></> : null}
        />
      </ModuleGate>
    </main>
  </div>;
}
