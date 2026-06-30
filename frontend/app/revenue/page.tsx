"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createIndustryRecord, getIndustryRecords, getMe, updateIndustryRecord, type IndustryRecord } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

const emptyRevenue = {
  title: "",
  amount: "",
  source: "",
  customer: "",
  date: "",
  notes: "",
  status: "PENDING"
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount || 0);
}

function valueOf(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

function statusLabel(status: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAID") return "Pagado";
  if (normalized === "PENDING") return "Pendiente";
  if (normalized === "CANCELLED") return "Cancelado";
  return normalized || "Pendiente";
}

export default function RevenuePage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [industryLabel, setIndustryLabel] = useState("Multirubro");
  const [form, setForm] = useState(emptyRevenue);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setError(null);
      const [revenueData, me] = await Promise.all([
        getIndustryRecords("revenue"),
        getMe().catch(() => null)
      ]);
      setRecords(revenueData);
      setIndustryLabel(me?.tenant?.industry || "Multirubro");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar ingresos");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = useMemo(() => records.filter((record) => record.status !== "ARCHIVED"), [records]);
  const paid = useMemo(() => active.filter((record) => record.status === "PAID"), [active]);
  const pending = useMemo(() => active.filter((record) => record.status === "PENDING"), [active]);
  const paidTotal = useMemo(() => paid.reduce((sum, record) => sum + Number(valueOf(record, "amount") || 0), 0), [paid]);
  const pendingTotal = useMemo(() => pending.reduce((sum, record) => sum + Number(valueOf(record, "amount") || 0), 0), [pending]);
  const conversion = active.length ? Math.round((paid.length / active.length) * 100) : 0;

  async function createRevenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      await createIndustryRecord({
        recordType: "revenue",
        title: form.title,
        status: form.status,
        data: {
          amount: Number(form.amount || 0),
          source: form.source,
          customer: form.customer,
          date: form.date,
          notes: form.notes
        }
      });
      setForm(emptyRevenue);
      setMessage("Ingreso registrado.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el ingreso");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(record: IndustryRecord, status: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el ingreso");
    }
  }

  return (
    <ModuleGate moduleKey="revenue">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Ganancias" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="vertical-page industry-service-page">
          <header className="vertical-hero revenue-hero">
            <div>
              <span>{industryLabel}</span>
              <h1>Ganancias e ingresos</h1>
              <p>Registra ingresos manuales o asistidos por IA, controla pagos pendientes y visualiza conversion operativa.</p>
            </div>
            <div className="vertical-hero-stats">
              <article><strong>{money(paidTotal)}</strong><span>Pagado</span></article>
              <article><strong>{money(pendingTotal)}</strong><span>Pendiente</span></article>
              <article><strong>{conversion}%</strong><span>Conversion</span></article>
            </div>
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

          <section className="service-grid">
            <form className="vertical-card vertical-form" onSubmit={createRevenue}>
              <div>
                <span>Nuevo movimiento</span>
                <h2>Registrar ingreso</h2>
              </div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Concepto: reserva, tratamiento, evento..." required />
              <div className="vertical-two">
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Monto CLP" inputMode="numeric" />
                <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" />
              </div>
              <div className="vertical-two">
                <input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Cliente asociado" />
                <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Origen: inbox, manual, campana..." />
              </div>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas internas" rows={4} />
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="PENDING">Pendiente</option>
                <option value="PAID">Pagado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar ingreso"}</button>
            </form>

            <section className="vertical-card revenue-board">
              <div className="vertical-card-head">
                <div>
                  <span>Flujo financiero</span>
                  <h2>Movimientos recientes</h2>
                </div>
              </div>
              <div className="revenue-list">
                {active.length ? active.map((record) => (
                  <article className={`revenue-row status-${String(record.status).toLowerCase()}`} key={record.id}>
                    <div>
                      <strong>{record.title}</strong>
                      <span>{valueOf(record, "customer") || "Sin cliente"} / {valueOf(record, "source") || "manual"}</span>
                      <small>{valueOf(record, "notes") || valueOf(record, "date") || "Sin notas"}</small>
                    </div>
                    <div>
                      <strong>{money(valueOf(record, "amount"))}</strong>
                      <select value={record.status} onChange={(e) => updateStatus(record, e.target.value)}>
                        <option value="PENDING">Pendiente</option>
                        <option value="PAID">Pagado</option>
                        <option value="CANCELLED">Cancelado</option>
                        <option value="ARCHIVED">Archivado</option>
                      </select>
                    </div>
                  </article>
                )) : <p className="meta-line">Aun no hay ingresos registrados.</p>}
              </div>
            </section>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
