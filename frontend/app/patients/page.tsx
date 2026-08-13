"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { DataManagementWorkspace } from "@/components/data-management-workspace";
import { createIndustryRecord, getIndustryRecords, getMe, updateIndustryRecord, type IndustryRecord } from "@/lib/api";
import { useAgentSession } from "@/lib/auth";

const emptyPatient = { name: "", phone: "", email: "", reason: "", professional: "", notes: "", status: "ACTIVE" };

function valueOf(record: IndustryRecord, key: string): string {
  const value = record.data?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function patientCopy(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  if (value.includes("VETER")) return { eyebrow: "Clínica veterinaria", title: "Pacientes y tutores", subtitle: "Mantén separada la ficha del paciente animal, su tutor y el historial de atención.", name: "Paciente / mascota", reason: "Motivo de consulta" };
  if (value.includes("DENT")) return { eyebrow: "Clínica dental", title: "Pacientes y tratamientos", subtitle: "Registra pacientes, tratamiento de interés y continuidad de la atención dental.", name: "Paciente", reason: "Tratamiento o motivo" };
  return { eyebrow: "Salud clínica", title: "Pacientes y atención", subtitle: "Registra pacientes, antecedentes relevantes y seguimiento de cada atención.", name: "Paciente", reason: "Prestación o motivo" };
}

export default function PatientsPage() {
  const agent = useAgentSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [patients, setPatients] = useState<IndustryRecord[]>([]);
  const [industry, setIndustry] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPatient);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const copy = patientCopy(industry);
  const active = useMemo(() => patients.filter((item) => item.status !== "ARCHIVED"), [patients]);
  const selectedPatient = useMemo(() => active.find((item) => item.id === selectedPatientId) || null, [active, selectedPatientId]);

  async function load() {
    try {
      const [records, me] = await Promise.all([getIndustryRecords("patient"), getMe().catch(() => null)]);
      setPatients(records);
      setIndustry(me?.tenant?.industry || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los pacientes");
    }
  }

  useEffect(() => { load(); }, []);

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) return;
    try {
      setSaving(true); setError(null);
      await createIndustryRecord({ recordType: "patient", title: form.name.trim(), status: form.status, data: { phone: form.phone, email: form.email, reason: form.reason, professional: form.professional, notes: form.notes } });
      setForm(emptyPatient);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el paciente");
    } finally { setSaving(false); }
  }

  async function changeStatus(patient: IndustryRecord, status: string) {
    try { await updateIndustryRecord(patient.id, { status }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo actualizar el paciente"); }
  }

  return <ModuleGate moduleKey="patients">
    <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar active="Pacientes" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
      <main className="vertical-page industry-service-page">
        <header className="vertical-hero service-hero"><div><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.subtitle}</p></div><div className="vertical-hero-stats"><article><strong>{active.length}</strong><span>Pacientes activos</span></article><article><strong>{active.filter((item) => item.status === "PENDING").length}</strong><span>Pendientes</span></article></div></header>
        {error ? <div className="sales-queue-error">{error}</div> : null}
        <DataManagementWorkspace
          eyebrow="NUEVA FICHA"
          title={copy.name}
          description="Ingresa lo esencial primero. La ficha ampliada queda disponible solo cuando necesitas más antecedentes."
          onSubmit={createPatient}
          primaryFields={<>
            <label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={copy.name} required /></label>
            <label>Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" /></label>
            <label>Motivo<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={copy.reason} /></label>
          </>}
          advancedFields={<>
            <label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="correo@empresa.cl" /></label>
            <label>Profesional responsable<input value={form.professional} onChange={(event) => setForm({ ...form, professional: event.target.value })} placeholder="Nombre del profesional" /></label>
            <label>Estado<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Activa</option><option value="PENDING">Pendiente</option><option value="FOLLOWUP">Seguimiento</option></select></label>
            <label className="data-field-wide">Notas y seguimiento<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Antecedentes administrativos, notas o seguimiento" rows={4} /></label>
          </>}
          actions={<button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar ficha"}</button>}
          recordsTitle="Pacientes recientes"
          recordsDescription="Selecciona una ficha para revisar sus antecedentes sin perder de vista el historial."
          records={<div className="data-record-table" role="table" aria-label="Pacientes registrados"><div className="data-record-table-head" role="row"><span>Paciente</span><span>Contacto y motivo</span><span>Responsable</span><span>Estado</span></div>{active.length ? active.map((patient) => <article key={patient.id} role="row" className={`data-record-table-row ${selectedPatientId === patient.id ? "selected" : ""}`} onClick={() => setSelectedPatientId(patient.id)}><div className="data-record-person"><b>{patient.title.slice(0, 2).toUpperCase()}</b><strong>{patient.title}</strong></div><span>{valueOf(patient, "phone") || "Sin teléfono"} · {valueOf(patient, "reason") || "Sin motivo"}</span><span>{valueOf(patient, "professional") || "Sin asignar"}</span><select aria-label={`Estado de ${patient.title}`} value={patient.status} onClick={(event) => event.stopPropagation()} onChange={(event) => changeStatus(patient, event.target.value)}><option value="ACTIVE">Activa</option><option value="PENDING">Pendiente</option><option value="FOLLOWUP">Seguimiento</option><option value="ARCHIVED">Archivada</option></select></article>) : <p className="operations-table-empty">Aún no hay pacientes registrados.</p>}</div>}
          detail={selectedPatient ? <><div><span>FICHA SELECCIONADA</span><h2>{selectedPatient.title}</h2></div><dl className="data-detail-grid"><div><dt>Teléfono</dt><dd>{valueOf(selectedPatient, "phone") || "Sin teléfono"}</dd></div><div><dt>Correo</dt><dd>{valueOf(selectedPatient, "email") || "Sin correo"}</dd></div><div><dt>Motivo</dt><dd>{valueOf(selectedPatient, "reason") || "Sin motivo"}</dd></div><div><dt>Profesional</dt><dd>{valueOf(selectedPatient, "professional") || "Sin asignar"}</dd></div><div className="data-detail-wide"><dt>Notas</dt><dd>{valueOf(selectedPatient, "notes") || "Sin notas registradas"}</dd></div></dl></> : null}
        />
      </main>
    </div>
  </ModuleGate>;
}
