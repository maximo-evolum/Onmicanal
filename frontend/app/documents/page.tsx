"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AccountPill } from "@/components/account-pill";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { deleteTenantDocument, getTenantDocuments, type TenantDocument, uploadTenantDocuments } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

function formatSize(size?: number) {
  if (!size) return "Tamaño no informado";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Operación");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadDocuments() {
    setLoading(true);
    try {
      const response = await getTenantDocuments();
      setDocuments(response.documents || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los documentos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDocuments(); }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setMessage("Selecciona al menos un archivo para cargar.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await uploadTenantDocuments({ files, title: title.trim() || undefined, category, description: description.trim() || undefined });
      setFiles([]);
      setTitle("");
      setDescription("");
      if (fileInput.current) fileInput.current.value = "";
      setMessage("Documento guardado y disponible para el equipo.");
      await loadDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir el archivo. Revisa tu conexión e inténtalo nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(document: TenantDocument) {
    if (!window.confirm(`¿Eliminar “${document.title || "este documento"}”?`)) return;
    setSaving(true);
    try {
      await deleteTenantDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setMessage("Documento eliminado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar el documento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleGate moduleKey="documents">
      <div className={`module-with-menu-shell documents-workspace ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Documentos" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} showNotificationCenter={false} />
        <main className="documents-page">
          <header className="documents-header">
            <div><span className="documents-eyebrow">ARCHIVOS DEL EQUIPO</span><h1>Documentos</h1><p>Centraliza archivos de operación, respaldo y conocimiento del equipo.</p></div>
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </header>
          {message ? <div className="documents-message" role="status">{message}</div> : null}
          <section className="documents-layout">
            <form className="documents-upload-card" onSubmit={upload}>
              <span className="documents-eyebrow">NUEVO ARCHIVO</span>
              <h2>Subir documento</h2>
              <p>El archivo queda disponible solo para las personas autorizadas de esta cuenta.</p>
              <label>Título visible<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Manual comercial agosto" /></label>
              <label>Categoría<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Operación</option><option>Comercial</option><option>Finanzas</option><option>Respaldo</option><option>Conocimiento IA</option></select></label>
              <label>Descripción opcional<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Indica para qué sirve este archivo" rows={3} /></label>
              <label className="documents-file-input"><strong>{files.length ? `${files.length} archivo(s) seleccionado(s)` : "Seleccionar archivos"}</strong><small>PDF, Excel, Word, CSV, imágenes o texto</small><input ref={fileInput} type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.txt,.doc,.docx,image/*" onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar documentos"}</button>
            </form>
            <section className="documents-list-card">
              <div className="documents-list-heading"><div><span className="documents-eyebrow">BIBLIOTECA</span><h2>Archivos cargados</h2></div><button type="button" className="ghost-btn" onClick={() => void loadDocuments()} disabled={loading}>Actualizar</button></div>
              {loading ? <p className="documents-empty">Cargando documentos...</p> : null}
              {!loading && !documents.length ? <p className="documents-empty">Aún no hay archivos cargados. Usa el formulario para crear la primera biblioteca del equipo.</p> : null}
              <div className="documents-list">
                {documents.map((document) => {
                  const data = document.data || {};
                  return <article className="documents-row" key={document.id}><div className="documents-file-badge">{String(data.category || "Archivo").slice(0, 2).toUpperCase()}</div><div><strong>{document.title || data.originalName || "Documento"}</strong><span>{data.category || "Sin categoría"} · {formatSize(data.size)} · {new Date(document.updatedAt || document.createdAt).toLocaleDateString("es-CL")}</span>{data.description ? <small>{data.description}</small> : null}</div><div className="documents-row-actions">{data.url ? <a className="ghost-btn" href={data.url} target="_blank" rel="noreferrer">Abrir</a> : null}<button type="button" className="ghost-btn danger" disabled={saving} onClick={() => void remove(document)}>Eliminar</button></div></article>;
                })}
              </div>
            </section>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
