"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createBookingApi, getBookingSlots, getBookings, getMe, markBookingPaymentReady, updateBookingApi } from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import type { AgentSession, Booking, BookingSlot, TenantSession } from "@/lib/types";

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

type HolidayInfo = {
  name: string;
  type: "holiday" | "long-weekend" | "weekend";
};

type CalendarDay = {
  date: Date;
  key: string;
  day: number;
  isToday: boolean;
  isWeekend: boolean;
  isLongWeekend: boolean;
  holiday?: HolidayInfo;
  bookings: Booking[];
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function localDateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function easterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function chileHolidays(year: number) {
  const easter = easterDate(year);
  const holidays: Record<string, string> = {
    [`${year}-01-01`]: "Ano Nuevo",
    [`${year}-05-01`]: "Dia del Trabajo",
    [`${year}-05-21`]: "Glorias Navales",
    [`${year}-06-21`]: "Pueblos Indigenas",
    [`${year}-06-29`]: "San Pedro y San Pablo",
    [`${year}-07-16`]: "Virgen del Carmen",
    [`${year}-08-15`]: "Asuncion de la Virgen",
    [`${year}-09-18`]: "Fiestas Patrias",
    [`${year}-09-19`]: "Glorias del Ejercito",
    [`${year}-10-12`]: "Encuentro de Dos Mundos",
    [`${year}-10-31`]: "Iglesias Evangelicas",
    [`${year}-11-01`]: "Todos los Santos",
    [`${year}-12-08`]: "Inmaculada Concepcion",
    [`${year}-12-25`]: "Navidad"
  };
  holidays[dateKey(addDays(easter, -2))] = "Viernes Santo";
  holidays[dateKey(addDays(easter, -1))] = "Sabado Santo";
  return holidays;
}

function holidayMapForYears(years: number[]) {
  return years.reduce<Record<string, string>>((map, year) => ({ ...map, ...chileHolidays(year) }), {});
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function buildLongWeekendKeys(holidays: Record<string, string>) {
  const offDays = new Set<string>();
  Object.keys(holidays).forEach((key) => offDays.add(key));
  Object.keys(holidays).forEach((key) => {
    const date = localDateFromKey(key);
    for (let offset = -3; offset <= 3; offset += 1) {
      const candidate = addDays(date, offset);
      if (isWeekend(candidate)) offDays.add(dateKey(candidate));
    }
  });

  const longWeekends = new Set<string>();
  Array.from(offDays).sort().forEach((key) => {
    const date = localDateFromKey(key);
    const run = [key];
    let prev = addDays(date, -1);
    while (offDays.has(dateKey(prev))) {
      run.unshift(dateKey(prev));
      prev = addDays(prev, -1);
    }
    let next = addDays(date, 1);
    while (offDays.has(dateKey(next))) {
      run.push(dateKey(next));
      next = addDays(next, 1);
    }
    if (run.length >= 3) run.forEach((item) => longWeekends.add(item));
  });
  return longWeekends;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(date);
}

function bookingTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function bookingShortInfo(booking: Booking) {
  const text = booking.notes || booking.location || booking.email || booking.phone || "Reserva creada por IA/equipo";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42).trim()}...` : clean;
}

function calendarMonths(bookings: Booking[], selectedDate: string, visibleMonthCount = 3) {
  const base = localDateFromKey(selectedDate);
  const starts = Array.from({ length: visibleMonthCount }, (_, offset) => new Date(base.getFullYear(), base.getMonth() + offset, 1));
  const years = Array.from(new Set(starts.flatMap((start) => [start.getFullYear(), new Date(start.getFullYear(), start.getMonth() + 1, 0).getFullYear()])));
  const holidays = holidayMapForYears(years);
  const longWeekends = buildLongWeekendKeys(holidays);
  const todayKey = dateKey(new Date());
  const bookingsByDate = bookings.reduce<Record<string, Booking[]>>((map, booking) => {
    const key = dateKey(new Date(booking.date));
    map[key] = [...(map[key] || []), booking];
    return map;
  }, {});

  return starts.map((start) => {
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const firstDay = (start.getDay() + 6) % 7;
    const days: Array<CalendarDay | null> = Array.from({ length: firstDay }, () => null);
    for (let day = 1; day <= lastDay; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), day);
      const key = dateKey(date);
      days.push({
        date,
        key,
        day,
        isToday: key === todayKey,
        isWeekend: isWeekend(date),
        isLongWeekend: longWeekends.has(key),
        holiday: holidays[key] ? { name: holidays[key], type: "holiday" } : undefined,
        bookings: bookingsByDate[key] || []
      });
    }
    return { key: dateKey(start), label: monthLabel(start), days };
  });
}

export default function AgendaPage() {
  const agent = getStoredSession();
  const [session, setSession] = useState<AgentSession | null>(agent);
  const [tenant, setTenant] = useState<TenantSession | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [visibleMonthCount, setVisibleMonthCount] = useState(3);
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
  const months = useMemo(() => calendarMonths(bookings, selectedDate, visibleMonthCount), [bookings, selectedDate, visibleMonthCount]);

  useEffect(() => {
    setSession(getStoredSession());
  }, []);

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

  function shiftCalendar(monthsToMove: number) {
    setSelectedDate(dateKey(addMonths(localDateFromKey(selectedDate), monthsToMove)));
  }

  function goToCurrentMonth() {
    setSelectedDate(dateKey(new Date()));
  }

  return (
    <div className="page page-single">
      <main className="main dashboard-page">
        <header className="agenda-app-header">
          <div>
            <h1>Agenda EVOLUM</h1>
            <div className="meta-line">{mode.note}</div>
          </div>
          <div className="agenda-app-actions">
            <Link className="ghost-btn" href="/crm-principal">Volver al CRM</Link>
            <span className="agenda-account-pill">{session?.name || agent?.name || "Usuario"}</span>
            <button className="ghost-btn" onClick={load} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
            <LogoutButton />
          </div>
        </header>

        {error ? <div className="admin-notice error">{error}</div> : null}

        <section className="dashboard-grid">
          <Card title="Reservas totales" value={stats.total} />
          <Card title="Proximas" value={stats.upcoming} />
          <Card title="Pendientes" value={stats.pending} />
          <Card title="Confirmadas" value={stats.confirmed} />
        </section>

        <section className="phase5-panel chile-calendar-panel">
          <div className="phase5-panel-head">
            <div>
              <h2>Calendario de reservas Chile</h2>
              <p>Vista mensual con reservas, feriados, fines de semana y fines de semana largos.</p>
            </div>
            <div className="chile-calendar-tools">
              <button className="calendar-arrow" type="button" aria-label="Mes anterior" onClick={() => shiftCalendar(-1)}>{"<"}</button>
              <button className="calendar-arrow" type="button" aria-label="Mes siguiente" onClick={() => shiftCalendar(1)}>{">"}</button>
              <button className="ghost-btn compact-calendar-btn" type="button" onClick={goToCurrentMonth}>Mes actual</button>
              <div className="calendar-view-toggle" aria-label="Cantidad de meses visibles">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={visibleMonthCount === count ? "active" : ""}
                    onClick={() => setVisibleMonthCount(count)}
                  >
                    {count} mes{count > 1 ? "es" : ""}
                  </button>
                ))}
              </div>
              <div className="chile-calendar-legend">
                <span className="holiday">Feriado</span>
                <span className="long">Fin de semana largo</span>
                <span className="weekend">Sabado / domingo</span>
                <span className="booking">Reserva</span>
              </div>
            </div>
          </div>

          <div className={`chile-calendar-grid month-count-${visibleMonthCount}`}>
            {months.map((month) => (
              <article className="chile-calendar-month" key={month.key}>
                <h3>{month.label}</h3>
                <div className="chile-calendar-weekdays">
                  {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="chile-calendar-days">
                  {month.days.map((day, index) => (
                    day ? (
                      <button
                        className={`chile-calendar-day ${day.isToday ? "today" : ""} ${day.isWeekend ? "weekend" : ""} ${day.isLongWeekend ? "long-weekend" : ""} ${day.holiday ? "holiday" : ""} ${day.bookings.length ? "has-bookings" : ""}`}
                        key={day.key}
                        type="button"
                        title={[day.holiday?.name, day.isLongWeekend ? "Fin de semana largo" : "", day.bookings.length ? `${day.bookings.length} reservas` : ""].filter(Boolean).join(" / ")}
                        onClick={() => setSelectedDate(day.key)}
                      >
                        <strong>{day.day}</strong>
                        {day.holiday ? <small>{day.holiday.name}</small> : null}
                        {day.bookings.slice(0, 2).map((booking) => (
                          <span className="chile-calendar-booking" key={booking.id}>
                            <b>{bookingTime(booking.date)} / {booking.name || booking.phone || "Reserva"}</b>
                            <em>{bookingShortInfo(booking)}</em>
                          </span>
                        ))}
                        {day.bookings.length > 2 ? <span className="chile-calendar-more">+{day.bookings.length - 2} mas</span> : null}
                      </button>
                    ) : <span className="chile-calendar-empty" key={`empty-${month.key}-${index}`} />
                  ))}
                </div>
              </article>
            ))}
          </div>
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
