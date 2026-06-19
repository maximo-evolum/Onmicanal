
"use client";

import { useEffect, useMemo, useState } from "react";
import { cancelPayment, confirmPayment, createPayment, getPaymentMetrics, getPayments, Payment, PaymentMetrics } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { EvolumSidebar } from "@/components/evolum-sidebar";

function money(value = 0, currency = "CLP") {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    PENDING: "Pendiente",
    PARTIAL: "Abono",
    PAID: "Pagado",
    FAILED: "Fallido",
    CANCELED: "Cancelado",
    REFUNDED: "Reembolsado"
  };
  return map[status] || status;
}

export default function PaymentsPage() {
  const agent = getStoredSession();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [metrics, setMetrics] = useState<PaymentMetrics | null>(null);
  const [status, setStatus] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [form, setForm] = useState({
    amount: "",
    description: "",
    conversationId: "",
    leadId: "",
    bookingId: ""
  });

  async function load(silent = false) {
    try {
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      const [list, summary] = await Promise.all([getPayments(status), getPaymentMetrics()]);
      setPayments(list);
      setMetrics(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar pagos");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(interval);
  }, [status]);

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      setPaymentNotice(null);
      await createPayment({
        amount: Number(form.amount),
        description: form.description || "Link de pago manual",
        conversationId: form.conversationId || null,
        leadId: form.leadId || null,
        bookingId: form.bookingId || null,
        provider: "manual",
        currency: "CLP"
      });
      setForm({ amount: "", description: "", conversationId: "", leadId: "", bookingId: "" });
      setPaymentNotice({ type: "success", text: "Pago creado" });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el pago");
      setPaymentNotice({ type: "error", text: "Pago mal ingresado" });
    }
  }

  async function markPaid(id: string) {
    await confirmPayment(id);
    await load(true);
  }

  async function markCanceled(id: string) {
    await cancelPayment(id);
    await load(true);
  }

  const pending = useMemo(() => payments.filter((p) => p.status === "PENDING"), [payments]);

  return (
    <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="Pagos"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />
      <main className="main dashboard-page payments-page">
        <header className="module-app-header">
          <div>
            <span className="eyebrow">Portal de pagos</span>
            <h1>Pagos, links y reservas</h1>
            <div className="meta-line">Links manuales y pagos conectados a conversaciones, leads o reservas.</div>
          </div>
          <div className="module-app-actions">
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
          </div>
        </header>

        {error ? <div className="admin-notice error">{error}</div> : null}
        {paymentNotice ? <div className={`admin-notice ${paymentNotice.type}`}>{paymentNotice.text}</div> : null}

        <section className="dashboard-grid">
          <Card title="Pagos creados" value={metrics?.count || 0} />
          <Card title="Pagado" value={money(metrics?.paidTotal || 0)} />
          <Card title="Pendiente" value={money(metrics?.pendingTotal || 0)} />
          <Card title="Conversión" value={`${metrics?.conversionRate || 0}%`} />
        </section>

        <section className="phase5-panel" style={{ marginTop: 18 }}>
          <div className="phase5-panel-head">
            <div>
              <h2>Crear link de pago</h2>
              <p>Permite dejar pagos pendientes conectados a conversacion, lead o reserva. No procesa tarjetas por si solo.</p>
            </div>
          </div>
          <form className="admin-detail-grid" onSubmit={submitPayment}>
            <label>
              <span className="meta-line">Monto CLP</span>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" required placeholder="485000" />
            </label>
            <label>
              <span className="meta-line">Descripción</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Reserva evento Servicio Mixto" />
            </label>
            <label>
              <span className="meta-line">Conversation ID opcional</span>
              <input value={form.conversationId} onChange={(e) => setForm({ ...form, conversationId: e.target.value })} />
            </label>
            <label>
              <span className="meta-line">Lead ID opcional</span>
              <input value={form.leadId} onChange={(e) => setForm({ ...form, leadId: e.target.value })} />
            </label>
            <label>
              <span className="meta-line">Booking ID opcional</span>
              <input value={form.bookingId} onChange={(e) => setForm({ ...form, bookingId: e.target.value })} />
            </label>
            <button className="primary-btn" type="submit">Crear pago pendiente</button>
          </form>
        </section>

        <section className="phase5-panel" style={{ marginTop: 18 }}>
          <div className="phase5-panel-head">
            <div>
              <h2>Historial de pagos</h2>
              <p>{pending.length} pagos pendientes requieren seguimiento.</p>
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="PENDING">Pendientes</option>
              <option value="PAID">Pagados</option>
              <option value="CANCELED">Cancelados</option>
            </select>
          </div>

          <div className="phase5-list">
            {payments.map((payment) => (
              <div key={payment.id} className="phase5-list-row" style={{ alignItems: "flex-start" }}>
                <div>
                  <strong>{payment.description || "Pago"}</strong>
                  <div className="meta-line">
                    {statusLabel(payment.status)} · {money(payment.amount, payment.currency)} · {payment.provider}
                  </div>
                  <div className="meta-line">
                    Cliente: {payment.conversation?.contact?.name || payment.lead?.name || payment.conversation?.contact?.externalId || "sin asociar"}
                  </div>
                  {payment.paymentUrl ? <div className="meta-line">Link: {payment.paymentUrl}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {payment.status !== "PAID" ? <button className="primary-btn" onClick={() => markPaid(payment.id)}>Marcar pagado</button> : null}
                  {payment.status === "PENDING" ? <button className="ghost-btn danger" onClick={() => markCanceled(payment.id)}>Cancelar</button> : null}
                </div>
              </div>
            ))}
            {!payments.length && !loading ? <div className="empty-state">Aún no hay pagos.</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metric-card">
      <div className="meta-line">{title}</div>
      <strong>{value}</strong>
    </div>
  );
}
