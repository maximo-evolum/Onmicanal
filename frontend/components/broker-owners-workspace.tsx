/** Archivo: Renderiza el workspace relacional de propietarios de Broker OS. */
"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { canBroker } from "@/lib/broker-access";
import {
  getBrokerAccess,
  getBrokerOwnerWorkspace,
  getBrokerOwners,
  recordBrokerOwnerManagement,
  type BrokerAccessProfile,
  type BrokerOwnerListItem,
  type BrokerOwnerPortfolioFilter,
  type BrokerOwnerWorkspace
} from "@/lib/api";
import styles from "./broker-owners-workspace.module.css";

const filters: Array<{ key: BrokerOwnerPortfolioFilter; label: string }> = [
  { key: "ALL", label: "Toda la cartera" },
  { key: "ACTIVE", label: "Propiedades activas" },
  { key: "ADMINISTRATION", label: "En administración" },
  { key: "HISTORICAL", label: "Históricas" },
  { key: "ATTENTION", label: "Requieren atención" }
];

const actionTypes = [
  ["SEGUIMIENTO", "Seguimiento interno"],
  ["SOLICITUD_DOCUMENTO", "Solicitud de documento"],
  ["RENOVACION", "Renovación o vencimiento"],
  ["TASACION", "Tasación o evaluación"],
  ["REVISION_CARTERA", "Revisión de cartera"],
  ["OTRO", "Otra gestión"]
] as const;

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2 }).format(Number(value || 0));
}

function date(value?: string | null) {
  if (!value) return "Sin fecha";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? "Sin fecha" : parsed.toLocaleDateString("es-CL");
}

function priorityLabel(priority: "HIGH" | "MEDIUM" | "LOW") {
  return priority === "HIGH" ? "Prioridad alta" : priority === "MEDIUM" ? "Prioridad media" : "Seguimiento";
}

function ownerValue(item: BrokerOwnerListItem) {
  return item.portfolio.managedValueByCurrency.length
    ? item.portfolio.managedValueByCurrency.map((value) => money(value.value, value.currency)).join(" · ")
    : "Sin valorización vigente";
}

