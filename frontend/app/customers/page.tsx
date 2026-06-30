"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createIndustryRecord,
  getIndustryRecords,
  getMe,
  updateIndustryRecord,
  type IndustryRecord
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

type CustomerMode = "GASTRONOMY" | "DENTAL" | "VETERINARY" | "GENERAL";
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
  VETERINARY: {
    eyebrow: "Clinica veterinaria",
    title: "Tutores, mascotas y controles",
    subtitle: "Registra tutores, mascotas, especie, motivo de consulta y recordatorios de seguimiento.",
    entityLabel: "Tutor / mascota",
    preferenceLabel: "Mascota / especie",
    segmentLabel: "Motivo",
    placeholder: "Ej: Laura Torres / Luna"
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
  if (value.includes("VETER")) return "VETERINARY";
  return "GENERAL";
}

function valueOf(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CL";
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
    <ModuleGate moduleKey="customers">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Clientes / Pacientes" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="vertical-page industry-service-page">
          <header className="vertical-hero service-hero">
            <div>
              <span>{config.eyebrow}</span>
              <h1>{config.title}</h1>
              <p>{config.subtitle}</p>
            </div>
            <div className="vertical-hero-stats">
              <article><strong>{active.length}</strong><span>Fichas</span></article>
              <article><strong>{pending}</strong><span>Pendientes</span></article>
              <article><strong>{withNextAction}</strong><span>Seguimientos</span></article>
            </div>
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

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
                  {form.documents.map((document) => <span key={`${document.name}-${document.size}`}>{document.name}</span>)}
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
                  </article>
                )) : <p className="meta-line">Aun no hay fichas creadas para este rubro.</p>}
              </div>
            </section>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
