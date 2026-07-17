"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createMetadataSchema, getMetadataSchemas, migrateMetadataSchema, publishMetadataSchema, type MetadataSchema } from "@/lib/api";

type FieldType = "string" | "number" | "date" | "boolean" | "array" | "relation";
type DataCare = "INTERNAL" | "PERSONAL" | "SENSITIVE" | "CONFIDENTIAL";
type FieldDraft = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  care: DataCare;
  options: string;
};

type Preset = {
  id: string;
  name: string;
  description: string;
  recordType: string;
  label: string;
  fields: FieldDraft[];
};

const careCopy: Record<DataCare, { label: string; description: string; purpose: string; retentionDays: number }> = {
  INTERNAL: { label: "Operación interna", description: "Información normal para operar el servicio.", purpose: "Operación del servicio", retentionDays: 1825 },
  PERSONAL: { label: "Dato personal", description: "Nombre, teléfono, correo u otro dato de una persona.", purpose: "Atención y seguimiento del servicio", retentionDays: 1825 },
  SENSITIVE: { label: "Dato sensible", description: "Información clínica, de salud u otra que requiere mayor cuidado.", purpose: "Atención clínica y continuidad del servicio", retentionDays: 3650 },
  CONFIDENTIAL: { label: "Dato confidencial", description: "Montos, pagos o información comercial reservada.", purpose: "Gestión comercial, cobros y administración", retentionDays: 2555 },
};

const fieldTypes: Array<{ value: FieldType; label: string; help: string }> = [
  { value: "string", label: "Texto", help: "Nombres, direcciones, notas o códigos." },
  { value: "number", label: "Número o monto", help: "Precios, cantidades, metros o porcentajes." },
  { value: "date", label: "Fecha", help: "Citas, vencimientos o fechas importantes." },
  { value: "boolean", label: "Sí / No", help: "Una respuesta simple, como confirmado o no." },
  { value: "array", label: "Lista", help: "Varios elementos, como servicios o documentos." },
  { value: "relation", label: "Vincular a otra ficha", help: "Relaciona este dato con un cliente, propiedad u otra ficha." },
];

function field(label: string, type: FieldType = "string", required = false, care: DataCare = "INTERNAL"): FieldDraft {
  return { id: `${label}-${Math.random().toString(36).slice(2, 8)}`, label, type, required, care, options: "" };
}

const presets: Preset[] = [
  {
    id: "property",
    name: "Propiedad inmobiliaria",
    description: "Dirección, precio y características para ventas o arriendos.",
    recordType: "property",
    label: "Propiedad",
    fields: [field("Dirección", "string", true), field("Precio", "number", true, "CONFIDENTIAL"), field("Tipo de propiedad"), field("Dormitorios", "number"), field("Baños", "number"), field("Fecha de captación", "date")],
  },
  {
    id: "patient",
    name: "Paciente de salud",
    description: "Ficha de paciente para atención clínica humana.",
    recordType: "patient",
    label: "Paciente",
    fields: [field("Nombre completo", "string", true, "PERSONAL"), field("Teléfono", "string", false, "PERSONAL"), field("Fecha de nacimiento", "date", false, "PERSONAL"), field("Antecedentes", "string", false, "SENSITIVE"), field("Especialidad", "string")],
  },
  {
    id: "dental_exam",
    name: "Examen o presupuesto",
    description: "Órdenes, resultados y cotizaciones de salud o dental.",
    recordType: "exam",
    label: "Examen o presupuesto",
    fields: [field("Paciente", "relation", true, "PERSONAL"), field("Tipo", "string", true), field("Monto", "number", false, "CONFIDENTIAL"), field("Resultado", "string", false, "SENSITIVE"), field("Fecha", "date", true)],
  },
  {
    id: "vehicle",
    name: "Vehículo de taller",
    description: "Patente, kilometraje, diagnóstico y estado de un vehículo.",
    recordType: "vehicle",
    label: "Vehículo",
    fields: [field("Patente", "string", true), field("Marca y modelo", "string", true), field("Kilometraje", "number"), field("Diagnóstico", "string"), field("Fecha de ingreso", "date")],
  },
  {
    id: "blank",
    name: "Empezar desde cero",
    description: "Crea una ficha personalizada con los datos que necesites.",
    recordType: "custom_record",
    label: "Nueva ficha",
    fields: [field("Nombre", "string", true, "PERSONAL")],
  },
];

function toKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "") || "custom_record";
}

function cloneFields(fields: FieldDraft[]) {
  return fields.map((item) => ({ ...item, id: `${item.id}-${Math.random().toString(36).slice(2, 6)}` }));
}

