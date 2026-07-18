"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createIndustryBrokerUser,
  createRealtyPropertyCampaignDraft,
  getRealtyPropertyMatches,
  createIndustryRecord,
  deleteIndustryBrokerUser,
  getRealtyIntelligence,
  getIndustryRecords,
  getIndustryUsers,
  updateIndustryRecord,
  type IndustryRecord,
  type IndustryUser,
  type RealtyIntelligence
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { ModuleAccessKey } from "@/lib/module-access";

export const REALTY_STAGES = [
  { key: "LEAD", label: "Lead" },
  { key: "CONTACT", label: "Contacto" },
  { key: "QUALIFIED", label: "Calificado" },
  { key: "VISIT_SCHEDULED", label: "Visita agendada" },
  { key: "OFFER", label: "Oferta" },
  { key: "NEGOTIATION", label: "Negociacion" },
  { key: "CLOSING", label: "Cierre" },
  { key: "POSTSALE", label: "Postventa" }
];

type Broker = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  isProfile?: boolean;
};

type RealtyData = {
  properties: IndustryRecord[];
  owners: IndustryRecord[];
  visits: IndustryRecord[];
  deals: IndustryRecord[];
  alerts: IndustryRecord[];
  followups: IndustryRecord[];
  users: IndustryUser[];
  brokers: Broker[];
};

const emptyData: RealtyData = {
  properties: [],
  owners: [],
  visits: [],
  deals: [],
  alerts: [],
  followups: [],
  users: [],
  brokers: []
};

const emptyProperty = {
  title: "",
  propertyType: "departamento",
  operation: "venta",
  price: "",
  address: "",
  material: "",
  bedrooms: "",
  bathrooms: "",
  parking: "",
  meters: "",
  photoUrl: "",
  galleryUrls: "",
  videoUrl: "",
  observations: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  assignedBrokerId: "",
  stage: "LEAD"
};

function parseCsvRows(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = text.split("\n", 1)[0] || "";
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ";" : ",";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && char === "\n") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  const [headers = [], ...values] = rows;
  return values.map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] || ""])));
}

const emptyBroker = {
  name: "",
  email: "",
  password: "",
  phone: "",
  role: "Corredor",
  level: "PRO"
};

function asData(record?: IndustryRecord | null) {
  return (record?.data || {}) as Record<string, unknown>;
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => text(item)).filter(Boolean);
    } catch {
      // Un valor manual se interpreta como una lista separada por comas o saltos.
    }
  }
  return raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function propertyPhotos(data: Record<string, unknown>) {
  return Array.from(new Set([
    text(data.photoUrl),
    ...stringList(data.gallery),
    ...stringList(data.photoUrls),
    ...stringList(data.galleryUrls)
  ].filter(Boolean)));
}

function propertyVideos(data: Record<string, unknown>) {
  return Array.from(new Set([
    text(data.videoUrl),
    ...stringList(data.videoUrls)
  ].filter(Boolean)));
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  const amount = numberValue(value);
  return amount
    ? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount)
    : "Sin precio";
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CO";
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getBrokerName(property: IndustryRecord, brokers: Broker[]) {
  const data = asData(property);
  const id = text(data.assignedBrokerId || property.assignedToId);
  if (!id) return "Sin corredor";
  return brokers.find((broker) => broker.id === id)?.name || text(data.assignedBrokerName, "Corredor asignado");
}

function assignedPropertyCount(properties: IndustryRecord[], brokerId: string) {
  return properties.filter((item) => text(asData(item).assignedBrokerId || item.assignedToId) === brokerId).length;
}

