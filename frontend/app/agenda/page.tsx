"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { BackToInbox } from "@/components/BackToInbox";
import { Topbar } from "@/components/topbar";
import { createBookingApi, getBookingSlots, getBookings, getMe, markBookingPaymentReady, updateBookingApi } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { Booking, BookingSlot, TenantSession } from "@/lib/types";

type AgendaMode = {
  title: string;
  locationLabel: string;
  guestsLabel: string;
  example: string;
  note: string;
};

const agendaModes: Record<string, AgendaMode> = {
  realty: {
    title: "Agenda inmobiliaria",
    locationLabel: "Direccion de la propiedad",
    guestsLabel: "Asistentes a visita",
    example: "Av. Apoquindo 4500, Las Condes",
    note: "Usa esta agenda para visitas, tasaciones, reuniones con propietarios y recorridos."
  },
  inmobiliaria: {
    title: "Agenda inmobiliaria",
    locationLabel: "Direccion de la propiedad",
    guestsLabel: "Asistentes a visita",
    example: "Av. Apoquindo 4500, Las Condes",
    note: "Usa esta agenda para visitas, tasaciones, reuniones con propietarios y recorridos."
  },
  salud: {
    title: "Agenda clinica",
    locationLabel: "Sucursal / box / consulta",
    guestsLabel: "Pacientes",
    example: "Sucursal Providencia, Box 3",
    note: "Pensada para citas, tratamientos, controles y agenda por profesional."
  },
  hospitality: {
    title: "Agenda de reservas",
    locationLabel: "Sucursal o direccion del evento",
    guestsLabel: "Personas",
    example: "Sucursal Vitacura o direccion del evento",
    note: "Sirve para reservas, eventos, servicios en terreno y confirmaciones."
  },
  servicios: {
    title: "Agenda de servicios",
    locationLabel: "Direccion del cliente",
    guestsLabel: "Personas / cupos",
    example: "Direccion entregada por el cliente",
    note: "Ideal para visitas tecnicas, instalaciones, servicios en terreno y rutas."
  },
  default: {
    title: "Agenda EVOLUM",
    locationLabel: "Lugar / sucursal / direccion",
    guestsLabel: "Personas",
    example: "Sucursal, domicilio, online o direccion del servicio",
    note: "Agenda flexible por empresa, conectada al inbox y a las reservas creadas por IA."
  }
};

function modeForTenant(tenant: TenantSession | null): AgendaMode {
  const industry = String(tenant?.industry || "").toLowerCase();
  if (industry.includes("realty") || industry.includes("inmobili")) return agendaModes.realty;
  if (industry.includes("salud") || industry.includes("health") || industry.includes("clin")) return agendaModes.salud;
  if (industry.includes("hotel") || industry.includes("hospitality") || industry.includes("evento") || industry.includes("rest")) return agendaModes.hospitality;
  if (industry.includes("servicio") || industry.includes("tecnico") || industry.includes("técnico")) return agendaModes.servicios;
  return agendaModes.default;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    PENDING: "Pendiente",
    CONFIRMED: "Confirmada",
    READY_TO_PAY: "Lista para pago",
    PAID: "Pagada",
    CANCELED: "Cancelada",
    COMPLETED: "Completada",
    BOOKED: "Reservada"
  };
  return map[status] || status;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function dateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function money(value = 0) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

