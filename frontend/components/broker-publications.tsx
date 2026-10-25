/** Archivo: Renderiza el Centro de Publicación Multicanal de Broker OS. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { canBroker } from "@/lib/broker-access";
import {
  actBrokerPublication,
  createBrokerPublication,
  getBrokerAccess,
  getBrokerPublicationOptions,
  getBrokerPublications,
  updateBrokerPublication,
  type BrokerAccessProfile,
  type BrokerPublication,
  type BrokerPublicationOptions,
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

const emptyOptions: BrokerPublicationOptions = {
  channels: [], statuses: [], properties: [], externalPublicationEnabled: false, externalPublicationNotice: ""
};

/**
 * Separa el trabajo editorial interno de las integraciones reales: una
 * aprobación nunca envía datos a terceros y cada estado deja trazabilidad.
 */
export function BrokerPublicationsPageContent() {
  const [access, setAccess] = useState<BrokerAccessProfile | null>(null);
  const [options, setOptions] = useState<BrokerPublicationOptions>(emptyOptions);
  const [items, setItems] = useState<BrokerPublication[]>([]);
  const [selected, setSelected] = useState<BrokerPublication | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [channel, setChannel] = useState("");
  const [filter, setFilter] = useState({ status: "", channel: "" });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const canCreate = canBroker(access, "projects", "CREATE");
  const canEdit = canBroker(access, "projects", "EDIT");
  const canApprove = canBroker(access, "projects", "APPROVE");

  const currentProperty = useMemo(() => options.properties.find((item) => item.id === propertyId) || null, [options.properties, propertyId]);

  async function reload(nextFilter = filter) {
    const [nextAccess, nextOptions, publications] = await Promise.all([
      getBrokerAccess(),
      getBrokerPublicationOptions(),
      getBrokerPublications(nextFilter),
    ]);
    setAccess(nextAccess);
    setOptions(nextOptions);
    setItems(publications.items);
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

  async function transition(action: "REQUEST_REVIEW" | "APPROVE" | "PREPARE_PROVIDER" | "PAUSE" | "ARCHIVE") {
    if (!selected) return;
    try {
      setBusy(true);
      const updated = await actBrokerPublication(selected.id, { action, note });
      setSelected(updated);
      setNotice(updated.notice || `Estado actualizado: ${readableStatus(updated.data.publicationStatus)}.`);
      setNote("");
      await reload();
    } catch (error) { setNotice(messageOf(error)); } finally { setBusy(false); }
  }

  function selectPublication(item: BrokerPublication) {
    setSelected(item);
    setTitle(item.data.copy.title || "");
    setBody(item.data.copy.body || "");
    setNote("");
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
            <dl><div><dt>Revisión</dt><dd>{readableStatus(selected.data.approval?.status || "DRAFT")}</dd></div><div><dt>Proveedor</dt><dd>{selected.data.provider?.state === "PENDING_PROVIDER" ? "Conector pendiente" : "Interno"}</dd></div><div><dt>Última edición</dt><dd>{date(selected.updatedAt)}</dd></div></dl>
            <label>Nota de control<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} disabled={busy} placeholder="Motivo de aprobación, pausa o revisión" /></label>
            <div className={styles.actions}>
              {["DRAFT", "REJECTED"].includes(selected.data.publicationStatus) ? <button type="button" className="primary-btn" disabled={!canEdit || busy || !selected.data.readiness?.readyForReview} onClick={() => transition("REQUEST_REVIEW")}>Solicitar revisión</button> : null}
              {selected.data.publicationStatus === "PENDING_REVIEW" ? <button type="button" className="primary-btn" disabled={!canApprove || busy} onClick={() => transition("APPROVE")}>Aprobar internamente</button> : null}
              {selected.data.publicationStatus === "APPROVED" ? <button type="button" className="secondary-btn" disabled={!canEdit || busy} onClick={() => transition("PREPARE_PROVIDER")}>Preparar para proveedor</button> : null}
              {["APPROVED", "PROVIDER_PENDING", "PUBLISHED"].includes(selected.data.publicationStatus) ? <button type="button" className="secondary-btn" disabled={!canEdit || busy} onClick={() => transition("PAUSE")}>Pausar</button> : null}
              {selected.data.publicationStatus !== "ARCHIVED" ? <button type="button" className={styles.archive} disabled={!canEdit || busy} onClick={() => transition("ARCHIVE")}>Archivar</button> : null}
            </div>
            {selected.data.publicationStatus === "DRAFT" && !selected.data.readiness?.readyForReview ? <p className={styles.warning}>Completa los antecedentes indicados antes de solicitar aprobación.</p> : null}
          </aside>
        </div>
        <section className={styles.timeline}><h3>Bitácora de la publicación</h3>{selected.data.lifecycle?.slice().reverse().map((event, index) => <article key={`${event.at}-${index}`}><time>{date(event.at)}</time><div><b>{event.action.replaceAll("_", " ")}</b><span>{event.by}</span>{event.note ? <p>{event.note}</p> : null}</div></article>)}</section>
      </section> : null}
    </section>
  );
}
