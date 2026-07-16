"use client";

import { useEffect, useState } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { createMetadataSchema, getMetadataSchemas, migrateMetadataSchema, publishMetadataSchema, type MetadataSchema } from "@/lib/api";

const exampleFields = JSON.stringify({
  address: { type: "string", required: true, sensitivity: "INTERNAL", purpose: "Operacion comercial", retentionDays: 1825 },
  price: { type: "number", required: true, sensitivity: "CONFIDENTIAL", purpose: "Gestion comercial", accessRoles: ["OWNER", "ADMIN", "AGENT"] }
}, null, 2);

export default function MetadataSettingsPage() {
  const [schemas, setSchemas] = useState<MetadataSchema[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recordType, setRecordType] = useState("property");
  const [label, setLabel] = useState("Propiedad");
  const [fields, setFields] = useState(exampleFields);
  const [strict, setStrict] = useState(false);
  const [allowUnknown, setAllowUnknown] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const response = await getMetadataSchemas();
    setSchemas(response.schemas || []);
  }

  useEffect(() => { void reload().catch((error) => setStatus(error instanceof Error ? error.message : "No se pudieron cargar los esquemas")); }, []);

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setStatus(null);
      const parsed = JSON.parse(fields);
      const response = await createMetadataSchema({ recordType, label, fields: parsed, policies: { enforcement: strict ? "STRICT" : "COMPATIBLE", allowUnknown } });
      setStatus(`Borrador v${response.schema.version} creado.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Revisa el JSON de campos.");
    } finally { setSaving(false); }
  }

  async function publish(id: string) {
    try {
      setSaving(true); setStatus(null);
      const response = await publishMetadataSchema(id);
      setStatus(`${response.schema.label} v${response.schema.version} está publicado.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo publicar el esquema.");
    } finally { setSaving(false); }
  }

  async function migrate(schema: MetadataSchema) {
    try {
      setSaving(true); setStatus(null);
      const core = ["lead", "booking", "payment"].includes(schema.recordType);
      const preview = await migrateMetadataSchema(schema.id, { core });
      const count = preview.records?.length || 0;
      if (!count) { setStatus("No hay registros pendientes de migrar."); return; }
      if (!window.confirm(`Se migrarán ${count} registros a v${preview.targetVersion}. ¿Continuar?`)) { setStatus("Migración cancelada después de la vista previa."); return; }
      const applied = await migrateMetadataSchema(schema.id, { core, apply: true });
      setStatus(`Migración aplicada: ${applied.migrated || 0} registros.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo migrar."); }
    finally { setSaving(false); }
  }

  return <div className="inbox-page-shell">
    <EvolumSidebar active="Esquemas de datos" isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
    <main className="inbox-main">
      <header className="inbox-topbar"><div><span className="eyebrow">METADATOS V1</span><h1>Esquemas de datos</h1><p>Publica reglas por entidad sin interrumpir la operación actual.</p></div><AccountPill /></header>
      {status && <p className="module-note">{status}</p>}
      <section className="vertical-card">
        <div className="vertical-card-head"><div><span>NUEVO BORRADOR</span><h2>Definir entidad y políticas</h2></div></div>
        <form onSubmit={createDraft} className="form-stack">
          <div className="form-row"><input value={recordType} onChange={(event) => setRecordType(event.target.value)} placeholder="Tipo: property" required /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Etiqueta" required /></div>
          <textarea value={fields} onChange={(event) => setFields(event.target.value)} rows={12} spellCheck={false} aria-label="Campos JSON" />
          <div className="form-row"><label><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} /> Validación estricta</label><label><input type="checkbox" checked={allowUnknown} onChange={(event) => setAllowUnknown(event.target.checked)} /> Permitir campos no definidos</label><button className="primary-btn" disabled={saving}>Crear borrador</button></div>
        </form>
      </section>
      <section className="vertical-card"><div className="vertical-card-head"><div><span>VERSIONES</span><h2>Esquemas del tenant</h2></div></div>
        <div className="vertical-list">{schemas.length ? schemas.map((schema) => <article key={schema.id}><div><strong>{schema.label} · {schema.recordType}</strong><p>v{schema.version} · {schema.status} · {Object.keys(schema.fields || {}).length} campos</p><small>{String(schema.policies?.enforcement || "COMPATIBLE")} · desconocidos: {schema.policies?.allowUnknown === false ? "bloqueados" : "permitidos"}</small></div>{schema.status === "DRAFT" ? <button className="primary-btn" disabled={saving} onClick={() => void publish(schema.id)}>Publicar</button> : schema.status === "PUBLISHED" ? <button className="secondary-btn" disabled={saving} onClick={() => void migrate(schema)}>Migrar datos</button> : null}</article>) : <p className="muted-copy">Aún no existen esquemas propios. Las entidades usan la plantilla de su rubro.</p>}</div>
      </section>
    </main>
  </div>;
}
