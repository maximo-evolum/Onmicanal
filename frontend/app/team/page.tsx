"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTeamManagement } from "@/lib/api";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { EvolumSidebar } from "@/components/evolum-sidebar";

export default function TeamPage() {
  const agent = getStoredSession();
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    getTeamManagement()
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="Configuracion de Agente"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />
      <main className="main dashboard-page phase5-page team-page">
        <header className="module-app-header">
          <div>
            <span className="eyebrow">Equipo</span>
            <h1>Usuarios y roles</h1>
            <div className="meta-line">Administracion humana detras de la operacion IA.</div>
          </div>
          <div className="module-app-actions">
            <Link className="ghost-btn" href="/crm-principal">Ir a CRM</Link>
            <span className="module-account-pill">{agent?.name || "Usuario"}</span>
            <LogoutButton />
          </div>
        </header>

        {error ? <div className="admin-notice error">{error}</div> : null}

        <section className="phase5-grid one">
          <article className="phase5-panel">
            <h2>Usuarios</h2>
            <div className="phase5-table">
              {users.map((user) => (
                <div className="phase5-table-row" key={user.id}>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                  <span>{user.role}</span>
                  <span className={user.isActive ? "badge mode-bot" : "badge danger"}>
                    {user.isActive ? "Activo" : "Inactivo"}
                  </span>
                </div>
              ))}
              {!users.length && !error ? <div className="empty-state">Cargando usuarios...</div> : null}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