export default function MetadataSettingsPage() {
  const [schemas, setSchemas] = useState<MetadataSchema[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState("property");
  const [recordType, setRecordType] = useState("property");
  const [label, setLabel] = useState("Propiedad");
  const [fieldRows, setFieldRows] = useState<FieldDraft[]>(() => cloneFields(presets[0].fields));
  const [strict, setStrict] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const response = await getMetadataSchemas();
    setSchemas(response.schemas || []);
  }

  useEffect(() => {
    void reload().catch((error) => setStatus(error instanceof Error ? error.message : "No se pudieron cargar las configuraciones"));
  }, []);

  const generatedType = useMemo(() => toKey(recordType || label), [label, recordType]);
  const fieldCount = fieldRows.filter((item) => item.label.trim()).length;

  function applyPreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setRecordType(preset.recordType);
    setLabel(preset.label);
    setFieldRows(cloneFields(preset.fields));
    setStatus(`Plantilla “${preset.name}” lista. Puedes ajustar los campos antes de guardar.`);
  }

  function updateField(id: string, change: Partial<FieldDraft>) {
    setFieldRows((items) => items.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function addField() {
    setFieldRows((items) => [...items, field("Nuevo dato")]);
  }

  function removeField(id: string) {
    setFieldRows((items) => items.filter((item) => item.id !== id));
  }

  function buildFields() {
    const result: Record<string, Record<string, unknown>> = {};
    for (const item of fieldRows) {
      if (!item.label.trim()) continue;
      const key = toKey(item.label);
      const care = careCopy[item.care];
      const type = item.type === "relation" ? "relation" : item.type;
      const config: Record<string, unknown> = {
        label: item.label.trim(),
        type,
        required: item.required,
        sensitivity: item.care,
        purpose: care.purpose,
        retentionDays: care.retentionDays,
      };
      if (item.type === "relation") config.relationRecordType = "customer";
      if (item.options.trim()) config.options = item.options.split(",").map((value) => value.trim()).filter(Boolean);
      result[key] = config;
    }
    return result;
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    if (!label.trim() || !fieldCount) {
      setStatus("Escribe un nombre y agrega al menos un dato a la ficha.");
      return;
    }
    try {
      setSaving(true);
      setStatus(null);
      const response = await createMetadataSchema({
        recordType: generatedType,
        label: label.trim(),
        fields: buildFields(),
        policies: { enforcement: strict ? "STRICT" : "COMPATIBLE", allowUnknown: !strict },
      });
      setStatus(`Borrador v${response.schema.version} creado. Revísalo y publícalo cuando estés conforme.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo crear el borrador. Revisa los campos indicados.");
    } finally {
      setSaving(false);
    }
  }

  async function publish(id: string) {
    try {
      setSaving(true);
      setStatus(null);
      const response = await publishMetadataSchema(id);
      setStatus(`${response.schema.label} está activo. Los nuevos registros usarán esta configuración.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo activar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  async function migrate(schema: MetadataSchema) {
    try {
      setSaving(true);
      setStatus(null);
      const core = ["lead", "booking", "payment"].includes(schema.recordType);
      const preview = await migrateMetadataSchema(schema.id, { core });
      const count = preview.records?.length || 0;
      if (!count) { setStatus("No hay registros antiguos pendientes de actualizar."); return; }
      if (!window.confirm(`Hay ${count} registros antiguos. ¿Quieres actualizarlos a esta versión?`)) { setStatus("Actualización cancelada."); return; }
      const applied = await migrateMetadataSchema(schema.id, { core, apply: true });
      setStatus(`Actualización terminada: ${applied.migrated || 0} registros.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudieron actualizar los registros.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleGate moduleKey="metadata">
    <div className={`module-with-menu-shell metadata-settings-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar active="Esquemas de datos" isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
      <main className="main dashboard-page metadata-settings-main">
        <header className="module-app-header metadata-header">
          <div>
            <span className="eyebrow">CONFIGURADOR DE FICHAS</span>
            <h1>Diseña los datos que necesita tu equipo</h1>
            <p>No necesitas programar. Elige una plantilla, define los datos y activa la ficha cuando esté lista.</p>
          </div>
          <AccountPill />
        </header>

        <section className="metadata-guide">
          <article><b>1</b><div><strong>Elige una ficha</strong><span>Parte desde una plantilla conocida.</span></div></article>
          <article><b>2</b><div><strong>Agrega los datos</strong><span>Indica qué necesita completar tu equipo.</span></div></article>
          <article><b>3</b><div><strong>Actívala cuando quieras</strong><span>Primero se guarda como borrador, sin afectar lo actual.</span></div></article>
        </section>

        {status ? <p className="module-note metadata-notice">{status}</p> : null}

        <form onSubmit={createDraft} className="metadata-builder">
          <section className="vertical-card metadata-step-card">
            <div className="vertical-card-head"><div><span>PASO 1</span><h2>¿Qué ficha quieres organizar?</h2><p>Selecciona la más parecida a tu operación. Después podrás cambiarla.</p></div></div>
            <div className="metadata-preset-grid">
              {presets.map((preset) => (
                <button className={`metadata-preset ${selectedPreset === preset.id ? "selected" : ""}`} type="button" key={preset.id} onClick={() => applyPreset(preset)}>
                  <strong>{preset.name}</strong><span>{preset.description}</span>
                </button>
              ))}
            </div>
            <label className="metadata-name-field">
              <span>Nombre que verá tu equipo</span>
              <input value={label} onChange={(event) => { setLabel(event.target.value); setSelectedPreset("custom"); }} placeholder="Ej: Ficha de paciente" required />
              <small>Se organizará internamente como “{generatedType}”. No necesitas editar códigos.</small>
            </label>
          </section>

          <section className="vertical-card metadata-step-card">
            <div className="vertical-card-head"><div><span>PASO 2</span><h2>¿Qué datos debe pedir la ficha?</h2><p>Marca “Obligatorio” solo para información que realmente no puede faltar.</p></div><button className="secondary-btn" type="button" onClick={addField}>+ Agregar dato</button></div>
            <div className="metadata-field-list">
              {fieldRows.map((item, index) => (
                <article className="metadata-field-row" key={item.id}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <label><span>Nombre del dato</span><input value={item.label} onChange={(event) => updateField(item.id, { label: event.target.value })} placeholder="Ej: Teléfono" /></label>
                  <label><span>Formato</span><select value={item.type} onChange={(event) => updateField(item.id, { type: event.target.value as FieldType })}>{fieldTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
                  <label><span>Cuidado del dato</span><select value={item.care} onChange={(event) => updateField(item.id, { care: event.target.value as DataCare })}>{Object.entries(careCopy).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}</select></label>
                  <label className="metadata-required"><input type="checkbox" checked={item.required} onChange={(event) => updateField(item.id, { required: event.target.checked })} /> Obligatorio</label>
                  <button className="metadata-remove" type="button" onClick={() => removeField(item.id)} disabled={fieldRows.length === 1} aria-label={`Quitar ${item.label || "dato"}`}>×</button>
                  <small className="metadata-field-help">{fieldTypes.find((type) => type.value === item.type)?.help} {careCopy[item.care].description}</small>
                  {item.type === "string" ? <label className="metadata-options"><span>Opciones (opcional, separadas por coma)</span><input value={item.options} onChange={(event) => updateField(item.id, { options: event.target.value })} placeholder="Ej: Nuevo, En proceso, Cerrado" /></label> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="vertical-card metadata-step-card metadata-publish-card">
            <div><span>PASO 3</span><h2>Guarda con tranquilidad</h2><p>Primero crearemos un borrador. Nada cambia para tu equipo hasta que presiones “Activar” en la lista inferior.</p></div>
            <label className="metadata-safety-toggle"><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} /><span><strong>Bloquear datos que no estén en esta lista</strong><small>Déjalo desactivado mientras pruebas la ficha. Puedes activarlo cuando el formulario esté definido.</small></span></label>
            <div className="metadata-publish-actions"><span>{fieldCount} datos configurados</span><button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar como borrador"}</button></div>
          </section>
        </form>

        <section className="vertical-card metadata-existing">
          <div className="vertical-card-head"><div><span>FICHAS GUARDADAS</span><h2>Versiones y activación</h2><p>Una sola versión puede estar activa por tipo de ficha.</p></div></div>
          <div className="vertical-list metadata-schema-list">
            {schemas.length ? schemas.map((schema) => (
              <article key={schema.id}>
                <div><strong>{schema.label}</strong><p>{Object.keys(schema.fields || {}).length} datos · versión {schema.version}</p><small>{schema.status === "PUBLISHED" ? "Activa" : schema.status === "DRAFT" ? "Borrador: aún no afecta al equipo" : "Versión anterior"} · {schema.policies?.generatedBy === "industry_template" ? "creada automáticamente desde tu rubro" : schema.policies?.enforcement === "STRICT" ? "campos nuevos bloqueados" : "modo flexible"}</small></div>
                <div className="metadata-schema-actions">{schema.status === "DRAFT" ? <button className="primary-btn" disabled={saving} onClick={() => void publish(schema.id)}>Activar ficha</button> : schema.status === "PUBLISHED" ? <button className="secondary-btn" disabled={saving} onClick={() => void migrate(schema)}>Actualizar registros antiguos</button> : null}</div>
              </article>
            )) : <p className="muted-copy">Todavía no hay fichas personalizadas. Puedes comenzar con una plantilla arriba.</p>}
          </div>
        </section>
      </main>
    </div>
    </ModuleGate>
  );
}
