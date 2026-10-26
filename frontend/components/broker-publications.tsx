/** Archivo: Renderiza el Centro de Publicación Multicanal de Broker OS. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { canBroker } from "@/lib/broker-access";
import {
  actBrokerPublication,
  createBrokerPublication,
  getBrokerAccess,
  getBrokerPublicationAnalytics,
  getBrokerPublicationExport,
  getBrokerPublicationOptions,
  getBrokerPublicationProviderConfig,
  getBrokerPublicationProviders,
  getBrokerPublications,
  recordBrokerPublicationMetrics,
  updateBrokerPublicationProvider,
  updateBrokerPublication,
  type BrokerAccessProfile,
  type BrokerPublication,
  type BrokerPublicationAnalytics,
  type BrokerPublicationOptions,
  type BrokerPublicationProviderConfig,
  type BrokerPublicationProvidersResponse,
} from "@/lib/api";
import styles from "./broker-publications.module.css";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la acción.";
}

function date(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin fecha" : parsed.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
}

function money(value: number | null | undefined, currency = "CLP") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Precio pendiente";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2 }).format(value);
}

function readableStatus(value: string) {
  return ({
    DRAFT: "Borrador",
    PENDING_REVIEW: "En revisión",
    APPROVED: "Aprobada internamente",
    PROVIDER_PENDING: "Pendiente de proveedor",
    PUBLISHED: "Publicada",
    PAUSED: "Pausada",
    ARCHIVED: "Archivada",
    REJECTED: "Rechazada",
  } as Record<string, string>)[value] || value;
}

function readableProviderStatus(value: string) {
  return ({
    INTERNAL: "Interno",
    PENDING_PROVIDER: "Pendiente de proveedor",
    CONTACTED: "Contacto iniciado",
    CONTRACTED: "Contrato vigente",
    TECHNICAL_REVIEW: "Revisión técnica",
    READY_FOR_TEST: "Listo para pruebas",
    ACTIVE: "Activo",
    PAUSED: "Pausado",
    UNAVAILABLE: "No disponible",
  } as Record<string, string>)[value] || value;
}

function readableDeliveryMode(value: string | undefined) {
  return ({
    NOT_SENT: "Sin envío externo",
    MANUAL_CONFIRMED: "Confirmación manual",
    MANUAL_ERROR_REPORTED: "Incidencia registrada",
  } as Record<string, string>)[value || ""] || "Sin envío externo";
}

function integer(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(Math.round(parsed)) : "0";
}

const emptyOptions: BrokerPublicationOptions = {
  channels: [], statuses: [], properties: [], externalPublicationEnabled: false, externalPublicationNotice: ""
};

const emptyAnalytics: BrokerPublicationAnalytics = {
  total: 0, published: 0, approved: 0, pendingProvider: 0, pendingReview: 0, views: 0, contacts: 0, favorites: 0, contactRatePct: null, byChannel: []
};

const emptyProviders: BrokerPublicationProvidersResponse = { providers: [], providerStatuses: [], credentialPolicy: "" };

/**
 * Separa el trabajo editorial interno de las integraciones reales: una
 * aprobación nunca envía datos a terceros y cada estado deja trazabilidad.
 */
