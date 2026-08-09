"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createIndustryBrokerUser,
  createRealtyPropertyCampaignDraft,
  createRealtyBuyer,
  getRealtyLeadMatches,
  getRealtyPropertyMatches,
  createIndustryRecord,
  deleteIndustryBrokerUser,
  getRealtyIntelligence,
  getIndustryRecords,
  getLeads,
  getMyModules,
  getIndustryUsers,
  updateIndustryRecord,
  type IndustryRecord,
  type IndustryUser,
  type RealtyIntelligence
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { moduleAllowed, type ModuleAccessKey } from "@/lib/module-access";
import type { Lead } from "@/lib/types";

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
  imports: IndustryRecord[];
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
  imports: [],
  users: [],
  brokers: []
};

const realtySubmodules: ReadonlyArray<{
  label: string;
  href: string;
  moduleKey: ModuleAccessKey;
}> = [
  { label: "Operación", href: "/realty?view=operations", moduleKey: "realty_loads" },
  { label: "Propiedades", href: "/realty?view=properties", moduleKey: "properties" },
  { label: "Corredores", href: "/realty?view=brokers", moduleKey: "brokers" },
  { label: "Actividad", href: "/realty?view=activity", moduleKey: "realty_activity" },
  { label: "Portal corredor", href: "/realty?view=portal", moduleKey: "broker_portal" },
  { label: "Clientes inmobiliarios", href: "/realty?view=buyers", moduleKey: "realty_clients" }
];