function BrokerProfileCard({
  broker,
  properties,
  onDelete,
  isDeleting
}: {
  broker: Broker;
  properties: IndustryRecord[];
  onDelete?: (broker: Broker) => void;
  isDeleting?: boolean;
}) {
  const assigned = assignedPropertyCount(properties, broker.id);
  return (
    <article className="broker-profile-card">
      <div className="broker-profile-avatar">{initials(broker.name)}</div>
      <div className="broker-profile-body">
        <strong>{broker.name || "Corredor"}</strong>
        <span>{broker.email || broker.role || "Corredor"}</span>
        <small>{assigned} {assigned === 1 ? "propiedad asignada" : "propiedades asignadas"}</small>
        {onDelete ? (
          <button type="button" className="broker-delete-btn" disabled={isDeleting} onClick={() => onDelete(broker)}>
            {isDeleting ? "Eliminando..." : "Eliminar corredor"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RealtyPredictivePanel({ data }: { data: RealtyData }) {
  const total = data.properties.length;
  const withPrice = data.properties.filter((property) => numberValue(asData(property).price)).length;
  const withPhoto = data.properties.filter((property) => text(asData(property).photoUrl)).length;
  const assigned = data.properties.filter((property) => text(asData(property).assignedBrokerId || property.assignedToId)).length;
  const withMeters = data.properties.filter((property) => numberValue(asData(property).meters)).length;
  const comparableProperties = data.properties.filter((property) => {
    const propertyData = asData(property);
    return numberValue(propertyData.price) && numberValue(propertyData.meters);
  });
  const pricePerM2 = comparableProperties.length
    ? comparableProperties.reduce((sum, property) => {
        const propertyData = asData(property);
        const meters = numberValue(propertyData.meters);
        return sum + (meters ? numberValue(propertyData.price) / meters : 0);
      }, 0) / comparableProperties.length
    : 0;
  const comunaCounts = data.properties.reduce<Record<string, number>>((acc, property) => {
    const propertyData = asData(property);
    const source = text(propertyData.comuna || propertyData.commune || propertyData.address);
    const comuna = source.split(",")[0]?.trim();
    if (!comuna) return acc;
    acc[comuna] = (acc[comuna] || 0) + 1;
    return acc;
  }, {});
  const topComuna = Object.entries(comunaCounts).sort((a, b) => b[1] - a[1])[0];
  const priorityUnassigned = data.properties
    .filter((property) => !text(asData(property).assignedBrokerId || property.assignedToId))
    .sort((a, b) => numberValue(asData(b).price) - numberValue(asData(a).price))[0];
  const readiness = total ? Math.round(((withPrice + withPhoto + assigned + withMeters) / (total * 4)) * 100) : 0;
  const avgPrice = withPrice
    ? data.properties.reduce((sum, property) => sum + numberValue(asData(property).price), 0) / withPrice
    : 0;
  const recommendations = [
    withPhoto < total ? `${total - withPhoto} propiedades sin foto principal` : "Fotos principales completas",
    assigned < total ? `${total - assigned} propiedades sin corredor asignado` : "Cartera asignada a corredores",
    withMeters < total ? `${total - withMeters} propiedades sin m2 para forecast` : "M2 listos para comparables",
    withPrice < total ? `${total - withPrice} propiedades sin precio` : "Precios listos para analisis"
  ];
  const marketSignals = [
    topComuna ? `Mayor inventario en ${topComuna[0]} (${topComuna[1]})` : "Sin comuna para segmentar demanda",
    pricePerM2 ? `Referencia ${money(pricePerM2)} por m2` : "Faltan precio y m2 para comparables",
    priorityUnassigned ? `Priorizar asignacion: ${priorityUnassigned.title}` : "Sin propiedades criticas sin corredor"
  ];

  return (
    <section className="vertical-card realty-predictive-panel">
      <div className="vertical-card-head">
        <div><span>IA predictiva inmobiliaria</span><h2>Calidad de inventario</h2></div>
        <strong>{readiness}% listo</strong>
      </div>
      <div className="realty-predictive-grid">
        <article><small>Propiedades</small><strong>{total}</strong><span>base activa</span></article>
        <article><small>Precio promedio</small><strong>{money(avgPrice)}</strong><span>solo fichas con precio</span></article>
        <article><small>Asignacion</small><strong>{assigned}/{total}</strong><span>corredores vinculados</span></article>
      </div>
      <div className="realty-market-grid">
        <article><small>Comparables</small><strong>{comparableProperties.length}</strong><span>precio + m2</span></article>
        <article><small>Comuna lider</small><strong>{topComuna?.[0] || "Sin datos"}</strong><span>{topComuna ? `${topComuna[1]} propiedades` : "carga pendiente"}</span></article>
        <article><small>Matching</small><strong>{assigned}/{total}</strong><span>propiedad-corredor</span></article>
      </div>
      <div className="realty-recommendations">
        {recommendations.map((item) => <span key={item}>{item}</span>)}
      </div>
      <div className="realty-market-signals">
        {marketSignals.map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}

function RealtyIntelligencePanel() {
  const [intelligence, setIntelligence] = useState<RealtyIntelligence | null>(null);

  useEffect(() => {
    getRealtyIntelligence().then(setIntelligence).catch(() => setIntelligence(null));
  }, []);

  if (!intelligence) return null;
  const { inventory, marketing } = intelligence;
  return (
    <section className="vertical-card realty-predictive-panel">
      <div className="vertical-card-head"><div><span>Inteligencia operacional</span><h2>Cartera, demanda y marketing</h2></div><strong>{inventory.averageCompleteness}% completa</strong></div>
      <div className="realty-predictive-grid">
        <article><small>Sin corredor</small><strong>{inventory.unassigned}</strong><span>requieren asignación</span></article>
        <article><small>Sin material</small><strong>{inventory.missingMedia}</strong><span>sin foto o galería</span></article>
        <article><small>Sin actualizar</small><strong>{inventory.stale}</strong><span>más de 14 días</span></article>
        <article><small>Visitas activas</small><strong>{intelligence.visits.pending}</strong><span>agenda comercial</span></article>
      </div>
      <div className="realty-insight-list">
        <div><strong>Audiencias recomendadas</strong>{marketing.audiences.map((audience) => <p key={audience.key}>{audience.count} · {audience.label} <small>({audience.recommendedChannel})</small></p>)}</div>
        <div><strong>Prioridades</strong>{intelligence.priorities.map((item) => <p key={item.code}>{item.message}</p>)}</div>
      </div>
    </section>
  );
}

export function useRealtyWorkspace() {
  const [data, setData] = useState<RealtyData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [properties, owners, visits, deals, alerts, followups, users, brokerProfiles] = await Promise.all([
        getIndustryRecords("property"),
        getIndustryRecords("owner"),
        getIndustryRecords("visit"),
        getIndustryRecords("deal"),
        getIndustryRecords("realty_alert"),
        getIndustryRecords("broker_followup"),
        getIndustryUsers(),
        getIndustryRecords("broker_profile")
      ]);

      const profileUserIds = new Set(brokerProfiles.map((record) => text(asData(record).userId || record.assignedToId)).filter(Boolean));
      const userBrokers = users
        .filter((user) => (
          String(user.role || "").toUpperCase() === "SELLER" ||
          profileUserIds.has(user.id) ||
          String(user.jobTitle || "").toLowerCase().includes("corredor")
        ))
        .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role }));
      const userBrokerIds = new Set(userBrokers.map((broker) => broker.id));
      const userBrokerEmails = new Set(userBrokers.map((broker) => String(broker.email || "").toLowerCase()).filter(Boolean));
      const profileBrokers = brokerProfiles
        .map((record) => {
          const recordData = asData(record);
          return {
            id: text(recordData.userId, record.id),
            name: text(recordData.name, record.title),
            email: text(recordData.email),
            role: text(recordData.role, "Corredor"),
            isProfile: true
          };
        })
        .filter((broker) => !userBrokerIds.has(broker.id) && !userBrokerEmails.has(String(broker.email || "").toLowerCase()));

      setData({ properties, owners, visits, deals, alerts, followups, users, brokers: [...userBrokers, ...profileBrokers] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la vertical inmobiliaria");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { data, loading, error, reload: load };
}

export function RealtyShell({
  active,
  moduleKey,
  children
}: {
  active: string;
  moduleKey: ModuleAccessKey;
  children: ReactNode;
}) {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <ModuleGate moduleKey={moduleKey}>
      <div className={`vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar
          active={active}
          isDeveloper={agent?.role === "SUPER_ADMIN"}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((value) => !value)}
        />
        <main className="vertical-main realty-page">{children}</main>
      </div>
    </ModuleGate>
  );
}

export function RealtyHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="vertical-hero realty-hero">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="realty-hero-actions">
        {actions}
        <AccountPill fallbackName={getStoredSession()?.name || "Usuario"} />
      </div>
    </header>
  );
}

export function RealtyKpis({ data }: { data: RealtyData }) {
  const active = data.properties.filter((item) => item.status !== "ARCHIVED").length;
  const value = data.properties.reduce((acc, item) => acc + numberValue(asData(item).price), 0);
  const assigned = data.properties.filter((item) => text(asData(item).assignedBrokerId || item.assignedToId)).length;
  const visits = data.visits.filter((item) => item.status !== "DONE").length;

  return (
    <section className="realty-kpi-grid">
      <article className="realty-kpi-card"><span>Propiedades</span><strong>{active}</strong><small>portal activo</small></article>
      <article className="realty-kpi-card"><span>Valor cartera</span><strong>{money(value)}</strong><small>inventario cargado</small></article>
      <article className="realty-kpi-card"><span>Asignadas</span><strong>{assigned}</strong><small>con corredor responsable</small></article>
      <article className="realty-kpi-card"><span>Visitas abiertas</span><strong>{visits}</strong><small>agenda comercial</small></article>
    </section>
  );
}

export function PropertyPortalCards({
  properties,
  brokers,
  onStageChange,
  onBrokerChange,
  onOpen
}: {
  properties: IndustryRecord[];
  brokers: Broker[];
  onStageChange?: (property: IndustryRecord, stage: string) => Promise<void> | void;
  onBrokerChange?: (property: IndustryRecord, brokerId: string) => Promise<void> | void;
  onOpen?: (property: IndustryRecord) => void;
}) {
  if (!properties.length) {
    return <p className="empty-state">Aun no hay propiedades cargadas.</p>;
  }

  return (
    <div className="property-portal-grid">
      {properties.map((property) => {
        const data = asData(property);
        const photoUrl = text(data.photoUrl);
        const assignedBrokerId = text(data.assignedBrokerId || property.assignedToId);
        return (
          <article className="property-portal-card" key={property.id}>
            <div className="property-portal-media">
              {photoUrl ? <img src={photoUrl} alt={property.title} /> : <span>{initials(property.title)}</span>}
            </div>
            <div className="property-portal-body">
              <div>
                <strong>{property.title}</strong>
                <p>{text(data.address, "Direccion por completar")}</p>
              </div>
              <div className="property-portal-price">{money(data.price)}</div>
              <div className="property-portal-specs">
                <span>{text(data.bedrooms, "0")} dorm.</span>
                <span>{text(data.bathrooms, "0")} banos</span>
                <span>{text(data.parking, "0")} estac.</span>
                <span>{text(data.meters, "0")} m2</span>
              </div>
              <small>{text(data.observations, "Sin observaciones")}</small>
              <div className="property-card-actions">
                {onBrokerChange ? (
                  <label className="property-assignment-row">
                    <small>Corredor</small>
                    <select value={assignedBrokerId} onChange={(event) => onBrokerChange(property, event.target.value)}>
                      <option value="">Sin corredor</option>
                      {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <span>{getBrokerName(property, brokers)}</span>
                )}
                {onStageChange ? (
                  <select value={text(data.stage, "LEAD")} onChange={(event) => onStageChange(property, event.target.value)}>
                    {REALTY_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                  </select>
                ) : (
                  <span>{REALTY_STAGES.find((stage) => stage.key === text(data.stage))?.label || "Lead"}</span>
                )}
              </div>
              {onOpen ? <button className="secondary-btn property-open-btn" type="button" onClick={() => onOpen(property)}>Ver ficha completa</button> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PropertyBuyerMatches({ propertyId }: { propertyId: string }) {
  const [matches, setMatches] = useState<Array<{ score: number; reasons: string[]; buyer: { id: string; name: string; commune?: string | null; propertyType?: string | null; conversationId: string } }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getRealtyPropertyMatches(propertyId)
      .then((result) => { if (active) setMatches(result.matches || []); })
      .catch(() => { if (active) setMatches([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [propertyId]);

  return <section className="property-buyer-matches">
    <div><span>Compradores recomendados</span><h3>Personas que podrían calzar con esta propiedad</h3></div>
    {loading ? <p>Buscando compradores compatibles...</p> : null}
    {!loading && !matches.length ? <p>Aún no hay compradores compatibles. Cuando un cliente indique presupuesto, comuna o tipo de propiedad en Chat&apos;s, aparecerá aquí.</p> : null}
    <div className="property-buyer-match-list">{matches.map((match) => <article key={match.buyer.id}>
      <strong>{match.buyer.name}</strong><b>{match.score}% compatible</b>
      <span>{match.buyer.commune || "Comuna por confirmar"} · {match.buyer.propertyType || "Tipo por confirmar"}</span>
      <small>{match.reasons.slice(0, 3).join(" · ") || "Compatibilidad general"}</small>
      <Link href={`/inbox?conversation=${encodeURIComponent(match.buyer.conversationId)}`}>Ver conversación</Link>
    </article>)}</div>
  </section>;
}

export function PropertyDetailModal({
  property,
  brokers,
  onClose,
  onCreateCampaign
}: {
  property: IndustryRecord;
  brokers: Broker[];
  onClose: () => void;
  onCreateCampaign?: (property: IndustryRecord) => Promise<void> | void;
}) {
  const data = asData(property);
  const photos = propertyPhotos(data);
  const videos = propertyVideos(data);
  const [activePhoto, setActivePhoto] = useState(0);
  const selectedPhoto = photos[activePhoto] || "";
  const features = stringList(data.features);
  const details = [
    ["Operacion", text(data.operation, "Venta")],
    ["Tipo", text(data.propertyType, "Propiedad")],
    ["Dormitorios", text(data.bedrooms, "0")],
    ["Banos", text(data.bathrooms, "0")],
    ["Estacionamientos", text(data.parking, "0")],
    ["Superficie", `${text(data.meters || data.builtM2, "0")} m2`],
    ["Terreno", `${text(data.landM2, "No informado")}${data.landM2 ? " m2" : ""}`],
    ["Material", text(data.material, "No informado")],
    ["Ano construccion", text(data.yearBuilt, "No informado")],
    ["Orientacion", text(data.orientation, "No informado")],
    ["Gastos comunes", money(data.commonExpenses)],
    ["Etapa comercial", REALTY_STAGES.find((stage) => stage.key === text(data.stage))?.label || "Lead"]
  ];

  return (
    <div className="property-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="property-detail-modal" role="dialog" aria-modal="true" aria-labelledby={`property-detail-${property.id}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="property-detail-header">
          <div>
            <span>Ficha inmobiliaria</span>
            <h2 id={`property-detail-${property.id}`}>{property.title}</h2>
            <p>{text(data.address, "Direccion por completar")}{data.comuna ? `, ${text(data.comuna)}` : ""}{data.region ? `, ${text(data.region)}` : ""}</p>
          </div>
          <button type="button" className="property-detail-close" onClick={onClose} aria-label="Cerrar ficha">x</button>
        </header>

        <div className="property-detail-layout">
          <section className="property-detail-media">
            <div className="property-detail-primary-media">
              {selectedPhoto ? <img src={selectedPhoto} alt={property.title} /> : <span>{initials(property.title)}</span>}
              <b>{money(data.price)}</b>
            </div>
            {photos.length > 1 ? (
              <div className="property-detail-thumbnails">
                {photos.map((photo, index) => <button type="button" className={index === activePhoto ? "active" : ""} onClick={() => setActivePhoto(index)} key={photo}><img src={photo} alt={`${property.title} foto ${index + 1}`} /></button>)}
              </div>
            ) : null}
            {videos.length ? (
              <div className="property-detail-videos">
                <strong>Videos y recorridos</strong>
                {videos.map((video, index) => (
                  <a href={video} target="_blank" rel="noreferrer" key={video}>Abrir recorrido {index + 1}</a>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="property-detail-aside">
            <div className="property-detail-assignee">
              <span>Corredor responsable</span>
              <strong>{getBrokerName(property, brokers)}</strong>
            </div>
            <div className="property-detail-owner">
              <span>Propietario</span>
              <strong>{text(data.ownerName, "Sin propietario informado")}</strong>
              {data.ownerPhone ? <small>{text(data.ownerPhone)}</small> : null}
              {data.ownerEmail ? <small>{text(data.ownerEmail)}</small> : null}
            </div>
            {onCreateCampaign ? <button type="button" className="secondary-btn" onClick={() => onCreateCampaign(property)}>Crear borrador de campaña</button> : null}
          </aside>
        </div>

        <section className="property-detail-specs">
          {details.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </section>

        <PropertyBuyerMatches propertyId={property.id} />

        <section className="property-detail-description">
          <div>
            <span>Descripcion</span>
            <p>{text(data.observations, "Esta propiedad aun no tiene observaciones cargadas.")}</p>
          </div>
          {features.length ? <div className="property-detail-features">{features.map((feature) => <span key={feature}>{feature}</span>)}</div> : null}
        </section>
      </section>
    </div>
  );
}

export function RealtyLoadsPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [propertyForm, setPropertyForm] = useState(emptyProperty);
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  async function createProperty(event: FormEvent) {
    event.preventDefault();
    const broker = data.brokers.find((item) => item.id === propertyForm.assignedBrokerId);
    await createIndustryRecord({
      recordType: "property",
      title: propertyForm.title || "Propiedad sin nombre",
      status: "ACTIVE",
      assignedToId: propertyForm.assignedBrokerId || null,
      data: {
        ...propertyForm,
        gallery: stringList(propertyForm.galleryUrls),
        price: numberValue(propertyForm.price),
        bedrooms: numberValue(propertyForm.bedrooms),
        bathrooms: numberValue(propertyForm.bathrooms),
        parking: numberValue(propertyForm.parking),
        meters: numberValue(propertyForm.meters),
        assignedBrokerName: broker?.name || ""
      }
    });
    if (propertyForm.ownerName) {
      await createIndustryRecord({
        recordType: "owner",
        title: propertyForm.ownerName,
        status: "ACTIVE",
        data: { phone: propertyForm.ownerPhone, email: propertyForm.ownerEmail, propertyTitle: propertyForm.title }
      });
    }
    setPropertyForm(emptyProperty);
    setMessage("Propiedad cargada");
    await reload();
  }

  async function onPhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const photos = await Promise.all(files.map((file) => fileToDataUrl(file)));
    setPropertyForm((current) => {
      const gallery = Array.from(new Set([...stringList(current.galleryUrls), ...photos]));
      return {
        ...current,
        photoUrl: current.photoUrl || photos[0],
        galleryUrls: gallery.join("\n")
      };
    });
  }

  async function onCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseCsvRows(await file.text());
    setImportRows(rows);
    setMessage(`${rows.length} filas listas para importar`);
  }

  async function importProperties() {
    for (const row of importRows) {
      const title = text(row["Nombre"] || row["Titulo"] || row["Propiedad"], "Propiedad importada");
      await createIndustryRecord({
        recordType: "property_import",
        title: `Importacion ${title}`,
        status: "READY",
        data: { source: "csv", row }
      });
      await createIndustryRecord({
        recordType: "property",
        title,
        status: "ACTIVE",
        data: {
          propertyType: text(row["Tipo"], "departamento"),
          operation: text(row["Operacion"], "venta"),
          price: numberValue(row["Precio"]),
          address: text(row["Direccion"] || row["Comuna"]),
          bedrooms: numberValue(row["Piezas"] || row["Dormitorios"]),
          bathrooms: numberValue(row["Banos"]),
          parking: numberValue(row["Estacionamientos"]),
          meters: numberValue(row["M2"]),
          material: text(row["Material"]),
          observations: text(row["Observaciones"]),
          source: "excel_import",
          stage: "LEAD"
        }
      });
    }
    setImportRows([]);
    setMessage("Importacion inmobiliaria completada");
    await reload();
  }

  async function autoAssign() {
    const brokers = data.brokers;
    if (!brokers.length) {
      setMessage("Agrega corredores para calcular reparto");
      return;
    }
    const unassigned = data.properties.filter((item) => !text(asData(item).assignedBrokerId || item.assignedToId));
    await Promise.all(unassigned.map((property, index) => {
      const broker = brokers[index % brokers.length];
      return updateIndustryRecord(property.id, {
        assignedToId: broker.id,
        data: { ...asData(property), assignedBrokerId: broker.id, assignedBrokerName: broker.name, assignmentMode: "automatico" }
      });
    }));
    setMessage("Reparto automatico aplicado");
    await reload();
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Rubro inmobiliario"
        title="Cargas inmobiliarias"
        description="Creacion, importacion, capacitacion, corredores, recordatorios, agenda comercial y comisiones."
        actions={<button className="secondary-btn" onClick={autoAssign}>Asignar automatico</button>}
      />
      <RealtyKpis data={data} />
      {message ? <div className="module-toast">{message}</div> : null}
      {error ? <div className="sales-queue-error">{error}</div> : null}

      <section className="realty-ops-grid">
        <form className="vertical-card realty-property-form" onSubmit={createProperty}>
          <div className="vertical-card-head"><div><span>Nueva propiedad</span><h2>Ficha de vivienda</h2></div></div>
          <input value={propertyForm.title} onChange={(e) => setPropertyForm({ ...propertyForm, title: e.target.value })} placeholder="Nombre de propiedad" />
          <div className="form-grid-2">
            <input value={propertyForm.price} onChange={(e) => setPropertyForm({ ...propertyForm, price: e.target.value })} placeholder="Precio CLP" />
            <input value={propertyForm.meters} onChange={(e) => setPropertyForm({ ...propertyForm, meters: e.target.value })} placeholder="M2" />
          </div>
          <input value={propertyForm.address} onChange={(e) => setPropertyForm({ ...propertyForm, address: e.target.value })} placeholder="Direccion / comuna" />
          <div className="form-grid-3">
            <input value={propertyForm.bedrooms} onChange={(e) => setPropertyForm({ ...propertyForm, bedrooms: e.target.value })} placeholder="Piezas" />
            <input value={propertyForm.bathrooms} onChange={(e) => setPropertyForm({ ...propertyForm, bathrooms: e.target.value })} placeholder="Banos" />
            <input value={propertyForm.parking} onChange={(e) => setPropertyForm({ ...propertyForm, parking: e.target.value })} placeholder="Estac." />
          </div>
          <input value={propertyForm.material} onChange={(e) => setPropertyForm({ ...propertyForm, material: e.target.value })} placeholder="Material principal" />
          <div className="file-picker-row">
            <input value={propertyForm.photoUrl} onChange={(e) => setPropertyForm({ ...propertyForm, photoUrl: e.target.value })} placeholder="URL foto principal o archivo" />
            <label className="secondary-btn">Subir fotos<input type="file" accept="image/*" multiple hidden onChange={onPhotoFile} /></label>
          </div>
          <input value={propertyForm.galleryUrls} onChange={(e) => setPropertyForm({ ...propertyForm, galleryUrls: e.target.value })} placeholder="URLs de galeria, una por linea (opcional)" />
          <input value={propertyForm.videoUrl} onChange={(e) => setPropertyForm({ ...propertyForm, videoUrl: e.target.value })} placeholder="URL de video o recorrido virtual (opcional)" />
          <textarea value={propertyForm.observations} onChange={(e) => setPropertyForm({ ...propertyForm, observations: e.target.value })} placeholder="Observaciones generales" />
          <div className="form-grid-2">
            <input value={propertyForm.ownerName} onChange={(e) => setPropertyForm({ ...propertyForm, ownerName: e.target.value })} placeholder="Propietario" />
            <select value={propertyForm.assignedBrokerId} onChange={(e) => setPropertyForm({ ...propertyForm, assignedBrokerId: e.target.value })}>
              <option value="">Sin corredor asignado</option>
              {data.brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
            </select>
          </div>
          <button className="primary-btn" type="submit">Guardar propiedad</button>
        </form>

        <div className="vertical-card realty-assignment-panel">
          <div className="vertical-card-head">
            <div><span>Corredores centralizados</span><h2>Reparto por usuario corredor</h2></div>
            <Link className="secondary-btn" href="/brokers">Gestionar corredores</Link>
          </div>
          <p className="muted-copy">
            La creacion de corredores vive solo en el modulo Corredores. Desde ahi se genera el usuario con acceso limitado al CRM.
          </p>
          <div className="seller-load-grid">
            {data.brokers.map((broker) => (
              <BrokerProfileCard key={broker.id} broker={broker} properties={data.properties} />
            ))}
          </div>
        </div>
      </section>

      <section className="vertical-card">
        <div className="vertical-card-head">
          <div><span>Importacion masiva</span><h2>CSV para IA predictiva</h2></div>
          <label className="secondary-btn">Seleccionar CSV<input type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} /></label>
        </div>
        <p>Sube una base CSV de propiedades para acelerar aprendizaje, forecast y carga operativa.</p>
        <div className="realty-mini-row">
          <strong>{importRows.length} filas detectadas</strong>
          <button className="primary-btn" disabled={!importRows.length} onClick={importProperties}>Importar propiedades</button>
        </div>
      </section>

      <section className="vertical-four">
        <article className="vertical-card"><span>Capacitacion IA</span><h2>Contexto predictivo</h2><p>La importacion deja trazabilidad para entrenar al agente inmobiliario con datos reales.</p></article>
        <article className="vertical-card"><span>Recordatorios</span><h2>Seguimiento comercial</h2><p>Crea alertas por propiedad, corredor o propietario desde el flujo comercial.</p></article>
        <article className="vertical-card"><span>Agenda comercial</span><h2>Visitas y llamados</h2><p>Las visitas se muestran en Agenda y Actividad inmobiliaria.</p></article>
        <article className="vertical-card"><span>Comisiones</span><h2>Control de cierre</h2><p>Registra negocios y calcula participacion por corredor y origen.</p></article>
      </section>
    </>
  );
}

export function RealtyPropertiesPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [selectedProperty, setSelectedProperty] = useState<IndustryRecord | null>(null);
  const [message, setMessage] = useState("");

  async function updateStage(property: IndustryRecord, stage: string) {
    await updateIndustryRecord(property.id, { data: { ...asData(property), stage } });
    await reload();
  }

  async function updateBroker(property: IndustryRecord, brokerId: string) {
    const broker = data.brokers.find((item) => item.id === brokerId);
    await updateIndustryRecord(property.id, {
      assignedToId: brokerId || null,
      data: {
        ...asData(property),
        assignedBrokerId: brokerId,
        assignedBrokerName: broker?.name || "",
        assignmentMode: brokerId ? "manual" : "sin_corredor"
      }
    });
    await reload();
  }

  async function createPropertyCampaign(property: IndustryRecord) {
    try {
      await createRealtyPropertyCampaignDraft(property.id, { platforms: ["instagram", "facebook"] });
      setMessage(`Borrador de campaña creado para ${property.title}. Revísalo en Campañas antes de publicar.`);
    } catch (campaignError) {
      setMessage(campaignError instanceof Error ? campaignError.message : "No se pudo crear el borrador de campaña.");
    }
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Portal inmobiliario"
        title="Propiedades cargadas"
        description="Vista tipo portal para revisar inventario, precios, fotos, responsables y estado comercial."
      />
      <RealtyKpis data={data} />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      {message ? <div className="module-toast">{message}</div> : null}
      <RealtyPredictivePanel data={data} />
      <RealtyIntelligencePanel />
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>Inventario</span><h2>Portal de propiedades</h2></div></div>
        <PropertyPortalCards properties={data.properties} brokers={data.brokers} onStageChange={updateStage} onBrokerChange={updateBroker} onOpen={setSelectedProperty} />
      </section>
      {selectedProperty ? <PropertyDetailModal property={selectedProperty} brokers={data.brokers} onClose={() => setSelectedProperty(null)} onCreateCampaign={createPropertyCampaign} /> : null}
    </>
  );
}

export function RealtyActivityPageContent() {
  const { data, error } = useRealtyWorkspace();
  const active = data.properties.filter((item) => item.status !== "ARCHIVED");

  return (
    <>
      <RealtyHeader
        eyebrow="Actividad inmobiliaria"
        title="Operacion viva inmobiliaria"
        description="Visitas, propietarios, portal corredor, alertas y propiedades activas en una vista ejecutiva."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      <RealtyIntelligencePanel />
      <section className="vertical-four">
        <article className="vertical-card"><span>Visitas</span><h2>{data.visits.length}</h2><p>Agenda comercial y resultados.</p></article>
        <article className="vertical-card"><span>Propietarios</span><h2>{data.owners.length}</h2><p>Base de captacion y seguimiento.</p></article>
        <article className="vertical-card"><span>Portal corredor</span><h2>{data.brokers.length}</h2><p>Corredores con cartera activa.</p></article>
        <article className="vertical-card"><span>Activas</span><h2>{active.length}</h2><p>Propiedades disponibles.</p></article>
      </section>
      <section className="realty-ops-grid">
        <article className="vertical-card">
          <span>Alertas</span>
          <h2>Prioridades comerciales</h2>
          <div className="tgi-record-list">
            {data.alerts.length ? data.alerts.map((alert) => <p key={alert.id}>{alert.title}</p>) : <p>Sin alertas criticas.</p>}
          </div>
        </article>
        <article className="vertical-card">
          <span>Visitas</span>
          <h2>Agenda y resultado</h2>
          <div className="tgi-record-list">
            {data.visits.length ? data.visits.map((visit) => {
              const visitData = asData(visit);
              return <p key={visit.id}><strong>{visit.title}</strong><small>{text(visitData.scheduledAt)} - {text(visitData.address)}</small></p>;
            }) : <p>Sin visitas programadas.</p>}
          </div>
        </article>
      </section>
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>Activas</span><h2>Propiedades en gestion</h2></div></div>
        <PropertyPortalCards properties={active.slice(0, 8)} brokers={data.brokers} />
      </section>
    </>
  );
}

export function BrokerPortalPageContent() {
  const session = getStoredSession();
  const { data, error, reload } = useRealtyWorkspace();
  const [selectedProperty, setSelectedProperty] = useState<IndustryRecord | null>(null);
  const canSeeAll = ["SUPER_ADMIN", "OWNER", "ADMIN"].includes(String(session?.role || "").toUpperCase());
  const visibleProperties = canSeeAll
    ? data.properties
    : data.properties.filter((property) => text(asData(property).assignedBrokerId || property.assignedToId) === session?.id);

  async function createFollowup(property: IndustryRecord) {
    await createIndustryRecord({
      recordType: "broker_followup",
      title: `Seguimiento ${property.title}`,
      status: "OPEN",
      data: { propertyId: property.id, brokerId: session?.id, note: "Seguimiento creado desde portal corredor" }
    });
    await reload();
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Portal corredor"
        title={canSeeAll ? "Cartera completa de corredores" : "Mis propiedades asignadas"}
        description="Seguimiento independiente por corredor, con visibilidad total para jefe de corredores."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>Cartera asignada</span><h2>{visibleProperties.length} propiedades</h2></div></div>
        <div className="property-portal-grid">
          {visibleProperties.map((property) => (
            <div key={property.id} className="broker-property-wrap">
              <PropertyPortalCards properties={[property]} brokers={data.brokers} onOpen={setSelectedProperty} />
              <button className="secondary-btn" onClick={() => createFollowup(property)}>Crear seguimiento</button>
            </div>
          ))}
        </div>
      </section>
      {selectedProperty ? <PropertyDetailModal property={selectedProperty} brokers={data.brokers} onClose={() => setSelectedProperty(null)} /> : null}
    </>
  );
}

export function BrokersPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [brokerForm, setBrokerForm] = useState(emptyBroker);
  const [message, setMessage] = useState("");
  const [deletingBrokerId, setDeletingBrokerId] = useState<string | null>(null);

  async function createBroker(event: FormEvent) {
    event.preventDefault();
    if (!brokerForm.name.trim() || !brokerForm.email.trim() || brokerForm.password.trim().length < 6) {
      setMessage("Ingresa nombre, correo y una contrasena de al menos 6 caracteres.");
      return;
    }
    try {
      setMessage("Creando corredor...");
      await createIndustryBrokerUser({
        name: brokerForm.name,
        email: brokerForm.email,
        password: brokerForm.password,
        phone: brokerForm.phone
      });
      setBrokerForm(emptyBroker);
      setMessage("Corredor creado con acceso limitado al CRM.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo crear el corredor.");
    }
  }

  async function assignProperty(property: IndustryRecord, brokerId: string) {
    const broker = data.brokers.find((item) => item.id === brokerId);
    await updateIndustryRecord(property.id, {
      assignedToId: brokerId || null,
      data: { ...asData(property), assignedBrokerId: brokerId, assignedBrokerName: broker?.name || "", assignmentMode: "manual" }
    });
    await reload();
  }

  async function removeBroker(broker: Broker) {
    const confirmed = window.confirm(`Eliminar a ${broker.name} y desasignar sus propiedades? Esta accion no se puede deshacer.`);
    if (!confirmed) return;
    try {
      setDeletingBrokerId(broker.id);
      const result = await deleteIndustryBrokerUser(broker.id);
      setMessage(`Corredor eliminado. ${result.unassignedProperties} propiedades quedaron disponibles para reasignar.`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo eliminar el corredor.");
    } finally {
      setDeletingBrokerId(null);
    }
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Corredores"
        title="Perfiles y asignacion inmobiliaria"
        description="Crea usuarios corredores con acceso limitado y asigna propiedades manualmente o con reparto balanceado."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      {message ? <div className="module-toast">{message}</div> : null}
      <section className="realty-ops-grid">
        <form className="vertical-card" onSubmit={createBroker}>
          <div className="vertical-card-head"><div><span>Nuevo corredor</span><h2>Perfil comercial</h2></div></div>
          <input value={brokerForm.name} onChange={(e) => setBrokerForm({ ...brokerForm, name: e.target.value })} placeholder="Nombre" />
          <input value={brokerForm.email} onChange={(e) => setBrokerForm({ ...brokerForm, email: e.target.value })} placeholder="Email" />
          <input type="password" value={brokerForm.password} onChange={(e) => setBrokerForm({ ...brokerForm, password: e.target.value })} placeholder="Contrasena inicial" />
          <input value={brokerForm.phone} onChange={(e) => setBrokerForm({ ...brokerForm, phone: e.target.value })} placeholder="Telefono" />
          <button className="primary-btn" type="submit">Crear usuario corredor</button>
        </form>
        <article className="vertical-card">
          <div className="vertical-card-head"><div><span>Equipo</span><h2>Corredores activos</h2></div></div>
          <div className="seller-load-grid">
            {data.brokers.map((broker) => (
              <BrokerProfileCard key={broker.id} broker={broker} properties={data.properties} onDelete={removeBroker} isDeleting={deletingBrokerId === broker.id} />
            ))}
          </div>
        </article>
      </section>
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>Asignacion manual</span><h2>Propiedades sin corredor o reasignables</h2></div></div>
        <div className="tgi-record-list">
          {data.properties.map((property) => (
            <div className="realty-mini-row" key={property.id}>
              <div><strong>{property.title}</strong><small>{getBrokerName(property, data.brokers)}</small></div>
              <select value={text(asData(property).assignedBrokerId || property.assignedToId)} onChange={(event) => assignProperty(property, event.target.value)}>
                <option value="">Sin corredor</option>
                {data.brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function RealtyPipelineBoard({
  properties,
  brokers,
  onStageChange
}: {
  properties: IndustryRecord[];
  brokers: Broker[];
  onStageChange: (property: IndustryRecord, stage: string) => Promise<void> | void;
}) {
  return (
    <section className="vertical-card realty-pipeline-section">
      <div className="vertical-card-head"><div><span>Pipeline inmobiliario</span><h2>Propiedad a postventa</h2></div></div>
      <div className="realty-pipeline">
        {REALTY_STAGES.map((stage) => {
          const items = properties.filter((property) => text(asData(property).stage, "LEAD") === stage.key);
          return (
            <section className="realty-stage-column" key={stage.key}>
              <header><strong>{stage.label}</strong><span>{items.length}</span></header>
              <div className="realty-stage-list">
                {items.length ? items.map((property) => (
                  <article className="realty-stage-card" key={property.id}>
                    <strong>{property.title}</strong>
                    <small>{text(asData(property).address, "Sin direccion")}</small>
                    <span>{money(asData(property).price)}</span>
                    <small>{getBrokerName(property, brokers)}</small>
                    <select value={stage.key} onChange={(event) => onStageChange(property, event.target.value)}>
                      {REALTY_STAGES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                    </select>
                  </article>
                )) : <p>No hay propiedades aqui todavia.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
