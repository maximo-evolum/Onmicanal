"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { RealtyModuleNav } from "@/components/realty-workspace";
import { ModuleGate } from "@/components/module-gate";
import {
  createRealtyBuyer,
  createIndustryRecord,
  getIndustryRecords,
  getLeads,
  getMe,
  getRealtyLeadMatches,
  updateIndustryRecord,
  type IndustryRecord
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import type { Lead } from "@/lib/types";

type CustomerMode = "GASTRONOMY" | "HEALTH" | "DENTAL" | "VETERINARY" | "REAL_ESTATE" | "GENERAL";
type CustomerDocument = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

const emptyForm = {
  title: "",
  phone: "",
  email: "",
  preference: "",
  segment: "",
  nextAction: "",
  notes: "",
  status: "ACTIVE",
  documents: [] as CustomerDocument[]
};

const modeConfig: Record<CustomerMode, {
  eyebrow: string;
  title: string;
  subtitle: string;
  entityLabel: string;
  preferenceLabel: string;
  segmentLabel: string;
  placeholder: string;
}> = {
  GASTRONOMY: {
    eyebrow: "Rubro gastronomico",
    title: "Clientes, eventos y preferencias",
    subtitle: "Centraliza comensales, eventos, preferencias, recurrencia y proxima accion comercial.",
    entityLabel: "Cliente / evento",
    preferenceLabel: "Preferencias",
    segmentLabel: "Tipo de evento",
    placeholder: "Ej: Maria Gonzalez / Cumpleanos familiar"
  },
  DENTAL: {
    eyebrow: "Clinica dental",
    title: "Pacientes y tratamientos",
    subtitle: "Gestiona pacientes, tratamiento de interes, contacto, seguimiento y estado de atencion.",
    entityLabel: "Paciente",
    preferenceLabel: "Tratamiento",
    segmentLabel: "Profesional / box",
    placeholder: "Ej: Pedro Ramirez"
  },
  HEALTH: {
    eyebrow: "Salud clinica",
    title: "Pacientes y atencion clinica",
    subtitle: "Gestiona pacientes, antecedentes, especialidad, seguimiento y estado de atencion.",
    entityLabel: "Paciente",
    preferenceLabel: "Prestacion / motivo",
    segmentLabel: "Especialidad / profesional",
    placeholder: "Ej: Ana Perez"
  },
  VETERINARY: {
    eyebrow: "Clinica veterinaria",
    title: "Tutores, mascotas y controles",
    subtitle: "Registra tutores, mascotas, especie, motivo de consulta y recordatorios de seguimiento.",
    entityLabel: "Tutor / mascota",
    preferenceLabel: "Mascota / especie",
    segmentLabel: "Motivo",
    placeholder: "Ej: Laura Torres / Luna"
  },
  REAL_ESTATE: {
    eyebrow: "Rubro inmobiliario",
    title: "Compradores y propiedades compatibles",
    subtitle: "Registra lo que busca cada comprador y revisa propiedades que calzan con su presupuesto y preferencias.",
    entityLabel: "Comprador potencial",
    preferenceLabel: "Tipo de propiedad",
    segmentLabel: "Comuna de interes",
    placeholder: "Ej: Camila Rojas"
  },
  GENERAL: {
    eyebrow: "Operacion multirubro",
    title: "Clientes y fichas comerciales",
    subtitle: "Organiza contactos, necesidades, segmento y proxima accion de cada cliente.",
    entityLabel: "Cliente",
    preferenceLabel: "Interes",
    segmentLabel: "Segmento",
    placeholder: "Ej: Cliente ABC"
  }
};

function detectMode(industry?: string | null): CustomerMode {
  const value = String(industry || "").toUpperCase();
  if (value.includes("GASTRO") || value.includes("RESTAUR")) return "GASTRONOMY";
  if (value.includes("DENT")) return "DENTAL";
  if (value.includes("HEALTH") || value.includes("SALUD") || value.includes("CLINIC")) return "HEALTH";
  if (value.includes("VETER")) return "VETERINARY";
  if (value.includes("REAL_ESTATE") || value.includes("INMOBIL") || value.includes("CORRETAJE")) return "REAL_ESTATE";
  return "GENERAL";
}

function valueOf(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

function recordDocuments(record: IndustryRecord): CustomerDocument[] {
  const value = record.data?.documents;
  return Array.isArray(value)
    ? value.filter((item): item is CustomerDocument => Boolean(item && typeof item === "object" && typeof (item as CustomerDocument).name === "string"))
    : [];
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CL";
}

type BuyerForm = {
  name: string;
  phone: string;
  email: string;
  budget: string;
  commune: string;
  propertyType: string;
  interest: string;
};

type BuyerPropertyMatch = {
  score: number;
  reasons: string[];
  property: { id: string; title: string; status: string; price: number; commune: string; operation: string };
};

const emptyBuyerForm: BuyerForm = {
  name: "",
  phone: "",
  email: "",
  budget: "",
  commune: "",
  propertyType: "",
  interest: "COMPRA"
};

function formatMoney(value?: number | null) {
  if (!value) return "Sin presupuesto";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function RealtyBuyerWorkspace() {
  const [buyers, setBuyers] = useState<Lead[]>([]);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [matches, setMatches] = useState<BuyerPropertyMatch[]>([]);
  const [form, setForm] = useState<BuyerForm>(emptyBuyerForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadBuyers(selectId?: string) {
    try {
      setLoading(true);
      const result = await getLeads();
      const activeBuyers = result
        .filter((lead) => !["WON", "LOST", "ARCHIVED"].includes(String(lead.status).toUpperCase()))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));
      setBuyers(activeBuyers);
      if (selectId) setSelectedBuyerId(selectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los compradores");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBuyers();
  }, []);

  useEffect(() => {
    if (!selectedBuyerId) {
      setMatches([]);
      return;
    }
    getRealtyLeadMatches(selectedBuyerId)
      .then((result) => setMatches(result.matches))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron calcular las recomendaciones"));
  }, [selectedBuyerId]);

  async function saveBuyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = Number(form.budget);
    if (!form.name.trim() || !Number.isFinite(budget) || budget <= 0) {
      setError("Indica el nombre y un presupuesto estimado para poder recomendar propiedades.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const result = await createRealtyBuyer({ ...form, name: form.name.trim(), budget });
      setForm(emptyBuyerForm);
      setMessage("Comprador guardado. Ya puedes revisar sus propiedades recomendadas.");
      await loadBuyers(result.buyer.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el comprador");
    } finally {
      setSaving(false);
    }
  }

  const selectedBuyer = buyers.find((buyer) => buyer.id === selectedBuyerId) || null;

  return (
    <section className="realty-buyer-workspace">
      <form className="vertical-card vertical-form realty-buyer-form" onSubmit={saveBuyer}>
        <div>
          <span>Nuevo comprador</span>
          <h2>¿Qué propiedad está buscando?</h2>
          <p>Con estos datos EVOLUM compara automáticamente las propiedades disponibles.</p>
        </div>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre del comprador" required />
        <div className="vertical-two">
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" />
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Correo" />
        </div>
        <div className="vertical-two">
          <input type="number" min="1" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} placeholder="Presupuesto en pesos" required />
          <input value={form.commune} onChange={(event) => setForm({ ...form, commune: event.target.value })} placeholder="Comuna de interés" />
        </div>
        <div className="vertical-two">
          <select value={form.propertyType} onChange={(event) => setForm({ ...form, propertyType: event.target.value })}>
            <option value="">Tipo de propiedad</option>
            <option value="DEPARTAMENTO">Departamento</option>
            <option value="CASA">Casa</option>
            <option value="OFICINA">Oficina</option>
            <option value="TERRENO">Terreno</option>
          </select>
          <select value={form.interest} onChange={(event) => setForm({ ...form, interest: event.target.value })}>
            <option value="COMPRA">Compra</option>
            <option value="ARRIENDO">Arriendo</option>
          </select>
        </div>
        <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar y recomendar"}</button>
        {error ? <p className="sales-queue-error">{error}</p> : null}
        {message ? <p className="admin-notice success">{message}</p> : null}
      </form>

      <section className="vertical-card realty-buyer-results">
        <div className="vertical-card-head">
          <div>
            <span>Recomendación automática</span>
            <h2>Compradores y propiedades</h2>
          </div>
        </div>
        <div className="realty-buyer-layout">
          <div className="realty-buyer-list">
            {loading ? <p className="meta-line">Cargando compradores...</p> : null}
            {!loading && !buyers.length ? <p className="meta-line">Aún no hay compradores. Puedes crear el primero desde el formulario.</p> : null}
            {buyers.map((buyer) => (
              <button key={buyer.id} type="button" className={`realty-buyer-item ${selectedBuyerId === buyer.id ? "is-selected" : ""}`} onClick={() => setSelectedBuyerId(buyer.id)}>
                <strong>{buyer.name || "Comprador sin nombre"}</strong>
                <span>{formatMoney(buyer.budget)} · {buyer.commune || "Comuna por definir"}</span>
                <small>{buyer.propertyType || "Tipo por definir"} · {buyer.interest || "Compra"}</small>
              </button>
            ))}
          </div>
          <div className="realty-match-panel">
            {!selectedBuyer ? <p className="meta-line">Selecciona un comprador para ver las propiedades que mejor calzan.</p> : (
              <>
                <div className="realty-match-heading">
                  <div><span>Para {selectedBuyer.name || "este comprador"}</span><h3>Propiedades recomendadas</h3></div>
                  <strong>{formatMoney(selectedBuyer.budget)}</strong>
                </div>
                {!matches.length ? <p className="meta-line">Todavía no hay una propiedad disponible que calce con los datos registrados. Puedes ajustar la búsqueda o ingresar nuevas propiedades.</p> : null}
                <div className="realty-property-match-list">
                  {matches.map((match) => (
                    <article key={match.property.id} className="realty-property-match">
                      <div>
                        <strong>{match.property.title}</strong>
                        <span>{formatMoney(match.property.price)} · {match.property.commune || "Comuna por definir"}</span>
                        <small>{match.reasons.join(" · ")}</small>
                      </div>
                      <b>{match.score}% compatible</b>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}

export default function CustomersPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [records, setRecords] = useState<IndustryRecord[]>([]);
  const [mode, setMode] = useState<CustomerMode>("GENERAL");
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingDocument, setRemovingDocument] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [customerData, me] = await Promise.all([
        getIndustryRecords("customer"),
        getMe().catch(() => null)
      ]);
      setRecords(customerData);
      setMode(detectMode(me?.tenant?.industry));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar fichas");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const config = modeConfig[mode];
  const active = useMemo(() => records.filter((record) => record.status !== "ARCHIVED"), [records]);
  const pending = useMemo(() => active.filter((record) => String(record.status).toUpperCase() === "PENDING").length, [active]);
  const withNextAction = useMemo(() => active.filter((record) => valueOf(record, "nextAction")).length, [active]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      await createIndustryRecord({
        recordType: "customer",
        title: form.title,
        status: form.status,
        data: {
          verticalMode: mode,
          phone: form.phone,
          email: form.email,
          preference: form.preference,
          segment: form.segment,
          nextAction: form.nextAction,
          notes: form.notes,
          documents: form.documents
        }
      });
      setForm(emptyForm);
      setMessage("Ficha guardada correctamente.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la ficha");
    } finally {
      setSaving(false);
    }
  }

  function handleCustomerFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const accepted = files.slice(0, 6);
    const oversized = accepted.find((file) => file.size > 2_500_000);
    if (oversized) {
      setError("Cada documento debe pesar menos de 2.5 MB para adjuntarlo a la ficha.");
      return;
    }

    Promise.all(accepted.map((file) => new Promise<CustomerDocument>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: typeof reader.result === "string" ? reader.result : "",
      });
      reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
      reader.readAsDataURL(file);
    })))
      .then((documents) => {
        setForm((current) => ({ ...current, documents: [...current.documents, ...documents].slice(0, 8) }));
        setMessage("Documentos adjuntados. Guarda la ficha para dejarlos disponibles.");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron adjuntar documentos"));
  }

  function removePendingDocument(index: number) {
    setForm((current) => ({ ...current, documents: current.documents.filter((_, documentIndex) => documentIndex !== index) }));
  }

  async function removeSavedDocument(record: IndustryRecord, document: CustomerDocument, index: number) {
    const label = document.name || "este archivo";
    if (!window.confirm(`Quitar ${label} de la ficha de ${record.title}? La ficha se mantiene; solo se elimina el adjunto.`)) return;
    const actionKey = `${record.id}-${index}`;
    try {
      setRemovingDocument(actionKey);
      const documents = recordDocuments(record).filter((_, documentIndex) => documentIndex !== index);
      await updateIndustryRecord(record.id, { data: { ...(record.data || {}), documents } });
      setMessage("Adjunto eliminado de la ficha.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el adjunto");
    } finally {
      setRemovingDocument(null);
    }
  }

  async function updateStatus(record: IndustryRecord, status: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado");
    }
  }

  return (
    <ModuleGate moduleKey="realty_clients">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Clientes" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className={`vertical-page industry-service-page ${mode === "REAL_ESTATE" ? "realty-page realty-workspace" : ""}`}>
          <header className="vertical-hero service-hero">
            <div>
              <span>{config.eyebrow}</span>
              <h1>{config.title}</h1>
              <p>{config.subtitle}</p>
            </div>
            {mode === "REAL_ESTATE" ? (
              <div className="vertical-hero-stats">
                <article><strong>IA</strong><span>Matching activo</span></article>
                <article><strong>CLP</strong><span>Presupuesto considerado</span></article>
                <article><strong>Chat&apos;s</strong><span>Recomendación en tiempo real</span></article>
              </div>
            ) : (
              <div className="vertical-hero-stats">
                <article><strong>{active.length}</strong><span>Fichas</span></article>
                <article><strong>{pending}</strong><span>Pendientes</span></article>
                <article><strong>{withNextAction}</strong><span>Seguimientos</span></article>
              </div>
            )}
          </header>

          {mode === "REAL_ESTATE" ? <RealtyModuleNav active="Clientes inmobiliarios" /> : null}

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

          {mode === "REAL_ESTATE" ? <RealtyBuyerWorkspace /> : (
          <section className="service-grid">
            <form className="vertical-card vertical-form" onSubmit={handleCreate}>
              <div>
                <span>Nueva ficha</span>
                <h2>{config.entityLabel}</h2>
              </div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={config.placeholder} required />
              <div className="vertical-two">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefono" />
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" />
              </div>
              <div className="vertical-two">
                <input value={form.preference} onChange={(e) => setForm({ ...form, preference: e.target.value })} placeholder={config.preferenceLabel} />
                <input value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} placeholder={config.segmentLabel} />
              </div>
              <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} placeholder="Proxima accion / recordatorio" />
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas de contexto, historial o preferencias" rows={4} />
              <label className="document-upload-box">
                <strong>Subir examenes / presupuestos</strong>
                <span>PDF, imagenes o documentos para enviar luego por WhatsApp o email.</span>
                <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={handleCustomerFiles} />
              </label>
              {form.documents.length ? (
                <div className="document-chip-list">
                  {form.documents.map((document, index) => (
                    <span key={`${document.name}-${document.size}-${index}`}>
                      {document.name}
                      <button type="button" className="document-chip-remove" onClick={() => removePendingDocument(index)} aria-label={`Quitar ${document.name}`}>Quitar</button>
                    </span>
                  ))}
                </div>
              ) : null}
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Activa</option>
                <option value="PENDING">Pendiente</option>
                <option value="FOLLOWUP">Seguimiento</option>
              </select>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar ficha"}</button>
            </form>

            <section className="vertical-card">
              <div className="vertical-card-head">
                <div>
                  <span>Vista operativa</span>
                  <h2>Fichas recientes</h2>
                </div>
              </div>
              <div className="service-record-list">
                {active.length ? active.map((record) => (
                  <article key={record.id} className="service-record-card">
                    <div className="service-record-avatar">{initials(record.title)}</div>
                    <div>
                      <strong>{record.title}</strong>
                      <span>{valueOf(record, "phone") || "Sin telefono"} / {valueOf(record, "preference") || "Sin interes"}</span>
                      <small>{valueOf(record, "nextAction") || valueOf(record, "notes") || "Sin proxima accion"}</small>
                    </div>
                    <select value={record.status} onChange={(e) => updateStatus(record, e.target.value)}>
                      <option value="ACTIVE">Activa</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="FOLLOWUP">Seguimiento</option>
                      <option value="ARCHIVED">Archivada</option>
                    </select>
                    {recordDocuments(record).length ? (
                      <div className="service-record-documents">
                        {recordDocuments(record).map((document, index) => (
                          <span key={`${document.name}-${index}`}>
                            {document.name}
                            <button
                              type="button"
                              className="document-chip-remove"
                              disabled={removingDocument === `${record.id}-${index}`}
                              onClick={() => removeSavedDocument(record, document, index)}
                            >{removingDocument === `${record.id}-${index}` ? "Quitando..." : "Eliminar"}</button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )) : <p className="meta-line">Aun no hay fichas creadas para este rubro.</p>}
              </div>
            </section>
          </section>
          )}
        </main>
      </div>
    </ModuleGate>
  );
}