export function BrokerPublicationsPageContent() {
  const [access, setAccess] = useState<BrokerAccessProfile | null>(null);
  const [options, setOptions] = useState<BrokerPublicationOptions>(emptyOptions);
  const [items, setItems] = useState<BrokerPublication[]>([]);
  const [analytics, setAnalytics] = useState<BrokerPublicationAnalytics>(emptyAnalytics);
  const [providers, setProviders] = useState<BrokerPublicationProvidersResponse>(emptyProviders);
  const [providerConfig, setProviderConfig] = useState<BrokerPublicationProviderConfig | null>(null);
  const [selected, setSelected] = useState<BrokerPublication | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [channel, setChannel] = useState("");
  const [filter, setFilter] = useState({ status: "", channel: "" });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState({ externalReference: "", publishedUrl: "", error: "" });
  const [metrics, setMetrics] = useState({ reportDate: new Date().toISOString().slice(0, 10), views: "0", contacts: "0", favorites: "0", publishedUrl: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const canCreate = canBroker(access, "projects", "CREATE");
  const canEdit = canBroker(access, "projects", "EDIT");
  const canApprove = canBroker(access, "projects", "APPROVE");
  const canConfigureProviders = canBroker(access, "configuration", "CONFIGURE");

  const currentProperty = useMemo(() => options.properties.find((item) => item.id === propertyId) || null, [options.properties, propertyId]);

  async function reload(nextFilter = filter) {
    const [nextAccess, nextOptions, publications, nextAnalytics, nextProviders] = await Promise.all([
      getBrokerAccess(),
      getBrokerPublicationOptions(),
      getBrokerPublications(nextFilter),
      getBrokerPublicationAnalytics(),
      getBrokerPublicationProviders(),
    ]);
    setAccess(nextAccess);
    setOptions(nextOptions);
    setItems(publications.items);
    setAnalytics(nextAnalytics);
    setProviders(nextProviders);
    setSelected((current) => publications.items.find((item) => item.id === current?.id) || null);
    if (!propertyId && nextOptions.properties.length) setPropertyId(nextOptions.properties[0].id);
    if (!channel && nextOptions.channels.length) setChannel(nextOptions.channels[0].key);
  }

  useEffect(() => {
    reload().catch((error) => setNotice(messageOf(error))).finally(() => setLoading(false));
    // La carga se realiza una vez; los cambios del usuario llaman a reload de forma explícita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyId || !channel) return;
    try {
      setBusy(true);
      const created = await createBrokerPublication({ propertyId, channel, title, body });
      setSelected(created);
      setTitle("");
      setBody("");
      setNotice(`Borrador creado para ${created.data.channelLabel}. No se publicó información en ningún portal.`);
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!selected) return;
    try {
      setBusy(true);
      const updated = await updateBrokerPublication(selected.id, { title, body });
      setSelected(updated);
      setNotice("Borrador actualizado. Debe volver a solicitar revisión antes de avanzar.");
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function transition(action: "REQUEST_REVIEW" | "APPROVE" | "REJECT" | "PREPARE_PROVIDER" | "CONFIRM_EXTERNAL_PUBLICATION" | "REPORT_PROVIDER_FAILURE" | "PAUSE" | "ARCHIVE") {
    if (!selected) return;
    try {
      setBusy(true);
      const updated = await actBrokerPublication(selected.id, { action, note, ...delivery });
      setSelected(updated);
      setNotice(updated.notice || `Estado actualizado: ${readableStatus(updated.data.publicationStatus)}.`);
      setNote("");
      if (["CONFIRM_EXTERNAL_PUBLICATION", "REPORT_PROVIDER_FAILURE"].includes(action)) setDelivery({ externalReference: "", publishedUrl: "", error: "" });
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function saveMetrics() {
    if (!selected) return;
    try {
      setBusy(true);
      const updated = await recordBrokerPublicationMetrics(selected.id, {
        reportDate: metrics.reportDate,
        views: Number(metrics.views),
        contacts: Number(metrics.contacts),
        favorites: Number(metrics.favorites),
        publishedUrl: metrics.publishedUrl,
      });
      setSelected(updated);
      setNotice("Rendimiento registrado en la bitácora. Estos datos no ejecutan ni acreditan una publicación externa.");
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function openProviderConfig(providerChannel: string) {
    try {
      setBusy(true);
      const config = await getBrokerPublicationProviderConfig(providerChannel);
      setProviderConfig(config);
      setNotice(`Configuración interna abierta para ${config.channelLabel}. No ingreses contraseñas, tokens ni API keys aquí.`);
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function saveProviderConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerConfig) return;
    try {
      setBusy(true);
      const saved = await updateBrokerPublicationProvider(providerConfig.channel, {
        providerStatus: providerConfig.providerStatus,
        contractReference: providerConfig.contractReference,
        accountReference: providerConfig.accountReference,
        technicalContact: providerConfig.technicalContact,
        notes: providerConfig.notes,
      });
      setProviderConfig(saved);
      setNotice("Preparación del proveedor guardada. Las credenciales se administrarán cifradas en Centro de Conexiones cuando exista autorización formal.");
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  async function exportTechnicalPayload() {
    if (!selected) return;
    try {
      setBusy(true);
      const payload = await getBrokerPublicationExport(selected.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `broker-publication-${selected.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Se descargó la previsualización técnica. El archivo no se envió a ningún portal.");
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  function selectPublication(item: BrokerPublication) {
    setSelected(item);
    setTitle(item.data.copy.title || "");
    setBody(item.data.copy.body || "");
    setNote("");
    setDelivery({
      externalReference: item.data.provider?.externalPublicationId || "",
      publishedUrl: item.data.provider?.publishedUrl || "",
      error: item.data.provider?.lastError || "",
    });
    setMetrics({
      reportDate: item.data.metrics?.reportDate || new Date().toISOString().slice(0, 10),
      views: integer(item.data.metrics?.views),
      contacts: integer(item.data.metrics?.contacts),
      favorites: integer(item.data.metrics?.favorites),
      publishedUrl: item.data.metrics?.publishedUrl || "",
    });
  }

  return (
    <section className={styles.workspace} aria-busy={loading || busy}>
      <header className={styles.header}>
        <div>
          <span>Broker OS · V2</span>
          <h1>Centro de Publicación Multicanal</h1>
          <p>Prepara y aprueba cada ficha por canal. La publicación externa permanece bloqueada hasta activar un proveedor autorizado.</p>
        </div>
        <div className={styles.headerStatus}><b>{items.length}</b><span>borradores y publicaciones<br />dentro de tu alcance</span></div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <section className={styles.providerNotice}>
        <strong>Integraciones externas</strong>
        <p>{options.externalPublicationNotice || "Cargando estado de proveedores…"}</p>
      </section>

      <section className={styles.analytics} aria-label="Resumen de desempeño de publicaciones">
        <article><span>Publicaciones</span><b>{analytics.total}</b><small>{analytics.published} marcadas como publicadas</small></article>
        <article><span>Revisión interna</span><b>{analytics.pendingReview}</b><small>{analytics.approved} aprobadas</small></article>
        <article><span>Proveedor pendiente</span><b>{analytics.pendingProvider}</b><small>sin entrega externa automática</small></article>
        <article><span>Rendimiento informado</span><b>{analytics.contacts}</b><small>{analytics.views} vistas · {analytics.contactRatePct === null ? "sin tasa aún" : `${analytics.contactRatePct}% contactos`}</small></article>
      </section>

      <section className={styles.providers}>
        <div className={styles.providersHeading}><div><span>Proveedores y conectores</span><h2>Estado por portal</h2></div><p>{providers.credentialPolicy || "Cargando política de credenciales…"}</p></div>
        <div className={styles.providerGrid}>
          {providers.providers.map((provider) => <article key={provider.channel} className={styles.providerCard}>
            <div><strong>{provider.channelLabel}</strong><span className={`${styles.status} ${styles[`provider${provider.providerStatus}`] || ""}`}>{readableProviderStatus(provider.providerStatus)}</span></div>
            <p>{provider.configured ? `Actualizado ${date(provider.updatedAt)}` : "Aún no se ha configurado su estado comercial."}</p>
            {canConfigureProviders ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => openProviderConfig(provider.channel)}>Preparar proveedor</button> : null}
          </article>)}
        </div>
        {providerConfig && canConfigureProviders ? <form className={styles.providerConfig} onSubmit={saveProviderConfig}>
          <div className={styles.providerConfigHeading}><div><span>Preparación segura</span><h3>{providerConfig.channelLabel}</h3><p>Registra solo antecedentes comerciales y operativos. Las contraseñas, tokens y API keys no deben quedar en este formulario.</p></div><button type="button" className={styles.archive} disabled={busy} onClick={() => setProviderConfig(null)}>Cerrar</button></div>
          <label>Estado del proveedor<select value={providerConfig.providerStatus} disabled={busy} onChange={(event) => setProviderConfig((current) => current ? { ...current, providerStatus: event.target.value } : current)}>{providers.providerStatuses.map((status) => <option key={status} value={status}>{readableProviderStatus(status)}</option>)}</select></label>
          <label>Referencia de contrato o acuerdo<input value={providerConfig.contractReference} disabled={busy} maxLength={300} onChange={(event) => setProviderConfig((current) => current ? { ...current, contractReference: event.target.value } : current)} placeholder="Ej.: contrato, ticket comercial o folio" /></label>
          <label>Referencia de cuenta del proveedor<input value={providerConfig.accountReference} disabled={busy} maxLength={300} onChange={(event) => setProviderConfig((current) => current ? { ...current, accountReference: event.target.value } : current)} placeholder="Identificador no secreto de la cuenta" /></label>
          <label>Contacto técnico<input type="email" value={providerConfig.technicalContact} disabled={busy} maxLength={300} onChange={(event) => setProviderConfig((current) => current ? { ...current, technicalContact: event.target.value } : current)} placeholder="integraciones@proveedor.cl" /></label>
          <label className={styles.providerNotes}>Notas operativas<textarea value={providerConfig.notes} disabled={busy} maxLength={3000} rows={3} onChange={(event) => setProviderConfig((current) => current ? { ...current, notes: event.target.value } : current)} placeholder="Requisitos, responsable y próximos pasos; no incluir secretos." /></label>
          <div className={styles.providerConfigActions}><span>Almacenamiento de credenciales: {providerConfig.credentialStorage.replaceAll("_", " ")}</span><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : "Guardar preparación"}</button></div>
        </form> : null}
      </section>

      <section className={styles.grid}>
        <form className={styles.composer} onSubmit={createDraft}>
          <div className={styles.sectionHeading}><span>01 · Preparar</span><h2>Nuevo borrador</h2><p>La ficha se valida cuando solicites la revisión. Puedes guardar el contenido aunque aún falten antecedentes.</p></div>
          <label>Propiedad
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} disabled={!canCreate || busy}>
              {options.properties.length ? options.properties.map((item) => <option key={item.id} value={item.id}>{item.title}{item.comuna ? ` · ${item.comuna}` : ""}</option>) : <option value="">No hay propiedades disponibles</option>}
            </select>
          </label>
          {currentProperty ? <p className={styles.propertyHint}>{currentProperty.comuna || "Comuna pendiente"} · {money(currentProperty.price, currentProperty.currency)}</p> : null}
          <label>Canal
            <select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={!canCreate || busy}>
              {options.channels.map((item) => <option key={item.key} value={item.key}>{item.label}{item.providerState === "PENDING_PROVIDER" ? " · próximo conector" : ""}</option>)}
            </select>
          </label>
          <label>Título comercial <small>Opcional: se genera desde la ficha si lo dejas vacío.</small>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} disabled={!canCreate || busy} placeholder="Ej.: Departamento luminoso cerca del metro" />
          </label>
          <label>Descripción comercial <small>Opcional: se prepara con los datos cargados.</small>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} maxLength={6000} disabled={!canCreate || busy} placeholder="Destaca ubicación, características y condiciones verificadas." />
          </label>
          <button className="primary-btn" disabled={!canCreate || busy || !propertyId || !channel}>{busy ? "Guardando…" : "Crear borrador interno"}</button>
          {!canCreate ? <p className={styles.permission}>Tu rol puede consultar publicaciones, pero no crear borradores.</p> : null}
        </form>

        <section className={styles.listPanel}>
          <div className={styles.listHeader}>
            <div><span>02 · Gestionar</span><h2>Cola editorial</h2></div>
            <div className={styles.filters}>
              <select aria-label="Filtrar por estado" value={filter.status} onChange={(event) => { const next = { ...filter, status: event.target.value }; setFilter(next); reload(next).catch((error) => setNotice(messageOf(error))); }}>
                <option value="">Todos los estados</option>{options.statuses.map((status) => <option key={status} value={status}>{readableStatus(status)}</option>)}
              </select>
              <select aria-label="Filtrar por canal" value={filter.channel} onChange={(event) => { const next = { ...filter, channel: event.target.value }; setFilter(next); reload(next).catch((error) => setNotice(messageOf(error))); }}>
                <option value="">Todos los canales</option>{options.channels.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
          </div>
          {loading ? <p className={styles.empty}>Cargando publicaciones…</p> : !items.length ? <p className={styles.empty}>Aún no hay borradores en este alcance.</p> : <div className={styles.cards}>{items.map((item) => {
            const active = item.id === selected?.id;
            const data = item.data;
            return <button className={`${styles.card} ${active ? styles.selected : ""}`} type="button" key={item.id} onClick={() => selectPublication(item)}>
              <div><span className={`${styles.status} ${styles[`status${data.publicationStatus}`] || ""}`}>{readableStatus(data.publicationStatus)}</span><small>{data.channelLabel}</small></div>
              <strong>{data.copy.title || item.title}</strong>
              <p>{data.copy.comuna || "Comuna pendiente"} · {money(data.copy.price, data.copy.currency)}</p>
              <footer><span>Ficha {data.readiness?.score ?? 0}%</span><time>{date(item.updatedAt)}</time></footer>
            </button>;
          })}</div>}
        </section>
      </section>

      {selected ? <section className={styles.detail}>
        <div className={styles.detailHeading}>
          <div><span>03 · Revisar y aprobar</span><h2>{selected.data.channelLabel}</h2><p>{selected.data.copy.address || "Dirección pendiente"}{selected.data.copy.comuna ? ` · ${selected.data.copy.comuna}` : ""}</p></div>
          <span className={`${styles.status} ${styles[`status${selected.data.publicationStatus}`] || ""}`}>{readableStatus(selected.data.publicationStatus)}</span>
        </div>
        <div className={styles.detailGrid}>
          <section className={styles.copyPanel}>
            <label>Título comercial<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit || busy || !["DRAFT", "REJECTED"].includes(selected.data.publicationStatus)} maxLength={180} /></label>
            <label>Descripción<textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={!canEdit || busy || !["DRAFT", "REJECTED"].includes(selected.data.publicationStatus)} rows={9} maxLength={6000} /></label>
            {["DRAFT", "REJECTED"].includes(selected.data.publicationStatus) && canEdit ? <button type="button" className="secondary-btn" disabled={busy} onClick={saveDraft}>Guardar contenido</button> : null}
            <p className={styles.media}>{selected.data.copy.images.length ? `${selected.data.copy.images.length} imagen(es) asociada(s) a la ficha.` : "La ficha no registra imágenes."}</p>
          </section>
          <aside className={styles.reviewPanel}>
            <h3>Control de publicación</h3>
            <div className={styles.readiness}><b>{selected.data.readiness?.score ?? 0}%</b><span>completitud de ficha</span></div>
            {selected.data.readiness?.missing?.length ? <ul>{selected.data.readiness.missing.map((item) => <li key={item}>{item}</li>)}</ul> : <p className={styles.ready}>La ficha cumple los controles internos para revisión.</p>}
            <dl><div><dt>Revisión</dt><dd>{readableStatus(selected.data.approval?.status || "DRAFT")}</dd></div><div><dt>Proveedor</dt><dd>{selected.data.provider?.state === "PENDING_PROVIDER" ? "Conector pendiente" : "Interno"}</dd></div><div><dt>Entrega externa</dt><dd>{readableDeliveryMode(selected.data.provider?.deliveryMode)}</dd></div><div><dt>Última edición</dt><dd>{date(selected.updatedAt)}</dd></div></dl>
            <label>Nota de control<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} disabled={busy} placeholder="Motivo de aprobación, pausa o revisión" /></label>
            <div className={styles.actions}>
              {["DRAFT", "REJECTED"].includes(selected.data.publicationStatus) ? <button type="button" className="primary-btn" disabled={!canEdit || busy || !selected.data.readiness?.readyForReview} onClick={() => transition("REQUEST_REVIEW")}>Solicitar revisión</button> : null}
              {selected.data.publicationStatus === "PENDING_REVIEW" ? <button type="button" className="primary-btn" disabled={!canApprove || busy} onClick={() => transition("APPROVE")}>Aprobar internamente</button> : null}
              {selected.data.publicationStatus === "PENDING_REVIEW" ? <button type="button" className="secondary-btn" disabled={!canApprove || busy || !note.trim()} onClick={() => transition("REJECT")}>Rechazar con motivo</button> : null}
              {selected.data.publicationStatus === "APPROVED" ? <button type="button" className="secondary-btn" disabled={!canEdit || busy} onClick={() => transition("PREPARE_PROVIDER")}>Preparar para proveedor</button> : null}
              {["APPROVED", "PROVIDER_PENDING", "PUBLISHED"].includes(selected.data.publicationStatus) ? <button type="button" className="secondary-btn" disabled={!canEdit || busy} onClick={() => transition("PAUSE")}>Pausar</button> : null}
              {selected.data.publicationStatus !== "ARCHIVED" ? <button type="button" className={styles.archive} disabled={!canEdit || busy} onClick={() => transition("ARCHIVE")}>Archivar</button> : null}
            </div>
            {["APPROVED", "PROVIDER_PENDING"].includes(selected.data.publicationStatus) ? <section className={styles.deliveryPanel}>
              <strong>Resultado en portal externo</strong>
              <p>Úsalo solamente si una persona publicó fuera de EVOLUM y puede dejar evidencia. Esta acción no envía información al portal.</p>
              <label>Comprobante o ID de publicación<input value={delivery.externalReference} disabled={!canEdit || busy} onChange={(event) => setDelivery((current) => ({ ...current, externalReference: event.target.value }))} maxLength={300} placeholder="Ej.: ID o comprobante entregado por el portal" /></label>
              <label>URL publicada<input type="url" value={delivery.publishedUrl} disabled={!canEdit || busy} onChange={(event) => setDelivery((current) => ({ ...current, publishedUrl: event.target.value }))} placeholder="https://…" /></label>
              <button type="button" className="secondary-btn" disabled={!canEdit || busy || (!delivery.externalReference.trim() && !delivery.publishedUrl.trim())} onClick={() => transition("CONFIRM_EXTERNAL_PUBLICATION")}>Confirmar publicación manual</button>
              <label>Incidencia del proveedor<textarea value={delivery.error} disabled={!canEdit || busy} onChange={(event) => setDelivery((current) => ({ ...current, error: event.target.value }))} rows={2} placeholder="Ej.: portal rechazó las imágenes por formato" /></label>
              <button type="button" className={styles.reportIssue} disabled={!canEdit || busy || !delivery.error.trim()} onClick={() => transition("REPORT_PROVIDER_FAILURE")}>Registrar incidencia</button>
            </section> : null}
            {selected.data.publicationStatus === "PUBLISHED" && selected.data.provider?.publishedUrl ? <a className={styles.publishedLink} href={selected.data.provider.publishedUrl} target="_blank" rel="noreferrer">Abrir evidencia publicada</a> : null}
            {selected.data.publicationStatus === "DRAFT" && !selected.data.readiness?.readyForReview ? <p className={styles.warning}>Completa los antecedentes indicados antes de solicitar aprobación.</p> : null}
          </aside>
        </div>
        <section className={styles.performance}>
          <div><span>04 · Medir y exportar</span><h3>Rendimiento por canal</h3><p>Registra datos manuales o recibidos del portal. La URL es una referencia informativa y no valida una publicación.</p></div>
          <div className={styles.metricsForm}>
            <label>Fecha de reporte<input type="date" value={metrics.reportDate} disabled={!canEdit || busy} onChange={(event) => setMetrics((current) => ({ ...current, reportDate: event.target.value }))} /></label>
            <label>Vistas<input inputMode="numeric" value={metrics.views} disabled={!canEdit || busy} onChange={(event) => setMetrics((current) => ({ ...current, views: event.target.value }))} /></label>
            <label>Contactos<input inputMode="numeric" value={metrics.contacts} disabled={!canEdit || busy} onChange={(event) => setMetrics((current) => ({ ...current, contacts: event.target.value }))} /></label>
            <label>Favoritos<input inputMode="numeric" value={metrics.favorites} disabled={!canEdit || busy} onChange={(event) => setMetrics((current) => ({ ...current, favorites: event.target.value }))} /></label>
            <label className={styles.metricUrl}>URL publicada o comprobante<input type="url" value={metrics.publishedUrl} disabled={!canEdit || busy} onChange={(event) => setMetrics((current) => ({ ...current, publishedUrl: event.target.value }))} placeholder="https://…" /></label>
            <div className={styles.metricActions}>
              <button type="button" className="secondary-btn" disabled={!canEdit || busy} onClick={saveMetrics}>Guardar rendimiento</button>
              <button type="button" className={styles.exportButton} disabled={busy} onClick={exportTechnicalPayload}>Descargar JSON técnico</button>
            </div>
          </div>
        </section>
        <section className={styles.timeline}><h3>Bitácora de la publicación</h3>{selected.data.lifecycle?.slice().reverse().map((event, index) => <article key={`${event.at}-${index}`}><time>{date(event.at)}</time><div><b>{event.action.replaceAll("_", " ")}</b><span>{event.by}</span>{event.note ? <p>{event.note}</p> : null}</div></article>)}</section>
      </section> : null}
    </section>
  );
}