export default function AgendaPage() {
  const agent = getStoredSession();
  const [tenant, setTenant] = useState<TenantSession | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    date: dateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    guests: "1",
    location: "",
    total: "",
    notes: "",
    conversationId: ""
  });

  const mode = modeForTenant(tenant);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [me, list, slotData] = await Promise.all([
        getMe().catch(() => null),
        getBookings(),
        getBookingSlots(selectedDate).catch(() => ({ date: selectedDate, slots: [] }))
      ]);
      setTenant(me?.tenant || null);
      setBookings(list);
      setSlots(slotData.slots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la agenda");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [selectedDate]);

  const stats = useMemo(() => {
    const now = Date.now();
    const upcoming = bookings.filter((booking) => new Date(booking.date).getTime() >= now && !["CANCELED", "COMPLETED"].includes(booking.status));
    return {
      total: bookings.length,
      upcoming: upcoming.length,
      pending: bookings.filter((booking) => booking.status === "PENDING").length,
      confirmed: bookings.filter((booking) => ["CONFIRMED", "BOOKED", "PAID"].includes(booking.status)).length
    };
  }, [bookings]);

  async function submitBooking(event: FormEvent) {
    event.preventDefault();
    try {
      setError(null);
      await createBookingApi({
        conversationId: form.conversationId || null,
        name: form.name,
        phone: form.phone,
        email: form.email,
        date: new Date(form.date).toISOString(),
        guests: Number(form.guests || 1),
        location: form.location,
        total: Number(form.total || 0),
        notes: form.notes
      });
      setForm({ name: "", phone: "", email: "", date: dateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)), guests: "1", location: "", total: "", notes: "", conversationId: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la reserva");
    }
  }

  async function setStatus(booking: Booking, status: string) {
    await updateBookingApi(booking.id, { status });
    await load();
  }

  async function readyToPay(booking: Booking) {
    await markBookingPaymentReady(booking.id);
    await load();
  }

  return (
    <div className="page page-single">
      <main className="main dashboard-page">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <section className="chat-header dashboard-hero agenda-hero">
          <div>
            <span className="eyebrow">Modulo independiente</span>
            <h1 className="chat-title">{mode.title}</h1>
            <div className="meta-line">{mode.note}</div>
          </div>
          <div className="dashboard-hero-actions">
            <Link className="ghost-btn" href="/crm-principal">Volver al CRM</Link>
            <button className="ghost-btn" onClick={load} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
          </div>
        </section>

        {error ? <div className="admin-notice error">{error}</div> : null}

        <section className="dashboard-grid">
          <Card title="Reservas totales" value={stats.total} />
          <Card title="Proximas" value={stats.upcoming} />
          <Card title="Pendientes" value={stats.pending} />
          <Card title="Confirmadas" value={stats.confirmed} />
        </section>

        <section className="agenda-layout">
          <form className="phase5-panel agenda-form" onSubmit={submitBooking}>
            <div className="phase5-panel-head">
              <div>
                <h2>Nueva reserva</h2>
                <p>Puede venir desde el agente del inbox o crearse manualmente por el equipo.</p>
              </div>
            </div>

            <label>
              <span className="meta-line">Nombre del cliente</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cliente o contacto" />
            </label>
            <label>
              <span className="meta-line">Telefono</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+56 9..." />
            </label>
            <label>
              <span className="meta-line">Email</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@empresa.cl" />
            </label>
            <label>
              <span className="meta-line">Fecha y hora</span>
              <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label>
              <span className="meta-line">{mode.guestsLabel}</span>
              <input type="number" min="1" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} required />
            </label>
            <label>
              <span className="meta-line">{mode.locationLabel}</span>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={mode.example} />
            </label>
            <label>
              <span className="meta-line">Valor estimado opcional</span>
              <input type="number" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="0" />
            </label>
            <label>
              <span className="meta-line">Conversation ID opcional</span>
              <input value={form.conversationId} onChange={(e) => setForm({ ...form, conversationId: e.target.value })} placeholder="Asociar al inbox" />
            </label>
            <label className="agenda-wide">
              <span className="meta-line">Notas internas</span>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} placeholder="Servicio, sucursal, direccion, condiciones, responsable, etc." />
            </label>
            <button className="primary-btn agenda-wide" type="submit">Crear reserva</button>
          </form>

          <aside className="phase5-panel agenda-slots">
            <div className="phase5-panel-head">
              <div>
                <h2>Disponibilidad tentativa</h2>
                <p>Slots base. Luego se puede conectar con Google Calendar o disponibilidad por sucursal.</p>
              </div>
            </div>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            <div className="agenda-slot-grid">
              {slots.map((slot) => (
                <button
                  className="ghost-btn"
                  key={`${slot.date}-${slot.time}`}
                  type="button"
                  onClick={() => setForm({ ...form, date: `${slot.date}T${slot.time}` })}
                >
                  {slot.time}
                </button>
              ))}
              {!slots.length ? <div className="empty-state">Sin slots configurados.</div> : null}
            </div>
          </aside>
        </section>

        <section className="phase5-panel" style={{ marginTop: 18 }}>
          <div className="phase5-panel-head">
            <div>
              <h2>Agenda de reservas</h2>
              <p>Reservas creadas por el agente del inbox y por usuarios del equipo.</p>
            </div>
          </div>

          <div className="phase5-list agenda-list">
            {bookings.map((booking) => (
              <article key={booking.id} className="phase5-list-row agenda-booking-row">
                <div>
                  <strong>{booking.name || booking.phone || "Reserva sin nombre"}</strong>
                  <div className="meta-line">{formatDate(booking.date)} / {statusLabel(booking.status)} / {booking.guests} {mode.guestsLabel.toLowerCase()}</div>
                  <div className="meta-line">{mode.locationLabel}: {booking.location || "Por confirmar"}</div>
                  {booking.notes ? <div className="meta-line">{booking.notes}</div> : null}
                  {booking.total ? <div className="badge accent">{money(booking.total)}</div> : null}
                </div>
                <div className="agenda-actions">
                  {booking.conversationId ? <Link className="ghost-btn" href={`/inbox?conversation=${booking.conversationId}`}>Ver chat</Link> : null}
                  {booking.status !== "CONFIRMED" ? <button className="primary-btn" onClick={() => setStatus(booking, "CONFIRMED")}>Confirmar</button> : null}
                  {booking.status === "PENDING" ? <button className="ghost-btn" onClick={() => readyToPay(booking)}>Listo pago</button> : null}
                  {booking.status !== "CANCELED" ? <button className="ghost-btn danger" onClick={() => setStatus(booking, "CANCELED")}>Cancelar</button> : null}
                </div>
              </article>
            ))}
            {!bookings.length && !loading ? <div className="empty-state">Aun no hay reservas en la agenda.</div> : null}
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