export function BrokerOwnersPageContent() {
  const [items, setItems] = useState<BrokerOwnerListItem[]>([]);
  const [workspace, setWorkspace] = useState<BrokerOwnerWorkspace | null>(null);
  const [access, setAccess] = useState<BrokerAccessProfile | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BrokerOwnerPortfolioFilter>("ALL");
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionType, setActionType] = useState("SEGUIMIENTO");
  const [actionNote, setActionNote] = useState("");
  const [actionPropertyId, setActionPropertyId] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");

  const loadOwners = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [result, profile] = await Promise.all([getBrokerOwners({ search, portfolio: filter }), getBrokerAccess()]);
      setItems(result.owners);
      setAccess(profile);
      setSelectedOwnerId((current) => result.owners.some((item) => item.owner.id === current) ? current : (result.owners[0]?.owner.id || ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la cartera de propietarios.");
      setItems([]);
      setWorkspace(null);
      setSelectedOwnerId("");
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { void loadOwners(); }, [loadOwners]);

  const loadWorkspace = useCallback(async (ownerId: string) => {
    if (!ownerId) {
      setWorkspace(null);
      return;
    }
    setLoadingDetail(true);
    setError("");
    try {
      const result = await getBrokerOwnerWorkspace(ownerId);
      setWorkspace(result);
      setActionPropertyId((current) => result.portfolio.properties.some((property) => property.legacyRecordId === current) ? current : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la ficha del propietario.");
      setWorkspace(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { void loadWorkspace(selectedOwnerId); }, [loadWorkspace, selectedOwnerId]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const saveManagement = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace || !actionNote.trim()) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await recordBrokerOwnerManagement(workspace.owner.id, {
        type: actionType,
        note: actionNote.trim(),
        propertyId: actionPropertyId || null,
        suggestedChannel: workspace.owner.contactSuggestion.key,
        nextActionAt: nextActionAt || null
      });
      setNotice(result.notice);
      setActionNote("");
      setNextActionAt("");
      await Promise.all([loadOwners(), loadWorkspace(workspace.owner.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar la gestión.");
    } finally {
      setBusy(false);
    }
  };

  const canEdit = canBroker(access, "commercial", "EDIT");

  return <section className={styles.workspace} aria-busy={loading || loadingDetail || busy}>
    <header className={styles.header}>
      <div>
        <span>Broker OS · cartera relacional</span>
        <h1>Propietarios y patrimonio gestionado</h1>
        <p>Consulta una cartera consolidada por identidad relacional. Los nombres parecidos no se fusionan y las sugerencias no envían mensajes externos.</p>
      </div>
      <div className={styles.scope}><b>{access?.profileLabel || "Consultando perfil"}</b><small>{access ? `Alcance: ${access.scopeDescription}` : "Validando permisos"}</small></div>
    </header>

    <section className={styles.filters} aria-label="Buscar propietarios">
      <form onSubmit={submitSearch}>
        <label htmlFor="broker-owner-search">Buscar por nombre, RUT, correo, teléfono o propiedad</label>
        <div><input id="broker-owner-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Ej.: 12.345.678-5 o Providencia" /><button type="submit" className="secondary-btn">Buscar</button></div>
      </form>
      <label>Tipo de cartera<select value={filter} onChange={(event) => setFilter(event.target.value as BrokerOwnerPortfolioFilter)}>{filters.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <button type="button" className="secondary-btn" disabled={loading} onClick={() => void loadOwners()}>Actualizar</button>
    </section>

    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}

    <div className={styles.layout}>
      <section className={styles.list} aria-label="Listado de propietarios">
        <div className={styles.listHeading}><div><span>Resultados</span><h2>{loading ? "Cargando cartera…" : `${items.length} propietario(s)`}</h2></div><small>Ordenado por atención requerida y cartera activa.</small></div>
        {!loading && !items.length ? <p className={styles.empty}>No hay propietarios relacionales dentro de este alcance. Convierte una captación con propietario identificado para incorporarla a la cartera.</p> : <div className={styles.cards}>{items.map((item) => <button type="button" key={item.owner.id} onClick={() => setSelectedOwnerId(item.owner.id)} className={`${styles.card} ${selectedOwnerId === item.owner.id ? styles.selected : ""}`}>
          <div><strong>{item.owner.name}</strong><span className={item.owner.identityStatus === "IDENTIDAD_ESTRICTA" ? styles.verified : styles.pending}>{item.owner.identityStatus === "IDENTIDAD_ESTRICTA" ? "Identidad con RUT" : "RUT pendiente"}</span></div>
          <p>{item.owner.rut || item.owner.email || item.owner.phone || "Sin contacto informado"}</p>
          <dl><div><dt>Activas</dt><dd>{item.metrics.activeProperties}</dd></div><div><dt>Administración</dt><dd>{item.metrics.administrationProperties}</dd></div><div><dt>Atención</dt><dd>{item.metrics.overdueItems + item.metrics.openAlerts}</dd></div></dl>
          <footer><span>{ownerValue(item)}</span><small>{item.lastManagementAt ? `Última gestión: ${date(item.lastManagementAt)}` : "Sin gestión registrada"}</small></footer>
        </button>)}</div>}
      </section>

      <section className={styles.detail} aria-label="Ficha del propietario">
        {loadingDetail ? <p className={styles.empty}>Abriendo ficha del propietario…</p> : !workspace ? <p className={styles.empty}>Selecciona un propietario para revisar su cartera, oportunidades e historial.</p> : <>
          <div className={styles.detailHeading}><div><span>Ficha consolidada</span><h2>{workspace.owner.name}</h2><p>{workspace.owner.legalType.replaceAll("_", " ")} · {workspace.owner.rut || "RUT pendiente de registro"}</p></div><div className={styles.contact}><b>{workspace.owner.contactSuggestion.label}</b><small>{workspace.owner.contactSuggestion.available ? "Canal sugerido; no realiza envíos automáticos." : "Completa contacto antes de preparar un seguimiento."}</small></div></div>

          <div className={styles.metrics}>{[
            ["Propiedades activas", workspace.metrics.activeProperties, "Cartera vigente"],
            ["Administración", workspace.metrics.administrationProperties, "Contratos o arriendos activos"],
            ["Negocios activos", workspace.metrics.activeOperations, "Dentro de tu alcance"],
            ["Vencimientos", workspace.metrics.expiringItems, `${workspace.metrics.overdueItems} vencido(s)`]
          ].map(([label, value, description]) => <article key={String(label)}><span>{label}</span><b>{value}</b><small>{description}</small></article>)}</div>

          <section className={styles.portfolio}><div className={styles.sectionHeading}><div><span>Patrimonio gestionado</span><h3>Cartera vinculada</h3></div><p>{workspace.portfolio.managedValueByCurrency.length ? workspace.portfolio.managedValueByCurrency.map((value) => money(value.value, value.currency)).join(" · ") : "Sin valorización vigente"}</p></div>
            {!workspace.portfolio.properties.length ? <p className={styles.empty}>No hay propiedades relacionales visibles para este propietario.</p> : <div className={styles.propertyList}>{workspace.portfolio.properties.map((property) => <article key={property.id}>
              <div><b>{property.title}</b><span>{property.comuna} · {property.propertyType}</span></div><div><strong>{property.askingPrice ? money(property.askingPrice, property.currency) : "Precio por definir"}</strong><small>{property.isHistorical ? "Histórica" : property.isAdministration ? "En administración" : property.operationalStatus}</small></div>
              <footer><span>{property.assignedBrokerName ? `Responsable: ${property.assignedBrokerName}` : "Sin responsable asignado"}</span>{property.legacyRecordId ? <nav style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }} aria-label={`Antecedentes de ${property.title}`}>
                <Link href={`/realty?view=properties&propertyId=${encodeURIComponent(property.legacyRecordId)}`}>Propiedad</Link>
                <Link href={`/realty?view=operations&propertyId=${encodeURIComponent(property.legacyRecordId)}`}>Captación</Link>
                {property.related.operations ? <Link href={`/realty?view=broker_os&tab=operations&propertyId=${encodeURIComponent(property.legacyRecordId)}`}>Operación ({property.related.operations})</Link> : null}
                {property.related.contracts ? <Link href={`/realty?view=broker_os&tab=operations&propertyId=${encodeURIComponent(property.legacyRecordId)}`}>Contrato ({property.related.contracts})</Link> : null}
                {property.related.administration ? <Link href={`/realty?view=broker_os&tab=administration_preview&propertyId=${encodeURIComponent(property.legacyRecordId)}`}>Administración ({property.related.administration})</Link> : null}
              </nav> : null}</footer>
            </article>)}</div>}
          </section>

          <section className={styles.dual}>
            <div className={styles.panel}><div className={styles.sectionHeading}><div><span>Oportunidades</span><h3>Acciones sugeridas</h3></div><p>Requieren revisión humana cuando corresponde.</p></div><div className={styles.stack}>{workspace.opportunities.map((opportunity) => <article key={opportunity.key} className={`${styles.opportunity} ${opportunity.priority === "HIGH" ? styles.high : opportunity.priority === "MEDIUM" ? styles.medium : ""}`}><b>{priorityLabel(opportunity.priority)}</b><h4>{opportunity.title}</h4><p>{opportunity.detail}</p><small>{opportunity.action}{opportunity.requiresApproval ? " · Requiere confirmación" : ""}</small></article>)}</div></div>
            <div className={styles.panel}><div className={styles.sectionHeading}><div><span>Plazos y alertas</span><h3>Vencimientos de cartera</h3></div><p>Se muestran antecedentes ya registrados.</p></div>{workspace.expirations.length ? <div className={styles.stack}>{workspace.expirations.map((item) => <article key={item.id} className={`${styles.expiration} ${item.overdue ? styles.overdue : ""}`}><b>{item.overdue ? "Vencido" : "Próximo"}</b><p>{item.label}</p><small>{item.detail} · {date(item.dueAt)}</small></article>)}</div> : <p className={styles.empty}>No hay vencimientos dentro de los próximos 60 días.</p>}</div>
          </section>

          <section className={styles.management}><div className={styles.sectionHeading}><div><span>Gestión interna</span><h3>Historial y próxima acción</h3></div><p>Registra contexto para el equipo; no contacta al propietario.</p></div>
            {canEdit ? <form onSubmit={saveManagement} className={styles.managementForm}><label>Tipo<select value={actionType} disabled={busy} onChange={(event) => setActionType(event.target.value)}>{actionTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Propiedad relacionada<select value={actionPropertyId} disabled={busy} onChange={(event) => setActionPropertyId(event.target.value)}><option value="">Gestión general de cartera</option>{workspace.portfolio.properties.filter((property) => property.legacyRecordId).map((property) => <option key={property.id} value={property.legacyRecordId || ""}>{property.title}</option>)}</select></label><label>Próxima acción<input type="date" value={nextActionAt} disabled={busy} onChange={(event) => setNextActionAt(event.target.value)} /></label><label className={styles.note}>Nota de gestión<textarea value={actionNote} disabled={busy} maxLength={2000} required onChange={(event) => setActionNote(event.target.value)} placeholder="Ej.: se revisará la renovación del mandato con la documentación disponible." rows={3} /></label><button className="primary-btn" disabled={busy || !actionNote.trim()}>Registrar gestión interna</button></form> : <p className={styles.permission}>Tu perfil puede consultar la cartera, pero no registrar gestiones internas.</p>}
            <div className={styles.history}>{workspace.management.length ? workspace.management.map((item) => <article key={item.id}><time>{date(item.createdAt)}</time><div><b>{item.type.replaceAll("_", " ")}</b><p>{item.note}</p><small>{item.suggestedChannel ? `Canal sugerido: ${item.suggestedChannel.replaceAll("_", " ")}` : "Sin canal sugerido"}{item.nextActionAt ? ` · Próxima acción: ${date(item.nextActionAt)}` : ""}</small></div></article>) : <p className={styles.empty}>Aún no hay gestiones internas registradas para este propietario dentro de tu alcance.</p>}</div>
          </section>

          <aside className={styles.disclaimer}>{workspace.notices.map((item) => <p key={item}>{item}</p>)}</aside>
        </>}
      </section>
    </div>
  </section>;
}
