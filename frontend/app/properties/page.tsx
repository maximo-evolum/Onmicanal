"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createCampaign,
  createIndustryRecord,
  getBalancedIndustryAssignments,
  getIndustryRecords,
  getIndustryUsers,
  updateIndustryRecord,
  type IndustryRecord,
  type IndustryUser
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

const PROPERTY_STAGES = [
  { key: "PROSPECTING", label: "Prospeccion", tone: "violet" },
  { key: "PUBLISHED", label: "Publicada", tone: "cyan" },
  { key: "VISITS", label: "Visitas", tone: "blue" },
  { key: "NEGOTIATION", label: "Negociacion", tone: "amber" },
  { key: "RESERVED", label: "Reservada", tone: "pink" },
  { key: "SOLD", label: "Vendida", tone: "green" }
];

const emptyProperty = {
  title: "",
  price: "",
  address: "",
  material: "",
  bedrooms: "",
  bathrooms: "",
  parking: "",
  meters: "",
  photoUrl: "",
  photoFileName: "",
  observations: "",
  assignedToId: "",
  stage: "PROSPECTING"
};

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!amount) return "Sin precio";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function recordValue(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

function recordStage(record: IndustryRecord) {
  const stage = String(recordValue(record, "stage") || "PROSPECTING");
  return PROPERTY_STAGES.some((item) => item.key === stage) ? stage : "PROSPECTING";
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "EV";
}

function priceNumber(record: IndustryRecord) {
  return Number(recordValue(record, "price") || 0);
}

export default function PropertiesPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [users, setUsers] = useState<IndustryUser[]>([]);
  const [form, setForm] = useState(emptyProperty);
  const [assignments, setAssignments] = useState<Array<{ item: IndustryRecord; assignee: IndustryUser }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [campaigningId, setCampaigningId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [propertyData, userData] = await Promise.all([
        getIndustryRecords("property"),
        getIndustryUsers().catch(() => [])
      ]);
      setRecords(propertyData);
      setUsers(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar propiedades");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sellers = useMemo(() => users.filter((user) => ["SELLER", "AGENT", "OWNER", "ADMIN"].includes(user.role)), [users]);
  const available = useMemo(() => records.filter((record) => record.status !== "ARCHIVED"), [records]);
  const totalValue = useMemo(() => available.reduce((sum, record) => sum + priceNumber(record), 0), [available]);
  const unassigned = useMemo(() => available.filter((record) => !record.assignedToId).length, [available]);
  const activePipelineCount = useMemo(
    () => available.filter((record) => ["VISITS", "NEGOTIATION", "RESERVED"].includes(recordStage(record))).length,
    [available]
  );
  const sellerLoads = useMemo(() => {
    return sellers.map((seller) => ({
      seller,
      count: available.filter((record) => record.assignedToId === seller.id).length,
      value: available
        .filter((record) => record.assignedToId === seller.id)
        .reduce((sum, record) => sum + priceNumber(record), 0)
    }));
  }, [available, sellers]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      await createIndustryRecord({
        recordType: "property",
        title: form.title,
        status: form.stage === "SOLD" ? "SOLD" : "ACTIVE",
        assignedToId: form.assignedToId || null,
        data: {
          price: Number(form.price || 0),
          address: form.address,
          material: form.material,
          bedrooms: Number(form.bedrooms || 0),
          bathrooms: Number(form.bathrooms || 0),
          parking: Number(form.parking || 0),
          meters: Number(form.meters || 0),
          photoUrl: form.photoUrl,
          photoFileName: form.photoFileName,
          observations: form.observations,
          stage: form.stage
        }
      });
      setForm(emptyProperty);
      setMessage("Propiedad cargada correctamente.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la propiedad");
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_800_000) {
      setError("La foto debe pesar menos de 1.8 MB para adjuntarla a la ficha.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setForm((current) => ({ ...current, photoUrl: result, photoFileName: file.name }));
      setMessage("Foto cargada en la ficha. Guarda la propiedad para aplicarla.");
    };
    reader.readAsDataURL(file);
  }

  async function calculateAssignments() {
    try {
      setError(null);
      const result = await getBalancedIndustryAssignments({ recordType: "property", assigneeRole: "SELLER" });
      setAssignments(result.assignments.map((item) => ({ item: item.item, assignee: item.assignee })));
      if (!result.assignments.length) setMessage("No hay vendedores SELLER activos. Puedes usar asignacion manual.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular la asignacion");
    }
  }

  async function applyAssignments() {
    try {
      setSaving(true);
      setError(null);
      await Promise.all(assignments.map((assignment) =>
        updateIndustryRecord(assignment.item.id, { assignedToId: assignment.assignee.id })
      ));
      setMessage("Asignacion balanceada aplicada.");
      setAssignments([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar la asignacion");
    } finally {
      setSaving(false);
    }
  }

  async function updateAssignment(record: IndustryRecord, assignedToId: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, { assignedToId: assignedToId || null });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el vendedor");
    }
  }

  async function updateStage(record: IndustryRecord, stage: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, {
        status: stage === "SOLD" ? "SOLD" : "ACTIVE",
        data: { ...(record.data || {}), stage }
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mover la propiedad");
    }
  }

  async function createPropertyCampaign(record: IndustryRecord) {
    try {
      setCampaigningId(record.id);
      setError(null);
      const price = money(recordValue(record, "price"));
      const address = String(recordValue(record, "address") || "ubicacion por confirmar");
      const observations = String(recordValue(record, "observations") || "");
      await createCampaign({
        name: `Campaña inmobiliaria - ${record.title}`,
        segment: "realty",
        template: JSON.stringify({
          source: "property",
          propertyId: record.id,
          product: record.title,
          visualTitle: `Propiedad destacada: ${record.title}`,
          caption: `${record.title} en ${address}. Precio: ${price}. ${observations}`.trim(),
          cta: "Agenda tu visita",
          platforms: ["instagram", "facebook", "whatsapp"],
          status: "DRAFT"
        })
      });
      setMessage("Borrador de campana inmobiliaria creado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la campana");
    } finally {
      setCampaigningId(null);
    }
  }

  return (
    <ModuleGate moduleKey="properties">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Propiedades" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="vertical-page realty-page">
          <header className="vertical-hero realty-hero">
            <div>
              <span>Rubro inmobiliario</span>
              <h1>Propiedades y ventas asistidas</h1>
              <p>Carga viviendas con ficha completa, asigna vendedores de forma equitativa y mueve cada propiedad por el pipeline comercial.</p>
            </div>
            <div className="realty-hero-actions">
              <button className="ghost-btn" type="button" onClick={load}>Actualizar</button>
              <button className="primary-btn" type="button" onClick={calculateAssignments}>Calcular reparto</button>
            </div>
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

          <section className="realty-kpi-grid">
            <article className="realty-kpi-card">
              <span>Propiedades</span>
              <strong>{available.length}</strong>
              <small>{PROPERTY_STAGES.length} etapas comerciales</small>
            </article>
            <article className="realty-kpi-card">
              <span>Valor cartera</span>
              <strong>{money(totalValue)}</strong>
              <small>Inventario activo</small>
            </article>
            <article className="realty-kpi-card">
              <span>Sin vendedor</span>
              <strong>{unassigned}</strong>
              <small>Listas para asignacion</small>
            </article>
            <article className="realty-kpi-card">
              <span>En gestion</span>
              <strong>{activePipelineCount}</strong>
              <small>Visita, negociacion o reserva</small>
            </article>
          </section>

          <section className="realty-ops-grid">
            <form className="vertical-card vertical-form realty-property-form" onSubmit={handleCreate}>
              <div>
                <span>Nueva propiedad</span>
                <h2>Ficha de vivienda</h2>
              </div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Nombre de propiedad" required />
              <div className="vertical-two">
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Precio CLP" inputMode="numeric" />
                <input value={form.meters} onChange={(e) => setForm({ ...form, meters: e.target.value })} placeholder="M2" inputMode="numeric" />
              </div>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Direccion / comuna" />
              <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Material principal" />
              <div className="vertical-three">
                <input value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} placeholder="Piezas" inputMode="numeric" />
                <input value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} placeholder="Banos" inputMode="numeric" />
                <input value={form.parking} onChange={(e) => setForm({ ...form, parking: e.target.value })} placeholder="Estac." inputMode="numeric" />
              </div>
              <div className="file-picker-row">
                <input value={form.photoUrl} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} placeholder="URL foto principal" />
                <label className="ghost-btn file-picker-button">
                  Subir foto
                  <input type="file" accept="image/*" onChange={handlePhotoFile} />
                </label>
              </div>
              {form.photoFileName ? <span className="meta-line">Foto seleccionada: {form.photoFileName}</span> : null}
              <textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Observaciones generales" rows={4} />
              <div className="vertical-two">
                <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">Sin vendedor asignado</option>
                  {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} / {seller.role}</option>)}
                </select>
                <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {PROPERTY_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                </select>
              </div>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar propiedad"}</button>
            </form>

            <section className="vertical-card realty-assignment-panel">
              <div className="vertical-card-head">
                <div>
                  <span>Equipo comercial</span>
                  <h2>Reparto por vendedor</h2>
                </div>
                {assignments.length ? <button className="ghost-btn" type="button" onClick={applyAssignments} disabled={saving}>Aplicar reparto</button> : null}
              </div>
              <div className="seller-load-grid">
                {sellerLoads.length ? sellerLoads.map(({ seller, count, value }) => (
                  <article key={seller.id} className="seller-load-card">
                    <div className="seller-avatar">{initials(seller.name)}</div>
                    <div>
                      <strong>{seller.name}</strong>
                      <span>{count} propiedades</span>
                    </div>
                    <small>{money(value)}</small>
                  </article>
                )) : <p className="meta-line">Agrega vendedores con rol SELLER para activar reparto automatico.</p>}
              </div>
              <div className="vertical-assignment-list realty-suggested-list">
                {assignments.length ? assignments.map((assignment) => (
                  <article key={assignment.item.id}>
                    <strong>{assignment.item.title}</strong>
                    <span>{assignment.assignee.name}</span>
                  </article>
                )) : <p className="meta-line">Calcula el reparto para distribuir propiedades sin vendedor de forma balanceada.</p>}
              </div>
            </section>
          </section>

          <section className="vertical-list realty-pipeline-section">
            <div className="vertical-card-head">
              <div>
                <span>Pipeline inmobiliario</span>
                <h2>Operacion por etapa</h2>
              </div>
            </div>
            <div className="realty-pipeline">
              {PROPERTY_STAGES.map((stage) => {
                const stageRecords = available.filter((record) => recordStage(record) === stage.key);
                const stageValue = stageRecords.reduce((sum, record) => sum + priceNumber(record), 0);
                return (
                  <article className={`realty-stage-column tone-${stage.tone}`} key={stage.key}>
                    <header>
                      <strong>{stage.label}</strong>
                      <span>{stageRecords.length}</span>
                    </header>
                    <small>{money(stageValue)}</small>
                    <div className="realty-stage-list">
                      {stageRecords.length ? stageRecords.map((record) => (
                        <div className="realty-stage-card" key={record.id}>
                          <strong>{record.title}</strong>
                          <span>{recordValue(record, "address") || "Sin direccion"}</span>
                          <div className="realty-mini-row">
                            <small>{money(recordValue(record, "price"))}</small>
                            <small>{record.assignedTo?.name || "Sin vendedor"}</small>
                          </div>
                          <select value={record.assignedToId || ""} onChange={(e) => updateAssignment(record, e.target.value)}>
                            <option value="">Asignar vendedor</option>
                            {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
                          </select>
                          <div className="property-card-actions">
                            <select value={recordStage(record)} onChange={(e) => updateStage(record, e.target.value)}>
                              {PROPERTY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                            </select>
                            <button className="ghost-btn" type="button" onClick={() => createPropertyCampaign(record)} disabled={campaigningId === record.id}>
                              {campaigningId === record.id ? "Creando..." : "Campaña"}
                            </button>
                          </div>
                        </div>
                      )) : <p>No hay propiedades en esta etapa.</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="vertical-list">
            <div className="vertical-card-head">
              <div>
                <span>{available.length} activas</span>
                <h2>Inventario inmobiliario</h2>
              </div>
            </div>
            <div className="property-card-grid">
              {available.map((record) => (
                <article className="property-card" key={record.id}>
                  {recordValue(record, "photoUrl") ? <img src={String(recordValue(record, "photoUrl"))} alt="" /> : <div className="property-photo-fallback">PR</div>}
                  <div>
                    <strong>{record.title}</strong>
                    <span>{recordValue(record, "address") || "Sin direccion"}</span>
                  </div>
                  <div className="property-specs">
                    <span>{recordValue(record, "bedrooms") || 0} piezas</span>
                    <span>{recordValue(record, "bathrooms") || 0} banos</span>
                    <span>{recordValue(record, "parking") || 0} est.</span>
                    <span>{recordValue(record, "meters") || 0} m2</span>
                  </div>
                  <p>{recordValue(record, "observations") || "Sin observaciones."}</p>
                  <footer>
                    <strong>{money(recordValue(record, "price"))}</strong>
                    <small>{record.assignedTo?.name || "Sin vendedor"}</small>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
