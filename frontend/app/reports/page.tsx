"use client";

import { useEffect, useState } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { getIndustryReports, type IndustryReport, type IndustryReportMetric } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

function formatMetric(metric: IndustryReportMetric) {
  const label = metric.label.toLowerCase();
  const value = Number(metric.value || 0);
  if (/(cobrado|pendiente|cancelado|forecast|pagado|ingreso)/.test(label)) {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0
    }).format(value);
  }
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value);
}

export default function ReportsPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [report, setReport] = useState<IndustryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await getIndustryReports();
        if (active) {
          setReport(data);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "No se pudieron cargar los reportes");
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <ModuleGate moduleKey="reports">
      <div className={`module-with-menu-shell reports-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar
          active="Reportes"
          isDeveloper={agent?.role === "SUPER_ADMIN"}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((value) => !value)}
        />

        <main className="reports-page">
          <header className="module-app-header reports-header">
            <div>
              <span>REPORTES POR RUBRO</span>
              <h1>Informes operativos</h1>
              <p>{report ? `${report.tenant.industryLabel} · actualización automática` : "Cargando indicadores del negocio"}</p>
            </div>
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {!report ? <div className="module-access-state reports-loading">Generando reporte...</div> : null}

          {report ? <>
            <section className="reports-summary-grid">
              {report.summary.map((item) => (
                <article className="reports-summary-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{formatMetric(item)}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </section>

            <section className="reports-section-stack">
              {report.sections.map((section) => (
                <article className="reports-section" key={section.id}>
                  <div className="reports-section-head">
                    <div>
                      <span>{section.id === "comercial" ? "NEGOCIO" : section.id === "contabilidad" ? "FINANZAS" : "VERTICAL"}</span>
                      <h2>{section.title}</h2>
                    </div>
                    <p>{section.description}</p>
                  </div>
                  <div className="reports-metric-grid">
                    {section.metrics.map((item) => (
                      <div className="reports-metric-card" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{formatMetric(item)}</strong>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </> : null}
        </main>
      </div>
    </ModuleGate>
  );
}
