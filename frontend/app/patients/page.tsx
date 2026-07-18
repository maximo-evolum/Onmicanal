"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createIndustryRecord, getIndustryRecords, getMe, updateIndustryRecord, type IndustryRecord } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

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
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [patients, setPatients] = useState<IndustryRecord[]>([]);
  const [industry, setIndustry] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPatient);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = patientCopy(industry);
  const active = useMemo(() => patients.filter((item) => item.status !== "ARCHIVED"), [patients]);

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
        <section className="service-grid">
          <form className="vertical-card vertical-form" onSubmit={createPatient}>
            <div><span>Nueva ficha clínica</span><h2>{copy.name}</h2></div>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={copy.name} required />
            <div className="vertical-two"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" /><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Correo" /></div>
            <div className="vertical-two"><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={copy.reason} /><input value={form.professional} onChange={(event) => setForm({ ...form, professional: event.target.value })} placeholder="Profesional responsable" /></div>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notas y seguimiento" rows={4} />
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Activa</option><option value="PENDING">Pendiente</option><option value="FOLLOWUP">Seguimiento</option></select>
            <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar paciente"}</button>
          </form>
          <section className="vertical-card"><div className="vertical-card-head"><div><span>Atención clínica</span><h2>Pacientes recientes</h2></div></div><div className="service-record-list">{active.length ? active.map((patient) => <article key={patient.id} className="service-record-card"><div className="service-record-avatar">{patient.title.slice(0, 2).toUpperCase()}</div><div><strong>{patient.title}</strong><span>{valueOf(patient, "phone") || "Sin teléfono"} · {valueOf(patient, "reason") || "Sin motivo"}</span><small>{valueOf(patient, "professional") || valueOf(patient, "notes") || "Sin seguimiento"}</small></div><select value={patient.status} onChange={(event) => changeStatus(patient, event.target.value)}><option value="ACTIVE">Activa</option><option value="PENDING">Pendiente</option><option value="FOLLOWUP">Seguimiento</option><option value="ARCHIVED">Archivada</option></select></article>) : <p className="meta-line">Aún no hay pacientes registrados.</p>}</div></section>
        </section>
      </main>
    </div>
  </ModuleGate>;
}
