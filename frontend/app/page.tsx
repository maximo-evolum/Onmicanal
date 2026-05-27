"use client";

import { useEffect, useState } from "react";
import { getAuditLogs, getTeamManagement, createTeamUser } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { Topbar } from "@/components/topbar";

export default function TeamPage() {
  const agent = getStoredSession();
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    getTeamManagement().then((data) => setUsers(data.users)).catch((err) => setError(err.message));
    getAuditLogs().then((data) => setLogs(data.logs)).catch(() => setLogs([]));
  }, []);
  return (
    <div className="page page-single"><main className="main dashboard-page phase5-page"><Topbar agent={agent} />
      <section className="phase5-hero compact"><div><span className="eyebrow">Team Management</span><h1 className="chat-title">Equipo, roles y actividad</h1><p className="meta-line">Vista SaaS para administrar operación humana detrás de la IA.</p></div></section>
      {error ? <div className="admin-notice error">{error}</div> : null}
      <section className="phase5-grid two"><article className="phase5-panel"><h2>Usuarios</h2><div className="phase5-table">{users.map((u) => <div className="phase5-table-row" key={u.id}><strong>{u.name}</strong><span>{u.email}</span><span>{u.role}</span><span className={u.isActive ? "badge mode-bot" : "badge danger"}>{u.isActive ? "Activo" : "Inactivo"}</span></div>)}</div></article>
      <article className="phase5-panel">
      <h2>Crear usuario</h2>
      <button className="btn-primary" onClick={async () => {
        await createTeamUser({
          name: "Nuevo Usuario",
          email: `user${Date.now()}@demo.local`,
          role: "SELLER",
          password: "ChangeMe123*"
        });
        location.reload();
      }}>Crear usuario demo</button>
      </article>

      <article className="phase5-panel"><h2>Actividad reciente</h2><div className="phase5-list">{logs.length ? logs.map((l) => <div className="phase5-list-row" key={l.id}><strong>{l.action}</strong><small>{new Date(l.createdAt).toLocaleString("es-CL")}</small></div>) : <div className="meta-line">Sin actividad registrada aún.</div>}</div></article></section>
    </main></div>
  );
}