// Inmobiliaria se presenta como una sola capacidad en el menú EV. Esta
// navegación secundaria conserva cada función disponible sin repetir seis
// accesos principales para la misma vertical.
export function RealtyModuleNav({ active }: { active: string }) {
  const session = getStoredSession();
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [role, setRole] = useState<string | null>(session?.role || null);

  useEffect(() => {
    let mounted = true;
    getMyModules()
      .then((data) => {
        if (!mounted) return;
        setEnabledModules(data.modules || []);
        setRole((current) => (
          String(current || session?.role || "").toUpperCase() === "SUPER_ADMIN"
            ? "SUPER_ADMIN"
            : (data.role || session?.role || null)
        ));
      })
      // La ruta sigue validada por backend. Mientras el catálogo se recupera,
      // no ocultamos la navegación para evitar que parezca que desaparecieron
      // funciones por un corte momentáneo de red.
      .catch(() => { if (mounted) setEnabledModules(null); });
    return () => { mounted = false; };
  }, []);

  const visibleItems = enabledModules === null
    ? realtySubmodules
    : realtySubmodules.filter((item) => moduleAllowed(item.moduleKey, enabledModules, role, session?.jobTitle, "REAL_ESTATE"));

  return (
    <nav className="realty-module-nav" aria-label="Secciones de Inmobiliaria">
      {visibleItems.length ? <Link href="/realty" className={active === "Inmobiliaria" ? "active" : ""}>Resumen</Link> : null}
      {visibleItems.map((item) => (
        <Link key={item.href} href={item.href} className={item.label === active ? "active" : ""}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

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
      const [properties, owners, visits, deals, alerts, followups, imports, users, brokerProfiles] = await Promise.all([
        getIndustryRecords("property"),
        getIndustryRecords("owner"),
        getIndustryRecords("visit"),
        getIndustryRecords("deal"),
        getIndustryRecords("realty_alert"),
        getIndustryRecords("broker_followup"),
        getIndustryRecords("property_import"),
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

      setData({ properties, owners, visits, deals, alerts, followups, imports, users, brokers: [...userBrokers, ...profileBrokers] });
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
      <div className={`vertical-shell product-workspace realty-product-workspace ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar
          active={active}
          isDeveloper={agent?.role === "SUPER_ADMIN"}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((value) => !value)}
        />
        <main className="vertical-main realty-page realty-workspace">
          <RealtyModuleNav active={active} />
          {children}
        </main>
      </div>
    </ModuleGate>
  );
}

/**
 * Centro de control de la vertical. No duplica módulos del menú EV: desde
 * aquí el usuario ve el estado completo y entra al área puntual que necesita.
 */
export function RealtyDashboardPageContent() {
  const { data, error, loading, reload } = useRealtyWorkspace();
  const [selectedProperty, setSelectedProperty] = useState<IndustryRecord | null>(null);
  const [message, setMessage] = useState("");

  async function updateStage(property: IndustryRecord, stage: string) {
    try {
      await updateIndustryRecord(property.id, { data: { ...asData(property), stage } });
      setMessage(`Etapa actualizada: ${property.title}`);
      await reload();
    } catch (updateError) {
      setMessage(updateError instanceof Error ? updateError.message : "No se pudo actualizar la etapa.");
    }
  }

  const activeProperties = data.properties
    .filter((item) => item.status !== "ARCHIVED")
    .slice(0, 6);
  const upcomingVisits = data.visits
    .filter((item) => item.status !== "DONE")
    .slice(0, 4);
  const unassigned = data.properties.filter((item) => !text(asData(item).assignedBrokerId || item.assignedToId));

  return (
    <>
      <RealtyHeader
        eyebrow="Centro de control inmobiliario"
        title="Portafolio, equipo y oportunidades en movimiento"
        description="Controla inventario, captación, corredores, visitas, clientes compradores y oportunidades de cierre desde un solo workspace."
        actions={<Link className="primary-btn" href="/realty?view=operations">Nueva propiedad</Link>}
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      {message ? <div className="module-toast">{message}</div> : null}
      <section className="realty-ws-hero">
        <article className="realty-ws-intro">
          <span>Workspace operativo</span>
          <h2>Tu cartera, tu equipo y las siguientes acciones en un solo lugar.</h2>
          <p>Visualiza qué propiedad mover, qué cliente atender y qué corredor necesita apoyo sin salir de tu contexto operativo.</p>
          <div className="realty-ws-actions"><Link className="primary-btn" href="/realty?view=operations">Nueva propiedad</Link><Link className="secondary-btn" href="/realty?view=activity">Ver agenda de visitas</Link></div>
        </article>
        <aside className="realty-ws-kpis">
          <article><span>Propiedades activas</span><strong>{data.properties.filter((item) => item.status !== "ARCHIVED").length}</strong><small>{unassigned.length} sin asignar</small></article>
          <article><span>Valor de cartera</span><strong>{money(data.properties.reduce((sum, item) => sum + numberValue(asData(item).price), 0))}</strong><small>inventario cargado</small></article>
          <article><span>Visitas esta semana</span><strong>{upcomingVisits.length}</strong><small>requieren seguimiento</small></article>
          <article><span>Oportunidades IA</span><strong>{unassigned.length + data.alerts.length}</strong><small>alertas y asignaciones</small></article>
        </aside>
      </section>

      <section className="realty-ws-card">
        <div className="realty-ws-card-head"><div><span>Propiedades activas</span><h2>Portafolio en movimiento</h2><p>Vista visual para reconocer rápidamente cada propiedad y entrar a su ficha.</p></div><Link href="/realty?view=properties">Ver cartera completa</Link></div>
        {loading ? <p className="empty-state">Cargando propiedades...</p> : <PropertyPortalCards properties={activeProperties} brokers={data.brokers} onStageChange={updateStage} onOpen={setSelectedProperty} />}
      </section>

      <section className="realty-ws-two-columns">
        <article className="realty-ws-card">
          <div className="realty-ws-card-head"><div><span>Cartera activa</span><h2>Propiedades que requieren atención</h2><p>Prioriza según etapa, visitas, interés y tiempo sin movimiento.</p></div><Link href="/realty?view=properties">Ver todas</Link></div>
          <div className="realty-ws-table">
            <div className="realty-ws-row realty-ws-row-head"><span>Propiedad</span><span>Etapa</span><span>Corredor</span><span>Estado</span></div>
            {data.properties.slice(0, 5).map((property) => <button type="button" className="realty-ws-row" key={property.id} onClick={() => setSelectedProperty(property)}><strong>{property.title}</strong><span>{REALTY_STAGES.find((stage) => stage.key === text(asData(property).stage, "LEAD"))?.label || "Lead"}</span><span>{getBrokerName(property, data.brokers)}</span><b>{numberValue(asData(property).price) ? "Ficha completa" : "Completar ficha"}</b></button>)}
            {!data.properties.length ? <p className="empty-state">Aún no hay propiedades para revisar.</p> : null}
          </div>
          <footer className="realty-ws-statbar"><span><b>{unassigned.length}</b> registros pendientes</span><span><b>{data.visits.length}</b> visitas registradas</span><span><b>{data.properties.length ? Math.round((data.properties.filter((item) => numberValue(asData(item).price)).length / data.properties.length) * 100) : 0}%</b> fichas con precio</span></footer>
        </article>
        <aside className="realty-ws-card realty-ws-ia-card">
          <div className="realty-ws-card-head"><div><span>Recomendado por IA</span><h2>Prioridades comerciales</h2></div><Link href="/realty?view=buyers">Abrir matching</Link></div>
          <div className="realty-ws-suggestions">
            <Link href="/realty?view=brokers"><strong>{unassigned.length ? `${unassigned.length} propiedades sin corredor` : "Cartera asignada"}</strong><p>{unassigned.length ? "Distribuye las propiedades disponibles para no perder oportunidades comerciales." : "Todas las propiedades tienen un responsable comercial."}</p><small>Asignación de cartera →</small></Link>
            <Link href="/realty?view=buyers"><strong>Compradores compatibles</strong><p>Usa presupuesto, comuna y tipo de propiedad para mostrar opciones relevantes.</p><small>Ver coincidencias →</small></Link>
            <Link href="/realty?view=activity"><strong>{upcomingVisits.length} visitas en seguimiento</strong><p>Confirma agenda y registra el resultado de cada contacto comercial.</p><small>Revisar actividad →</small></Link>
          </div>
        </aside>
      </section>

      <section className="realty-ws-shortcuts">
        <Link href="/realty?view=operations"><span>Carga y captación</span><strong>Registrar propiedad o importar archivo</strong></Link>
        <Link href="/realty?view=brokers"><span>Equipo comercial</span><strong>Gestionar corredores y reparto</strong></Link>
        <Link href="/realty?view=buyers"><span>Clientes compradores</span><strong>Crear perfil y encontrar coincidencias</strong></Link>
        <Link href="/realty?view=portal"><span>Portal corredor</span><strong>Revisar cartera y seguimientos</strong></Link>
      </section>
      {selectedProperty ? <PropertyDetailModal property={selectedProperty} brokers={data.brokers} onClose={() => setSelectedProperty(null)} /> : null}
    </>
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

type RealtyBuyerForm = {
  name: string;
  phone: string;
  email: string;
  budget: string;
  commune: string;
  propertyType: string;
  interest: string;
};

const emptyRealtyBuyerForm: RealtyBuyerForm = {
  name: "", phone: "", email: "", budget: "", commune: "", propertyType: "", interest: "COMPRA"
};

function buyerMoney(value?: number | null) {
  return value ? money(value) : "Sin presupuesto";
}

/** Submódulo autónomo de compradores dentro de la vertical inmobiliaria. */
export function RealtyBuyersPageContent() {
  const [buyers, setBuyers] = useState<Lead[]>([]);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Array<{ score: number; reasons: string[]; property: { id: string; title: string; status: string; price: number; commune: string; operation: string } }>>([]);
  const [form, setForm] = useState<RealtyBuyerForm>(emptyRealtyBuyerForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadBuyers(preselected?: string) {
    try {
      setLoading(true);
      const result = await getLeads();
      const active = result.filter((buyer) => !["WON", "LOST", "ARCHIVED"].includes(String(buyer.status || "").toUpperCase()));
      setBuyers(active);
      if (preselected) setSelectedBuyerId(preselected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los compradores.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBuyers(); }, []);
  useEffect(() => {
    if (!selectedBuyerId) { setMatches([]); return; }
    getRealtyLeadMatches(selectedBuyerId)
      .then((result) => setMatches(result.matches || []))
      .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo calcular el matching."));
  }, [selectedBuyerId]);

  async function saveBuyer(event: FormEvent) {
    event.preventDefault();
    const budget = numberValue(form.budget);
    if (!form.name.trim() || !budget) { setMessage("Indica el nombre y un presupuesto para recomendar propiedades."); return; }
    try {
      setSaving(true);
      const result = await createRealtyBuyer({ ...form, name: form.name.trim(), budget });
      setForm(emptyRealtyBuyerForm);
      setMessage("Comprador guardado. Las coincidencias ya están disponibles.");
      await loadBuyers(result.buyer.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el comprador.");
    } finally { setSaving(false); }
  }

  const selected = buyers.find((buyer) => buyer.id === selectedBuyerId);
  return <>
    <RealtyHeader eyebrow="Clientes compradores" title="Matching comercial inmobiliario" description="Registra presupuesto, comuna y tipo de propiedad para recomendar alternativas compatibles." />
    {message ? <div className="module-toast">{message}</div> : null}
    <section className="realty-buyer-workspace">
      <form className="realty-buyer-form" onSubmit={saveBuyer}>
        <div><span>Nuevo comprador</span><h2>¿Qué propiedad está buscando?</h2><p>EVOLUM comparará automáticamente propiedades disponibles de esta cartera.</p></div>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre del comprador" />
        <div className="vertical-two"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" /><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Correo" /></div>
        <div className="vertical-two"><input type="number" min="1" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} placeholder="Presupuesto en CLP" /><input value={form.commune} onChange={(event) => setForm({ ...form, commune: event.target.value })} placeholder="Comuna de interés" /></div>
        <div className="vertical-two"><select value={form.propertyType} onChange={(event) => setForm({ ...form, propertyType: event.target.value })}><option value="">Tipo de propiedad</option><option value="DEPARTAMENTO">Departamento</option><option value="CASA">Casa</option><option value="OFICINA">Oficina</option><option value="TERRENO">Terreno</option></select><select value={form.interest} onChange={(event) => setForm({ ...form, interest: event.target.value })}><option value="COMPRA">Compra</option><option value="ARRIENDO">Arriendo</option></select></div>
        <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar y recomendar"}</button>
      </form>
      <section className="realty-buyer-results">
        <div className="vertical-card-head"><div><span>Compradores activos</span><h2>Clientes y preferencias</h2></div></div>
        <div className="realty-buyer-layout">
          <div className="realty-buyer-list">{loading ? <p>Cargando compradores...</p> : null}{!loading && !buyers.length ? <p>Aún no hay compradores registrados.</p> : null}{buyers.map((buyer) => <button type="button" key={buyer.id} className={`realty-buyer-item ${buyer.id === selectedBuyerId ? "is-selected" : ""}`} onClick={() => setSelectedBuyerId(buyer.id)}><strong>{buyer.name || "Comprador sin nombre"}</strong><span>{buyerMoney(buyer.budget)} · {buyer.commune || "Comuna por definir"}</span><small>{buyer.propertyType || "Tipo por definir"} · {buyer.interest || "Compra"}</small></button>)}</div>
          <div className="realty-match-panel">{!selected ? <p>Selecciona un comprador para ver propiedades compatibles.</p> : <><div className="realty-match-heading"><div><span>Para {selected.name || "este comprador"}</span><h3>Propiedades recomendadas</h3></div><strong>{buyerMoney(selected.budget)}</strong></div>{!matches.length ? <p>Aún no hay una propiedad disponible que calce con los datos registrados.</p> : <div className="realty-property-match-list">{matches.map((match) => <article className="realty-property-match" key={match.property.id}><div><strong>{match.property.title}</strong><span>{buyerMoney(match.property.price)} · {match.property.commune || "Comuna por definir"}</span><small>{match.reasons.join(" · ")}</small></div><b>{match.score}% compatible</b></article>)}</div>}</>}</div>
        </div>
      </section>
    </section>
  </>;
}

export function PropertyDetailModal({
  property,
  brokers,
  onClose,
  onCreateCampaign,
  onRemovePhoto
}: {
  property: IndustryRecord;
  brokers: Broker[];
  onClose: () => void;
  onCreateCampaign?: (property: IndustryRecord) => Promise<void> | void;
  onRemovePhoto?: (property: IndustryRecord, photo: string) => Promise<void> | void;
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
                {photos.map((photo, index) => <div className="property-thumbnail-wrap" key={photo}>
                  <button type="button" className={index === activePhoto ? "active" : ""} onClick={() => setActivePhoto(index)}><img src={photo} alt={`${property.title} foto ${index + 1}`} /></button>
                  {onRemovePhoto ? <button type="button" className="property-thumbnail-remove" onClick={() => onRemovePhoto(property, photo)}>Quitar</button> : null}
                </div>)}
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

  function clearPendingPhotos() {
    setPropertyForm((current) => ({ ...current, photoUrl: "", galleryUrls: "" }));
    setMessage("Fotos quitadas de la ficha antes de guardarla.");
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

  function downloadTemplate() {
    const content = "Nombre,Tipo,Operacion,Precio,Direccion,Comuna,Piezas,Banos,Estacionamientos,M2,Material,Observaciones\nDepartamento ejemplo,Departamento,Venta,148000000,Av. Ejemplo 123,Nunoa,2,2,1,74,Hormigon,Ficha de ejemplo";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "plantilla-propiedades-evolum.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Rubro inmobiliario"
        title="Cargas inmobiliarias"
        description="Creacion, importacion, capacitacion, corredores, recordatorios, agenda comercial y comisiones."
        actions={<button className="secondary-btn" onClick={autoAssign}>Asignar automatico</button>}
      />
      {message ? <div className="module-toast">{message}</div> : null}
      {error ? <div className="sales-queue-error">{error}</div> : null}

      <section className="realty-ws-operation-layout">
        <form className="realty-ws-card realty-property-form" onSubmit={createProperty}>
          <div className="realty-ws-card-head"><div><span>Ingreso rápido</span><h2>Nueva propiedad</h2><p>Registra los datos esenciales; fotos y detalle quedan asociados a la ficha completa.</p></div></div>
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
            {(propertyForm.photoUrl || propertyForm.galleryUrls) ? <button type="button" className="ghost-btn danger" onClick={clearPendingPhotos}>Quitar fotos</button> : null}
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

        <aside className="realty-ws-card realty-import-assistant">
          <div className="realty-ws-card-head">
            <div><span>Asistente de carga</span><h2>Antes de publicar</h2><p>Revisa el archivo y la asignación antes de afectar tu inventario.</p></div>
          </div>
          <label className="realty-dropzone"><b>↑</b><strong>Carga propiedades desde CSV</strong><small>Selecciona un archivo y EVOLUM detectará sus columnas.</small><input type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} /></label>
          <div className="realty-import-steps"><div><b>1</b><span><strong>Selecciona tu archivo</strong><small>CSV de propiedades o base de captación.</small></span></div><div><b>2</b><span><strong>Revisa la vista previa</strong><small>{importRows.length ? `${importRows.length} filas detectadas` : "Aún no hay filas cargadas."}</small></span></div><div><b>3</b><span><strong>Confirma el destino</strong><small>Importa como inventario activo y trazable.</small></span></div></div>
          <div className="realty-import-actions"><button className="primary-btn" type="button" disabled={!importRows.length} onClick={importProperties}>Importar {importRows.length || ""} propiedades</button><button className="secondary-btn" type="button" onClick={autoAssign}>Asignar automáticamente</button></div>
          <div className="realty-assignment-summary"><strong>{data.brokers.length} corredores activos</strong><span>{data.properties.filter((item) => !text(asData(item).assignedBrokerId || item.assignedToId)).length} propiedades sin responsable</span><Link href="/realty?view=brokers">Gestionar reparto →</Link></div>
          <button className="secondary-btn realty-template-btn" type="button" onClick={downloadTemplate}>Descargar plantilla CSV</button>
        </aside>
      </section>

      <section className="realty-ws-card realty-import-history">
        <div className="realty-ws-card-head">
          <div><span>Últimas cargas</span><h2>Historial de importaciones</h2><p>Todo cambio queda trazable y se puede revisar antes de afectar el inventario.</p></div>
          <label className="secondary-btn">Seleccionar CSV<input type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} /></label>
        </div>
        <div className="realty-ws-table">
          <div className="realty-ws-row realty-ws-row-head"><span>Archivo o lote</span><span>Origen</span><span>Resultado</span><span>Estado</span></div>
          {data.imports.slice(0, 5).map((item) => <div key={item.id} className="realty-ws-row"><strong>{item.title}</strong><span>{text(asData(item).source, "CSV")}</span><span>{asData(item).row ? "Filas normalizadas" : "Registro importado"}</span><b>{item.status}</b></div>)}
          {!data.imports.length ? <p className="empty-state">Aún no hay importaciones registradas. Selecciona un CSV para comenzar.</p> : null}
        </div>
      </section>

      <section className="realty-ws-service-strip">
        <article><span>Capacitación IA</span><strong>Contexto predictivo</strong><small>La carga conserva trazabilidad para análisis de cartera.</small></article>
        <article><span>Recordatorios</span><strong>Seguimiento comercial</strong><small>Gestiona alertas por propiedad y corredor.</small></article>
        <article><span>Agenda comercial</span><strong>Visitas y llamados</strong><small>Las visitas se reflejan en Actividad y Agenda.</small></article>
        <article><span>Comisiones</span><strong>Control de cierre</strong><small>Registra negocios y participación por corredor.</small></article>
      </section>
    </>
  );
}

export function RealtyPropertiesPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [selectedProperty, setSelectedProperty] = useState<IndustryRecord | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "VENTA" | "ARRIENDO" | "UNASSIGNED" | "VISITED" | "STALE">("ALL");

  const visibleProperties = data.properties.filter((property) => {
    const propertyData = asData(property);
    const searchable = `${property.title} ${text(propertyData.address)} ${text(propertyData.comuna)} ${text(propertyData.operation)}`.toLowerCase();
    const matchesQuery = !query.trim() || searchable.includes(query.trim().toLowerCase());
    const operation = text(propertyData.operation).toUpperCase();
    const hasVisit = data.visits.some((visit) => text(asData(visit).propertyId) === property.id);
    const hasActivity = hasVisit || data.followups.some((followup) => text(asData(followup).propertyId) === property.id);
    const matchesFilter = filter === "ALL"
      || (filter === "UNASSIGNED" && !text(propertyData.assignedBrokerId || property.assignedToId))
      || (filter === "VISITED" && hasVisit)
      || (filter === "STALE" && !hasActivity)
      || operation === filter;
    return matchesQuery && matchesFilter;
  });

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

  async function removePropertyPhoto(property: IndustryRecord, photo: string) {
    if (!window.confirm("Quitar esta imagen de la propiedad? La ficha y sus demás datos se mantienen.")) return;
    try {
      const metadata = asData(property);
      const remaining = propertyPhotos(metadata).filter((item) => item !== photo);
      const updated = await updateIndustryRecord(property.id, {
        data: { ...metadata, photoUrl: remaining[0] || "", gallery: remaining, galleryUrls: remaining }
      });
      setSelectedProperty(updated);
      setMessage("Imagen eliminada de la propiedad.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar la imagen.");
    }
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Portal inmobiliario"
        title="Propiedades activas"
        description="Consulta, filtra y entra a la ficha completa sin perder el contexto de la cartera."
        actions={<Link className="primary-btn" href="/realty?view=operations">Nueva propiedad</Link>}
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      {message ? <div className="module-toast">{message}</div> : null}
      <section className="realty-ws-card realty-inventory-panel">
        <div className="realty-ws-card-head"><div><span>Inventario operativo</span><h2>Propiedades activas</h2><p>Revisa inventario, responsable, etapa comercial y ficha detallada.</p></div><Link className="secondary-btn" href="/realty?view=operations">Importar CSV</Link></div>
        <div className="realty-inventory-filters">
          <div className="realty-filter-chips">
            {(["ALL", "VENTA", "ARRIENDO", "UNASSIGNED"] as const).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "ALL" ? `Todas · ${data.properties.length}` : value === "UNASSIGNED" ? `Sin corredor · ${data.properties.filter((property) => !text(asData(property).assignedBrokerId || property.assignedToId)).length}` : `${value[0]}${value.slice(1).toLowerCase()}`}</button>)}
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por propiedad, comuna u operación" aria-label="Buscar propiedad" />
        </div>
        <div className="realty-filter-chips realty-filter-extra">
          <button type="button" className={filter === "VISITED" ? "active" : ""} onClick={() => setFilter("VISITED")}>Con visita ({data.properties.filter((property) => data.visits.some((visit) => text(asData(visit).propertyId) === property.id)).length})</button>
          <button type="button" className={filter === "STALE" ? "active" : ""} onClick={() => setFilter("STALE")}>Sin actividad ({data.properties.filter((property) => !data.visits.some((visit) => text(asData(visit).propertyId) === property.id) && !data.followups.some((followup) => text(asData(followup).propertyId) === property.id)).length})</button>
        </div>
        <PropertyPortalCards properties={visibleProperties} brokers={data.brokers} onStageChange={updateStage} onBrokerChange={updateBroker} onOpen={setSelectedProperty} />
        <div className="realty-ws-table realty-inventory-table">
          <div className="realty-ws-row realty-ws-row-head"><span>Propiedad</span><span>Operación</span><span>Precio</span><span>Estado</span></div>
          {visibleProperties.slice(0, 12).map((property) => <button type="button" className="realty-ws-row" key={`${property.id}-row`} onClick={() => setSelectedProperty(property)}><strong>{property.title}</strong><span>{text(asData(property).operation, "Disponible")}</span><span>{money(asData(property).price)}</span><b>{REALTY_STAGES.find((stage) => stage.key === text(asData(property).stage, "LEAD"))?.label || "Lead"}</b></button>)}
        </div>
      </section>
      <RealtyPredictivePanel data={data} />
      {selectedProperty ? <PropertyDetailModal property={selectedProperty} brokers={data.brokers} onClose={() => setSelectedProperty(null)} onCreateCampaign={createPropertyCampaign} onRemovePhoto={removePropertyPhoto} /> : null}
    </>
  );
}

export function RealtyActivityPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const active = data.properties.filter((item) => item.status !== "ARCHIVED");
  const [visitTitle, setVisitTitle] = useState("");
  const [visitPropertyId, setVisitPropertyId] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [alertTitle, setAlertTitle] = useState("");
  const [message, setMessage] = useState("");

  async function createVisit(event: FormEvent) {
    event.preventDefault();
    const property = data.properties.find((item) => item.id === visitPropertyId);
    if (!visitTitle.trim() || !property) {
      setMessage("Indica la propiedad y el nombre de la visita.");
      return;
    }
    try {
      await createIndustryRecord({
        recordType: "visit",
        title: visitTitle.trim(),
        status: "SCHEDULED",
        data: {
          propertyId: property.id,
          propertyTitle: property.title,
          address: text(asData(property).address),
          scheduledAt: visitDate || null
        }
      });
      setVisitTitle("");
      setVisitPropertyId("");
      setVisitDate("");
      setMessage("Visita agendada y disponible en la actividad comercial.");
      await reload();
    } catch (createError) {
      setMessage(createError instanceof Error ? createError.message : "No se pudo guardar la visita.");
    }
  }

  async function createAlert(event: FormEvent) {
    event.preventDefault();
    if (!alertTitle.trim()) return;
    try {
      await createIndustryRecord({
        recordType: "realty_alert",
        title: alertTitle.trim(),
        status: "OPEN",
        data: { source: "realty_activity", createdFrom: "alerta manual" }
      });
      setAlertTitle("");
      setMessage("Alerta inmobiliaria creada.");
      await reload();
    } catch (createError) {
      setMessage(createError instanceof Error ? createError.message : "No se pudo crear la alerta.");
    }
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Actividad inmobiliaria"
        title="Actividad y seguimiento"
        description="Visitas, alertas y movimientos comerciales organizados por prioridad y sin perder el contexto de cada propiedad."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      {message ? <div className="module-toast">{message}</div> : null}
      <section className="realty-ws-activity-summary">
        <article><span>Visitas próximas</span><strong>{data.visits.length}</strong><small>Agenda comercial activa</small></article>
        <article><span>Alertas abiertas</span><strong>{data.alerts.length}</strong><small>Acciones que requieren revisión</small></article>
        <article><span>Propiedades activas</span><strong>{active.length}</strong><small>Disponibles en cartera</small></article>
        <article><span>Equipo comercial</span><strong>{data.brokers.length}</strong><small>Corredores para asignación</small></article>
      </section>

      <section className="realty-ws-activity-layout">
        <article className="realty-ws-card realty-activity-timeline">
          <div className="realty-ws-card-head"><div><span>Agenda comercial</span><h2>Visitas y próximos movimientos</h2><p>Registra una visita y deja trazable su propiedad, fecha y motivo.</p></div></div>
          <form className="realty-activity-form" onSubmit={createVisit}>
            <input value={visitTitle} onChange={(event) => setVisitTitle(event.target.value)} placeholder="Ej: Visita con comprador interesado" />
            <select value={visitPropertyId} onChange={(event) => setVisitPropertyId(event.target.value)}>
              <option value="">Selecciona una propiedad</option>
              {data.properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}
            </select>
            <input type="datetime-local" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} aria-label="Fecha y hora de visita" />
            <button type="submit" className="primary-btn">Agendar visita</button>
          </form>
          <div className="realty-activity-list">
            {data.visits.length ? data.visits.slice(0, 8).map((visit) => {
              const visitData = asData(visit);
              return <article key={visit.id}><b>Visita</b><div><strong>{visit.title}</strong><span>{text(visitData.propertyTitle, "Propiedad sin identificar")}</span><small>{text(visitData.scheduledAt, "Fecha por confirmar")} {visitData.address ? `· ${text(visitData.address)}` : ""}</small></div></article>;
            }) : <p className="empty-state">No hay visitas programadas. Crea la primera desde esta misma vista.</p>}
          </div>
        </article>

        <aside className="realty-ws-card realty-activity-priorities">
          <div className="realty-ws-card-head"><div><span>Prioridades</span><h2>Alertas comerciales</h2><p>Convierte pendientes en acciones concretas para el equipo.</p></div></div>
          <div className="realty-activity-map"><span>Mapa operativo</span><strong>{data.visits.length} visitas registradas</strong><small>Actividad por zona, corredor y semana.</small><i>Ñuñoa · Providencia · La Reina</i></div>
          <form className="realty-alert-form" onSubmit={createAlert}>
            <input value={alertTitle} onChange={(event) => setAlertTitle(event.target.value)} placeholder="Ej: confirmar precio antes de publicar" />
            <button type="submit" className="secondary-btn">Crear alerta</button>
          </form>
          <div className="realty-alert-list">
            {data.alerts.length ? data.alerts.slice(0, 6).map((alert) => <article key={alert.id}><span>Prioridad</span><strong>{alert.title}</strong><small>{alert.status === "OPEN" ? "Pendiente de gestión" : alert.status}</small></article>) : <p className="empty-state">La cartera no tiene alertas críticas por ahora.</p>}
          </div>
          <Link className="secondary-btn" href="/realty?view=properties">Revisar propiedades activas</Link>
        </aside>
      </section>

      <section className="realty-ws-card realty-activity-property-strip">
        <div className="realty-ws-card-head"><div><span>Movimiento de cartera</span><h2>Propiedades que requieren seguimiento</h2><p>La actividad se organiza por propiedad y responsable para que el equipo sepa qué sigue.</p></div><Link href="/realty?view=brokers">Gestionar reparto</Link></div>
        <PropertyPortalCards properties={active.slice(0, 6)} brokers={data.brokers} />
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

  async function togglePortalOption(option: "portalVisible" | "allowWhatsAppShare" | "showPublicPrice" | "approvalRequired") {
    if (!featuredProperty) return;
    try {
      const currentData = asData(featuredProperty);
      const updated = await updateIndustryRecord(featuredProperty.id, {
        data: { ...currentData, [option]: !Boolean(currentData[option]) }
      });
      setSelectedProperty(updated);
      await reload();
    } catch {
      // La interfaz conserva el estado previo si la actualización no se puede guardar.
    }
  }

  const featuredProperty = selectedProperty || visibleProperties[0] || null;
  const featuredData = featuredProperty ? asData(featuredProperty) : {};

  return (
    <>
      <RealtyHeader
        eyebrow="Portal corredor"
        title={canSeeAll ? "Cartera completa de corredores" : "Mis propiedades asignadas"}
        description="Seguimiento independiente por corredor, con visibilidad total para jefe de corredores."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      <section className="realty-ws-portal-layout">
        <article className="realty-ws-card realty-portal-featured">
          <div className="realty-ws-card-head"><div><span>Ficha seleccionada</span><h2>{featuredProperty?.title || "Selecciona una propiedad"}</h2><p>{featuredProperty ? `${text(featuredData.address, "Dirección por confirmar")} · ${money(featuredData.price)}` : "Tu cartera publicada aparecerá aquí."}</p></div></div>
          {featuredProperty ? <>
            <div className="realty-portal-preview"><div className="realty-portal-preview-media">PORTAL<br />CORREDOR</div><div><span>{text(featuredData.operation, "Disponible")}</span><strong>{featuredProperty.title}</strong><p>{text(featuredData.address, "Dirección por confirmar")}</p><b>{money(featuredData.price)}</b></div></div>
            <div className="realty-portal-controls"><button type="button" className="primary-btn" onClick={() => createFollowup(featuredProperty)}>Crear seguimiento</button><button type="button" className="secondary-btn" onClick={() => setSelectedProperty(featuredProperty)}>Abrir ficha completa</button></div>
          </> : <p className="empty-state">Aún no hay propiedades asignadas a este portal.</p>}
        </article>
        <aside className="realty-ws-card realty-portal-steps">
          <div className="realty-ws-card-head"><div><span>Publicación</span><h2>Canales y permisos</h2><p>Define qué puede ver y compartir el corredor para la ficha seleccionada.</p></div></div>
          <div className="realty-portal-switches">
            {[
              ["portalVisible", "Visible en portal corredor"],
              ["allowWhatsAppShare", "Permitir compartir por WhatsApp"],
              ["showPublicPrice", "Mostrar precio de publicación"],
              ["approvalRequired", "Solicitar aprobación antes de publicar"]
            ].map(([option, label]) => <button type="button" key={option} className={`realty-portal-switch ${Boolean(featuredData[option]) ? "is-on" : ""}`} onClick={() => togglePortalOption(option as "portalVisible" | "allowWhatsAppShare" | "showPublicPrice" | "approvalRequired")}><span>{label}</span><i aria-hidden="true" /></button>)}
          </div>
          <Link href="/realty?view=activity" className="secondary-btn">Abrir actividad</Link>
        </aside>
      </section>
      <section className="realty-ws-card realty-portal-table">
        <div className="realty-ws-card-head"><div><span>Cartera asignada</span><h2>{visibleProperties.length} propiedades disponibles</h2><p>Selecciona una fila para trabajar la ficha en el panel superior.</p></div></div>
        <div className="realty-ws-table"><div className="realty-ws-row realty-ws-row-head"><span>Propiedad</span><span>Operación</span><span>Corredor</span><span>Estado</span></div>{visibleProperties.map((property) => <button type="button" className="realty-ws-row" key={property.id} onClick={() => setSelectedProperty(property)}><strong>{property.title}</strong><span>{text(asData(property).operation, "Disponible")}</span><span>{getBrokerName(property, data.brokers)}</span><b>{text(asData(property).stage, "LEAD")}</b></button>)}{!visibleProperties.length ? <p className="empty-state">No hay propiedades para mostrar todavía.</p> : null}</div>
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

  async function autoAssignUnassigned() {
    if (!data.brokers.length) {
      setMessage("Crea al menos un corredor antes de usar el reparto automático.");
      return;
    }
    const unassigned = data.properties.filter((property) => !text(asData(property).assignedBrokerId || property.assignedToId));
    if (!unassigned.length) {
      setMessage("No hay propiedades sin responsable para repartir.");
      return;
    }
    try {
      setMessage("Calculando reparto equilibrado...");
      await Promise.all(unassigned.map((property, index) => {
        const broker = data.brokers[index % data.brokers.length];
        return updateIndustryRecord(property.id, {
          assignedToId: broker.id,
          data: { ...asData(property), assignedBrokerId: broker.id, assignedBrokerName: broker.name, assignmentMode: "automatico" }
        });
      }));
      setMessage(`${unassigned.length} propiedades fueron asignadas automáticamente.`);
      await reload();
    } catch (assignError) {
      setMessage(assignError instanceof Error ? assignError.message : "No se pudo completar el reparto automático.");
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
      <section className="realty-ws-brokers-layout">
        <article className="realty-ws-card realty-team-panel">
          <div className="realty-ws-card-head"><div><span>Equipo comercial</span><h2>Corredores activos</h2><p>Revisa carga de trabajo y abre cada cartera desde una sola vista.</p></div></div>
          <div className="seller-load-grid">
            {data.brokers.map((broker) => (
              <BrokerProfileCard key={broker.id} broker={broker} properties={data.properties} onDelete={removeBroker} isDeleting={deletingBrokerId === broker.id} />
            ))}
            {!data.brokers.length ? <p className="empty-state">Aún no hay corredores creados.</p> : null}
          </div>
        </article>
        <form className="realty-ws-card realty-broker-form" onSubmit={createBroker}>
          <div className="realty-ws-card-head"><div><span>Nuevo corredor</span><h2>Perfil comercial</h2><p>Crea un usuario con acceso limitado a su cartera asignada.</p></div></div>
          <input value={brokerForm.name} onChange={(e) => setBrokerForm({ ...brokerForm, name: e.target.value })} placeholder="Nombre" />
          <input value={brokerForm.email} onChange={(e) => setBrokerForm({ ...brokerForm, email: e.target.value })} placeholder="Email" />
          <input type="password" value={brokerForm.password} onChange={(e) => setBrokerForm({ ...brokerForm, password: e.target.value })} placeholder="Contrasena inicial" />
          <input value={brokerForm.phone} onChange={(e) => setBrokerForm({ ...brokerForm, phone: e.target.value })} placeholder="Telefono" />
          <button className="primary-btn" type="submit">Crear usuario corredor</button>
        </form>
      </section>
      <section className="realty-ws-two-columns realty-broker-distribution">
      <article className="realty-ws-card realty-assignment-table">
        <div className="realty-ws-card-head"><div><span>Reparto de cartera</span><h2>Propiedades sin responsable o reasignables</h2><p>Asigna manualmente o deja que la distribución automática proponga el siguiente corredor.</p></div></div>
        <div className="realty-ws-table">
          <div className="realty-ws-row realty-ws-row-head"><span>Propiedad</span><span>Etapa</span><span>Corredor</span><span>Acción</span></div>
          {data.properties.filter((property) => !text(asData(property).assignedBrokerId || property.assignedToId)).map((property) => (
            <div className="realty-ws-row" key={property.id}>
              <strong>{property.title}</strong>
              <span>{REALTY_STAGES.find((stage) => stage.key === text(asData(property).stage, "LEAD"))?.label || "Lead"}</span>
              <span>{getBrokerName(property, data.brokers)}</span>
              <select value={text(asData(property).assignedBrokerId || property.assignedToId)} onChange={(event) => assignProperty(property, event.target.value)}>
                <option value="">Sin corredor</option>
                {data.brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
              </select>
            </div>
          ))}
          {!data.properties.some((property) => !text(asData(property).assignedBrokerId || property.assignedToId)) ? <p className="empty-state">Todas las propiedades activas tienen un corredor asignado.</p> : null}
        </div>
      </article>
      <aside className="realty-ws-card realty-broker-recommendation">
        <div className="realty-ws-card-head"><div><span>Lectura IA</span><h2>Recomendación de reparto</h2><p>El sistema propone una distribución equilibrada según la cartera actual.</p></div></div>
        <div className="realty-broker-recommendation-copy"><strong>{data.brokers[0]?.name || "Tu equipo"}</strong><p>{data.brokers.length ? `${data.brokers[0].name} puede recibir el próximo registro según el reparto actual.` : "Crea corredores para que EVOLUM sugiera el mejor responsable."}</p><small>Impacto estimado: alto</small></div>
        <button type="button" className="primary-btn" onClick={autoAssignUnassigned}>Aplicar reparto automático</button>
      </aside>
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
