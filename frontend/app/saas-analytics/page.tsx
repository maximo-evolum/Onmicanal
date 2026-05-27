"use client";

import { useEffect, useState } from "react";
import { getSaasAnalytics, SaasAnalytics } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { Topbar } from "@/components/topbar";

export default function SaasAnalyticsPage() {
  const agent = getStoredSession();
  const [data, setData] = useState<SaasAnalytics | null>(null);
  useEffect(() => { getSaasAnalytics().then(setData).catch(console.error); }, []);
  return <div className="page page-single"><main className="main dashboard-page phase5-page"><Topbar agent={agent} />
    <section className="phase5-hero compact"><div><span className="eyebrow">SaaS Analytics</span><h1 className="chat-title">Uso, salud comercial y recomendaciones</h1><p className="meta-line">Métricas para operar clientes, límites, IA y conversión.</p></div></section>
    {!data ? <div className="empty-state">Cargando analytics...</div> : <>
      <section className="phase5-grid four"><Card title="Mensajes" value={data.usage?.messages || 0}/><Card title="IA replies" value={data.usage?.aiReplies || 0}/><Card title="Tool calls" value={data.usage?.toolCalls || 0}/><Card title="Uso plan" value={`${data.usage?.usagePercent || 0}%`}/></section>
      <section className="phase5-grid four"><Card title="Leads" value={data.kpis?.leads || 0}/><Card title="Hot" value={data.kpis?.hot || 0}/><Card title="Ready close" value={data.kpis?.ready || 0}/><Card title="Close rate" value={`${data.kpis?.closeRate || 0}%`}/></section>
      <section className="phase5-grid two"><article className="phase5-panel"><h2>Recomendaciones</h2><div className="phase5-list">{data.recommendations.map((r, i) => <div key={i} className="phase5-list-row">{r}</div>)}</div></article>
      <article className="phase5-panel"><h2>Resultados recientes</h2><div className="phase5-list">{data.outcomes.length ? data.outcomes.map((o) => <div className="phase5-list-row" key={o.id}><strong>{o.outcome}</strong><small>{o.reason || "Sin razón"}</small></div>) : <div className="meta-line">Aún no hay resultados registrados.</div>}</div></article></section>
    </>}
  </main></div>;
}
function Card({ title, value }: { title: string; value: string | number }) { return <article className="phase5-card"><span>{title}</span><strong>{value}</strong></article>; }
