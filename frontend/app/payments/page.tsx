
"use client";

import { useEffect, useMemo, useState } from "react";
import { cancelPayment, confirmPayment, createPayment, getPaymentMetrics, getPayments, Payment, PaymentMetrics } from "@/lib/api";
import { Topbar } from "@/components/topbar";
import { BackToInbox } from "@/components/BackToInbox";
import { getStoredSession } from "@/lib/auth";

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
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    amount: "",
    description: "",
    conversationId: "",
    leadId: "",
    bookingId: ""
  });

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [list, summary] = await Promise.all([getPayments(status), getPaymentMetrics()]);
      setPayments(list);
      setMetrics(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar pagos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      setError(null);
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el pago");
    }
  }

  async function markPaid(id: string) {
    await confirmPayment(id);
    await load();
  }

  async function markCanceled(id: string) {
    await cancelPayment(id);
    await load();
  }

  const pending = useMemo(() => payments.filter((p) => p.status === "PENDING"), [payments]);

  return (
    <div className="page page-single">
      <main className="main dashboard-page">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <section className="chat-header dashboard-hero">
          <div>
            <span className="eyebrow">Portal de pagos</span>
            <h1 className="chat-title">Pagos, links y reservas</h1>
            <div className="meta-line">Modo actual: links manuales. Los proveedores externos se activan solo cuando su conector real este configurado.</div>
          </div>
          <button className="ghost-btn" onClick={load} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
        </section>

        {error ? <div className="admin-notice error">{error}</div> : null}

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
