"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createIndustryRecord, getIndustryRecords, type IndustryRecord } from "@/lib/api";
import { useAgentSession } from "@/lib/auth";

const emptyForm = { title: "", patient: "", type: "EXAMEN", status: "PENDING", amount: "", notes: "" };

function valueOf(record: IndustryRecord, key: string) {
  const value = record.data?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export default function ExamsPage() {
  const agent = useAgentSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      setRecords(await getIndustryRecords("exam"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los exámenes y presupuestos");
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => records.filter((record) => record.status === "PENDING").length, [records]);
  const budgeted = useMemo(() => records.reduce((total, record) => total + Number(record.data?.amount || 0), 0), [records]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.patient.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await createIndustryRecord({
        recordType: "exam",
        title: form.title,
        status: form.status,
        data: {
          patient: form.patient,
          type: form.type,
          amount: Number(form.amount || 0),
          notes: form.notes,
        },
      });
      setForm(emptyForm);
      setNotice("Registro guardado correctamente.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el registro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleGate moduleKey="exams">
      <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Exámenes y presupuestos" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="main dashboard-page exams-page">
          <header className="module-app-header">
            <div>
              <span className="eyebrow">Atención clínica</span>
              <h1>Exámenes y presupuestos</h1>
              <p className="meta-line">Órdenes, resultados, tratamientos y cotizaciones asociados a cada paciente.</p>
            </div>
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </header>

          <section className="reports-summary-grid">
            <article className="reports-summary-card"><span>Registros</span><strong>{records.length}</strong><small>Exámenes y presupuestos</small></article>
            <article className="reports-summary-card"><span>Pendientes</span><strong>{pending}</strong><small>Requieren seguimiento</small></article>
            <article className="reports-summary-card"><span>Presupuestado</span><strong>{new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(budgeted)}</strong><small>Total registrado</small></article>
          </section>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {notice ? <div className="admin-notice success">{notice}</div> : null}

          <section className="service-grid">
            <form className="vertical-card vertical-form" onSubmit={submit}>
              <div><span>Nuevo registro</span><h2>Examen o presupuesto</h2></div>
              <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ej: Radiografía panorámica" />
              <input required value={form.patient} onChange={(event) => setForm({ ...form, patient: event.target.value })} placeholder="Paciente asociado" />
              <div className="vertical-two">
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  <option value="EXAMEN">Examen</option>
                  <option value="PRESUPUESTO">Presupuesto</option>
                  <option value="TRATAMIENTO">Plan de tratamiento</option>
                </select>
                <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} inputMode="numeric" placeholder="Monto CLP" />
              </div>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} placeholder="Resultado, indicaciones o detalle del presupuesto" />
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="PENDING">Pendiente</option>
                <option value="READY">Disponible</option>
                <option value="APPROVED">Aprobado</option>
                <option value="REJECTED">Rechazado</option>
              </select>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar registro"}</button>
            </form>

            <section className="vertical-card">
              <div className="vertical-card-head"><div><span>Historial</span><h2>Registros recientes</h2></div></div>
              <div className="service-record-list">
                {records.length ? records.map((record) => (
                  <article className="service-record-card" key={record.id}>
                    <div className="service-record-avatar">EP</div>
                    <div>
                      <strong>{record.title}</strong>
                      <span>{valueOf(record, "patient")} · {valueOf(record, "type")}</span>
                      <small>{valueOf(record, "amount") ? `$ ${new Intl.NumberFormat("es-CL").format(Number(valueOf(record, "amount")))}` : "Sin monto"}</small>
                    </div>
                    <span className="badge accent">{record.status}</span>
                  </article>
                )) : <p className="meta-line">Aún no hay registros clínicos.</p>}
              </div>
            </section>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
