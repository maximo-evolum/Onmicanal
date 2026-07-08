"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createIndustryRecord,
  getIndustryRecords,
  getIndustryUsers,
  updateIndustryRecord,
  type IndustryRecord,
  type IndustryUser
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
  observations: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  assignedBrokerId: "",
  stage: "LEAD"
};

const emptyBroker = {
  name: "",
  email: "",
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

function BrokerProfileCard({ broker, properties }: { broker: Broker; properties: IndustryRecord[] }) {
  const assigned = assignedPropertyCount(properties, broker.id);
  return (
    <article className="broker-profile-card">
      <div className="broker-profile-avatar">{initials(broker.name)}</div>
      <div className="broker-profile-body">
        <strong>{broker.name || "Corredor"}</strong>
        <span>{broker.email || broker.role || "Corredor"}</span>
        <small>{assigned} {assigned === 1 ? "propiedad asignada" : "propiedades asignadas"}</small>
      </div>
    </article>
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

      const userBrokers = users
        .filter((user) => ["SELLER", "ADMIN", "OWNER"].includes(String(user.role || "").toUpperCase()))
        .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role }));
      const profileBrokers = brokerProfiles.map((record) => {
        const recordData = asData(record);
        return {
          id: record.id,
          name: record.title,
          email: text(recordData.email),
          role: text(recordData.role, "Corredor"),
          isProfile: true
        };
      });

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
  onStageChange
}: {
  properties: IndustryRecord[];
  brokers: Broker[];
  onStageChange?: (property: IndustryRecord, stage: string) => Promise<void> | void;
}) {
  if (!properties.length) {
    return <p className="empty-state">Aun no hay propiedades cargadas.</p>;
  }

  return (
    <div className="property-portal-grid">
      {properties.map((property) => {
        const data = asData(property);
        const photoUrl = text(data.photoUrl);
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
                <span>{getBrokerName(property, brokers)}</span>
                {onStageChange ? (
                  <select value={text(data.stage, "LEAD")} onChange={(event) => onStageChange(property, event.target.value)}>
                    {REALTY_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                  </select>
                ) : (
                  <span>{REALTY_STAGES.find((stage) => stage.key === text(data.stage))?.label || "Lead"}</span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function RealtyLoadsPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [propertyForm, setPropertyForm] = useState(emptyProperty);
  const [brokerForm, setBrokerForm] = useState(emptyBroker);
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  async function createProperty(event: FormEvent) {
    event.preventDefault();
    const broker = data.brokers.find((item) => item.id === propertyForm.assignedBrokerId);
    await createIndustryRecord({
      recordType: "property",
      title: propertyForm.title || "Propiedad sin nombre",
      status: "ACTIVE",
      data: {
        ...propertyForm,
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

  async function createBroker(event: FormEvent) {
    event.preventDefault();
    await createIndustryRecord({
      recordType: "broker_profile",
      title: brokerForm.name || "Corredor sin nombre",
      status: "ACTIVE",
      data: brokerForm
    });
    setBrokerForm(emptyBroker);
    setMessage("Corredor creado");
    await reload();
  }

  async function onPhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const photoUrl = await fileToDataUrl(file);
    setPropertyForm((current) => ({ ...current, photoUrl }));
  }

  async function onExcelFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
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
        data: { source: "excel", row }
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
            <label className="secondary-btn">Subir foto<input type="file" accept="image/*" hidden onChange={onPhotoFile} /></label>
          </div>
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
          <div className="vertical-card-head"><div><span>Corredores</span><h2>Perfiles y reparto</h2></div></div>
          <form className="compact-form" onSubmit={createBroker}>
            <input value={brokerForm.name} onChange={(e) => setBrokerForm({ ...brokerForm, name: e.target.value })} placeholder="Nombre corredor" />
            <input value={brokerForm.email} onChange={(e) => setBrokerForm({ ...brokerForm, email: e.target.value })} placeholder="Email" />
            <input value={brokerForm.phone} onChange={(e) => setBrokerForm({ ...brokerForm, phone: e.target.value })} placeholder="Telefono" />
            <button className="primary-btn" type="submit">Crear corredor</button>
          </form>
          <div className="seller-load-grid">
            {data.brokers.map((broker) => (
              <BrokerProfileCard key={broker.id} broker={broker} properties={data.properties} />
            ))}
          </div>
        </div>
      </section>

      <section className="vertical-card">
        <div className="vertical-card-head">
          <div><span>Importacion masiva</span><h2>Excel para IA predictiva</h2></div>
          <label className="secondary-btn">Seleccionar Excel<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={onExcelFile} /></label>
        </div>
        <p>Sube una base de propiedades para acelerar aprendizaje, forecast y carga operativa.</p>
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

  async function updateStage(property: IndustryRecord, stage: string) {
    await updateIndustryRecord(property.id, { data: { ...asData(property), stage } });
    await reload();
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
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>Inventario</span><h2>Portal de propiedades</h2></div></div>
        <PropertyPortalCards properties={data.properties} brokers={data.brokers} onStageChange={updateStage} />
      </section>
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
              <PropertyPortalCards properties={[property]} brokers={data.brokers} />
              <button className="secondary-btn" onClick={() => createFollowup(property)}>Crear seguimiento</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function BrokersPageContent() {
  const { data, error, reload } = useRealtyWorkspace();
  const [brokerForm, setBrokerForm] = useState(emptyBroker);

  async function createBroker(event: FormEvent) {
    event.preventDefault();
    await createIndustryRecord({ recordType: "broker_profile", title: brokerForm.name || "Corredor", status: "ACTIVE", data: brokerForm });
    setBrokerForm(emptyBroker);
    await reload();
  }

  async function assignProperty(property: IndustryRecord, brokerId: string) {
    const broker = data.brokers.find((item) => item.id === brokerId);
    await updateIndustryRecord(property.id, {
      data: { ...asData(property), assignedBrokerId: brokerId, assignedBrokerName: broker?.name || "", assignmentMode: "manual" }
    });
    await reload();
  }

  return (
    <>
      <RealtyHeader
        eyebrow="Corredores"
        title="Perfiles y asignacion inmobiliaria"
        description="Crea corredores y asigna propiedades manualmente o con reparto balanceado."
      />
      {error ? <div className="sales-queue-error">{error}</div> : null}
      <section className="realty-ops-grid">
        <form className="vertical-card" onSubmit={createBroker}>
          <div className="vertical-card-head"><div><span>Nuevo corredor</span><h2>Perfil comercial</h2></div></div>
          <input value={brokerForm.name} onChange={(e) => setBrokerForm({ ...brokerForm, name: e.target.value })} placeholder="Nombre" />
          <input value={brokerForm.email} onChange={(e) => setBrokerForm({ ...brokerForm, email: e.target.value })} placeholder="Email" />
          <input value={brokerForm.phone} onChange={(e) => setBrokerForm({ ...brokerForm, phone: e.target.value })} placeholder="Telefono" />
          <button className="primary-btn" type="submit">Crear perfil corredor</button>
        </form>
        <article className="vertical-card">
          <div className="vertical-card-head"><div><span>Equipo</span><h2>Corredores activos</h2></div></div>
          <div className="seller-load-grid">
            {data.brokers.map((broker) => (
              <BrokerProfileCard key={broker.id} broker={broker} properties={data.properties} />
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
