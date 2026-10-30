/** Archivo: Muestra el registro documental consolidado de Broker OS sin editar sus fuentes. */
"use client";

import { useEffect, useState } from "react";
import type { BrokerDocumentIndex, BrokerDocumentIndexFilters } from "@/lib/api";

function label(value: string) {
  return String(value || "").replaceAll("_", " ").toLocaleLowerCase("es-CL").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("es-CL"));
}

function expiryLabel(item: BrokerDocumentIndex["items"][number]) {
  if (item.expiry.state === "NO_EXPIRY") return "Sin vencimiento informado";
  if (item.expiry.state === "OVERDUE") return `Vencido hace ${Math.abs(item.expiry.daysUntil || 0)} día(s)`;
  if (item.expiry.state === "EXPIRING_60") return `Vence en ${item.expiry.daysUntil} día(s)`;
  return `Vigente · vence en ${item.expiry.daysUntil} día(s)`;
}

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "Sin fecha válida" : date.toLocaleDateString("es-CL");
}

export function BrokerDocumentIndexPanel({ index, filters, loading, onFiltersChange }: { index: BrokerDocumentIndex | null; filters: BrokerDocumentIndexFilters; loading?: boolean; onFiltersChange: (filters: BrokerDocumentIndexFilters) => void }) {
  const [draft, setDraft] = useState<BrokerDocumentIndexFilters>(filters);
  useEffect(() => setDraft(filters), [filters]);
  const update = (key: keyof BrokerDocumentIndexFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => {
    const next = { propertyId: "", person: "", type: "ALL", status: "ALL", expiry: "ALL" };
    setDraft(next);
    onFiltersChange(next);
  };

  return <section className="broker-document-index" aria-label="Registro documental consolidado">
    <header className="broker-document-index-header">
      <div><span>Registro documental Broker</span><h2>Documentos y expedientes consolidados</h2><p>Consulta el estado real de cada antecedente sin duplicar archivos ni cambiar una operación desde esta vista.</p></div>
      {index ? <small>Actualizado: {dateLabel(index.generatedAt)}</small> : null}
    </header>
    <div className="broker-document-index-summary">
      <article><b>{index?.summary.visible || 0}</b><span>{index ? `de ${index.summary.total} antecedentes visibles` : "antecedentes visibles"}</span></article>
      <article><b>{index?.summary.expiringIn60Days || 0}</b><span>por vencer en 60 días</span></article>
      <article><b>{index?.summary.overdue || 0}</b><span>vencidos</span></article>
      <article><b>{index?.summary.evidenceIncomplete || 0}</b><span>sin evidencia suficiente</span></article>
    </div>
    <form className="broker-document-index-filters" onSubmit={(event) => { event.preventDefault(); onFiltersChange(draft); }}>
      <label>Propiedad<select value={draft.propertyId || ""} onChange={(event) => update("propertyId", event.target.value)}><option value="">Todas las propiedades</option>{index?.facets.properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>
      <label>Persona<input value={draft.person || ""} onChange={(event) => update("person", event.target.value)} placeholder="Nombre de propietario, comprador o arrendatario" /></label>
      <label>Tipo<select value={draft.type || "ALL"} onChange={(event) => update("type", event.target.value)}><option value="ALL">Todos los tipos</option>{index?.facets.types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Estado<select value={draft.status || "ALL"} onChange={(event) => update("status", event.target.value)}><option value="ALL">Todos los estados</option>{index?.facets.statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
      <label>Vencimiento<select value={draft.expiry || "ALL"} onChange={(event) => update("expiry", event.target.value)}><option value="ALL">Todos</option><option value="EXPIRING_60">Vence en 60 días</option><option value="OVERDUE">Vencido</option><option value="CURRENT">Vigente</option><option value="NO_EXPIRY">Sin vencimiento</option></select></label>
      <div><button type="submit" className="primary-btn" disabled={loading}>Aplicar filtros</button><button type="button" className="secondary-btn" disabled={loading} onClick={reset}>Limpiar</button></div>
    </form>
    {index ? <p className="broker-document-index-notice">{index.notice}</p> : <p className="broker-empty">Cargando registro documental…</p>}
    {loading ? <p role="status">Actualizando documentos…</p> : null}
    {index?.items.length ? <div className="broker-document-index-list">{index.items.map((item) => <article key={item.id} className={`broker-document-index-item ${item.expiry.state.toLocaleLowerCase("es-CL")} ${item.evidence.status.toLocaleLowerCase("es-CL")}`}>
      <header><div><span>{item.category}</span><h3>{item.title}</h3><p>{item.documentType} · {item.propertyTitle}</p></div><b>{label(item.documentStatus)}</b></header>
      <div className="broker-document-index-meta"><span><b>Personas:</b> {item.parties.join(", ") || "Sin persona informada"}</span><span><b>Vencimiento:</b> {expiryLabel(item)}</span><span><b>Evidencia:</b> {item.evidence.status === "REGISTERED" ? "Registrada" : "Pendiente"}</span></div>
      <div className="broker-document-index-details"><p>{item.evidence.note}{item.evidence.reference ? ` Referencia: ${item.evidence.reference}.` : ""}</p>{item.signature.status === "REGISTERED_INTERNAL" ? <p><b>Firma:</b> registrada como antecedente interno. No se envió ni certificó una firma electrónica externa.</p> : null}</div>
      <footer><small>Origen: {item.source.label}</small><a className="secondary-btn" href={item.source.href}>Abrir registro de origen</a></footer>
    </article>)}</div> : index ? <p className="broker-empty">No hay documentos que coincidan con los filtros seleccionados.</p> : null}
  </section>;
}
