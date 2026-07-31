"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createIndustryRecord, getIndustryRecords, getMe, type IndustryRecord } from "@/lib/api";

type ShiftForm = { worker: string; role: string; date: string; startsAt: string; endsAt: string; location: string; notes: string };

function industryCopy(industry?: string | null) {
  const value = String(industry || "").toUpperCase();
  if (value.includes("GASTRON")) return { eyebrow: "OPERACIÓN GASTRONÓMICA", title: "Turnos de local", workers: "garzones, cocina y responsables de local", roles: "Garzón, cocina, jefe de turno, anfitrión" };
  if (value.includes("DENT")) return { eyebrow: "OPERACIÓN DENTAL", title: "Turnos odontológicos", workers: "dentistas, asistentes y recepción", roles: "Dentista, asistente dental, recepción, higienista" };
  if (value.includes("VETER")) return { eyebrow: "OPERACIÓN VETERINARIA", title: "Turnos veterinarios", workers: "veterinarios, técnicos y recepción", roles: "Veterinario, técnico veterinario, hospitalización, recepción" };
  return { eyebrow: "OPERACIÓN CLÍNICA", title: "Turnos clínicos", workers: "médicos, profesionales y recepción", roles: "Médico, profesional de salud, enfermería, recepción" };
}

function shiftData(record: IndustryRecord, key: string, fallback = "-") {
  const value = record.data?.[key];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export default function ShiftsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [industry, setIndustry] = useState<string | null>(null);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftForm>({ worker: "", role: "", date: new Date().toISOString().slice(0, 10), startsAt: "09:00", endsAt: "18:00", location: "", notes: "" });
  const copy = useMemo(() => industryCopy(industry), [industry]);

  async function load() {
    const [me, shifts] = await Promise.all([getMe().catch(() => null), getIndustryRecords("shift").catch(() => [])]);
    setIndustry(me?.tenant?.industry || null);
    setRecords(shifts);
  }

  useEffect(() => { load().catch(() => undefined); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.worker.trim() || !form.role.trim() || !form.date || !form.startsAt || !form.endsAt) {
      setMessage("Completa persona, rol, fecha y horario del turno."); return;
    }
    setSaving(true); setMessage(null);
    try {
      await createIndustryRecord({
        recordType: "shift",
        title: `${form.worker.trim()} · ${form.date}`,
        status: "SCHEDULED",
        data: { worker: form.worker.trim(), role: form.role.trim(), date: form.date, startsAt: form.startsAt, endsAt: form.endsAt, location: form.location.trim(), notes: form.notes.trim(), industry, source: "shift_management" }
      });
      setForm((current) => ({ ...current, worker: "", role: "", location: "", notes: "" }));
      setMessage("Turno guardado. Agenda puede usar esta disponibilidad para organizar la operación.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el turno.");
    } finally { setSaving(false); }
  }

  return <div className={`vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
    <EvolumSidebar active="Turnos" isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
    <main className="vertical-main shifts-page">
      <ModuleGate moduleKey="shift_management">
        <section className="shifts-hero">
          <div><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>Organiza la cobertura de {copy.workers}. Los turnos se mantienen separados por rubro y complementan la Agenda de EVOLUM.</p></div>
          <div className="shifts-hero-metric"><b>{records.filter((item) => shiftData(item, "date") === form.date).length}</b><small>turnos para esta fecha</small></div>
        </section>
        <section className="shifts-grid">
          <form className="shifts-panel" onSubmit={submit}>
            <span className="shifts-kicker">NUEVO TURNO</span><h2>Planifica la jornada</h2><p>Registra quién trabaja, qué función cubre y en qué horario.</p>
            <label>Persona<input value={form.worker} onChange={(event) => setForm((current) => ({ ...current, worker: event.target.value }))} placeholder="Nombre de la persona" /></label>
            <label>Rol<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder={copy.roles} /></label>
            <div className="shifts-form-row"><label>Fecha<input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label><label>Inicio<input type="time" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>Fin<input type="time" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label></div>
            <label>Sucursal, box o estación<input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Ej.: Box 2, cocina principal, sucursal Centro" /></label>
            <label>Notas (opcional)<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Indicaciones, reemplazo o cobertura especial" /></label>
            <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar turno"}</button>
            {message && <p className="shifts-message">{message}</p>}
          </form>
          <section className="shifts-panel shifts-list"><span className="shifts-kicker">DOTACIÓN PROGRAMADA</span><h2>Próximos turnos</h2>{records.length ? records.slice(0, 30).map((record) => <article key={record.id}><div><strong>{shiftData(record, "worker")}</strong><span>{shiftData(record, "role")}{shiftData(record, "location", "") ? ` · ${shiftData(record, "location", "")}` : ""}</span></div><div><b>{shiftData(record, "date")}</b><small>{shiftData(record, "startsAt")} — {shiftData(record, "endsAt")}</small></div></article>) : <p>Aún no hay turnos programados. Crea el primero para comenzar a organizar la jornada.</p>}</section>
        </section>
      </ModuleGate>
    </main>
  </div>;
}
