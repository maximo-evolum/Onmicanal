"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getNotifications, markAllNotificationsRead, markNotificationRead, type TenantNotification } from "@/lib/api";

type NotificationCenterProps = { placement?: "header" | "sidebar" };

function safeTarget(targetUrl?: string | null) {
  const target = String(targetUrl || "").trim();
  // Solo se aceptan destinos internos del workspace. De esta forma un dato
  // mal configurado nunca puede llevar a una persona fuera de EVOLUM.
  return target.startsWith("/") && !target.startsWith("//") ? target : "/crm-principal";
}

function severityLabel(severity?: string) {
  const value = String(severity || "info").toLowerCase();
  if (value === "critical") return "Crítica";
  if (value === "warning") return "Atención";
  if (value === "success") return "Completada";
  return "Información";
}

function notificationDateTime(value?: string | null) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function NotificationCenter({ placement = "header" }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<TenantNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const result = await getNotifications({ limit: 12 });
      setNotifications(result.notifications || []);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const unread = notifications.filter((item) => item.status !== "READ").length;

  async function markAllRead() {
    setNotifications((current) => current.map((item) => ({ ...item, status: "READ" })));
    await markAllNotificationsRead().catch(() => null);
  }

  function markRead(id: string) {
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, status: "READ" } : item));
    void markNotificationRead(id).catch(() => null);
    setOpen(false);
  }

  return (
    <div className={`notification-center notification-center--${placement}`} ref={containerRef}>
      <button className="notification-center-trigger" type="button" onClick={() => { setOpen((value) => !value); if (!open) void refresh(); }} aria-label={unread ? `Abrir ${unread} notificaciones sin leer` : "Abrir notificaciones"} aria-expanded={open}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 10a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        {unread ? <span className="notification-center-count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? <div className="notification-center-panel" role="dialog" aria-label="Notificaciones">
        <div className="notification-center-panel-head"><div><strong>Notificaciones</strong><span>{unread ? `${unread} sin leer` : "Estás al día"}</span></div>{unread ? <button type="button" onClick={markAllRead}>Marcar leídas</button> : null}</div>
        <div className="notification-center-list">
          {loading && !notifications.length ? <p>Cargando notificaciones…</p> : null}
          {!loading && !notifications.length ? <p>No tienes notificaciones por ahora.</p> : null}
          {notifications.map((item) => <Link href={safeTarget(item.targetUrl)} key={item.id} className={item.status === "READ" ? "is-read" : "is-unread"} onClick={() => markRead(item.id)}>
            <span className={`notification-center-severity is-${String(item.severity || "info").toLowerCase()}`}>{severityLabel(item.severity)}</span><strong>{item.title}</strong><small>{item.body || "Hay una novedad en tu operación."}</small><time dateTime={item.createdAt}>{notificationDateTime(item.createdAt)}</time>
          </Link>)}
        </div>
      </div> : null}
    </div>
  );
}
