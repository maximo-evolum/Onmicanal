"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  applyOnboardingExtraction,
  getOnboardingKnowledge,
  OnboardingExtraction,
  saveOnboardingProfile,
  uploadOnboardingFiles
} from "../../lib/api";

const emptyForm = {
  businessName: "",
  industry: "",
  description: "",
  tone: "cercano, claro y orientado a la venta",
  objective: "responder consultas, recomendar productos y cerrar ventas",
  restrictions: "No inventar precios, stock ni políticas. Si falta información, pedir confirmación a un humano."
};

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [extraction, setExtraction] = useState<OnboardingExtraction | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceProducts, setReplaceProducts] = useState(false);
  const [replaceFaqs, setReplaceFaqs] = useState(false);

  useEffect(() => {
    getOnboardingKnowledge()
      .then((data) => {
        const tenant = data?.tenant;
        const profile = data?.profile;
        setForm((current) => ({
          ...current,
          businessName: tenant?.name || current.businessName,
          industry: tenant?.industry || profile?.industry || current.industry,
          description: tenant?.businessPrompt || profile?.basePersona || current.description,
          tone: profile?.tone || data?.tenant?.aiSettings?.tone || current.tone,
          objective: profile?.objective || data?.tenant?.aiSettings?.objective || current.objective,
          restrictions: Array.isArray(profile?.businessRules) ? profile.businessRules.join("\n") : current.restrictions
        }));
      })
      .catch(() => null);
  }, []);

  const stats = useMemo(() => ({
    products: extraction?.products?.length || 0,
    faqs: extraction?.faqs?.length || 0,
    policies: extraction?.policies?.length || 0
  }), [extraction]);

  function updateField(key: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveProfile() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await saveOnboardingProfile(form);
      setMessage("Perfil IA guardado correctamente.");
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el perfil");
    } finally {
      setLoading(false);
    }
  }

  async function extractFiles() {
    if (!files.length) {
      setError("Sube al menos un CSV, Excel, PDF o TXT.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadOnboardingFiles({ files, ...form });
      setImportId(result.importId);
      setExtraction(result.extraction);
      setMessage(result.extraction.usedAI ? "Extracción IA completada." : "Extracción básica completada. Revisa y ajusta antes de aplicar.");
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar la información");
    } finally {
      setLoading(false);
    }
  }

  async function applyExtraction() {
    if (!extraction) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyOnboardingExtraction({ importId: importId || undefined, extraction, replaceProducts, replaceFaqs });
      setMessage(`Onboarding aplicado: ${result.createdProducts || 0} productos, ${result.createdFaqs || 0} FAQs y ${result.policiesCount || 0} políticas.`);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el onboarding");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-hero">
        <span className="badge accent">Wizard Onboarding IA</span>
        <h1 className="brand-title" style={{ fontSize: 34 }}>Entrena la IA del cliente con formularios y archivos</h1>
        <p className="meta-line" style={{ fontSize: 14, maxWidth: 820 }}>
          Completa el perfil del negocio, sube catálogo/CSV/Excel/PDF y aplica productos, FAQs, precios, tono y políticas al workspace actual.
        </p>
        <div className="header-actions">
          <Link className="ghost-btn" href="/inbox">Ir al Inbox</Link>
          <Link className="ghost-btn" href="/dev/bot-lab">Probar Bot Lab</Link>
        </div>
      </section>

      <section className="onboarding-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {["Perfil", "Archivos", "Revisión", "Listo"].map((label, index) => (
          <article key={label} className="onboarding-card" style={{ borderColor: step === index + 1 ? "rgba(37, 99, 235, .5)" : undefined }}>
            <strong>{index + 1}. {label}</strong>
            <p className="meta-line">{step > index + 1 ? "Completado" : step === index + 1 ? "En curso" : "Pendiente"}</p>
          </article>
        ))}
      </section>

      {message && <div className="status success">{message}</div>}
      {error && <div className="status danger">{error}</div>}

      {step === 1 && (
        <section className="panel-card" style={{ padding: 24 }}>
          <h2>1. Perfil comercial del cliente</h2>
          <div className="form-grid">
            <label>Nombre del negocio<input value={form.businessName} onChange={(e) => updateField("businessName", e.target.value)} placeholder="Ej: Urban Fit" /></label>
            <label>Rubro<input value={form.industry} onChange={(e) => updateField("industry", e.target.value)} placeholder="Ej: Ecommerce de suplementos" /></label>
            <label>Objetivo IA<input value={form.objective} onChange={(e) => updateField("objective", e.target.value)} /></label>
            <label>Tono<input value={form.tone} onChange={(e) => updateField("tone", e.target.value)} /></label>
          </div>
          <label className="block-label">Descripción del negocio<textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} rows={4} placeholder="Qué vende, público objetivo, propuesta de valor..." /></label>
          <label className="block-label">Restricciones<textarea value={form.restrictions} onChange={(e) => updateField("restrictions", e.target.value)} rows={3} /></label>
          <button className="primary-btn" onClick={saveProfile} disabled={loading}>{loading ? "Guardando..." : "Guardar y continuar"}</button>
        </section>
      )}

      {step === 2 && (
        <section className="panel-card" style={{ padding: 24 }}>
          <h2>2. Subir catálogo y documentos</h2>
          <p className="meta-line">Acepta CSV, Excel, PDF y TXT. Puedes subir catálogos, listas de precios, políticas, FAQs o documentos internos.</p>
          <input
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.pdf,.txt"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <div style={{ marginTop: 16 }}>
            {files.map((file) => <div key={file.name} className="meta-line">• {file.name} ({Math.round(file.size / 1024)} KB)</div>)}
          </div>
          <div className="header-actions" style={{ marginTop: 20 }}>
            <button className="ghost-btn" onClick={() => setStep(1)}>Volver</button>
            <button className="primary-btn" onClick={extractFiles} disabled={loading}>{loading ? "Analizando..." : "Extraer con IA"}</button>
          </div>
        </section>
      )}

      {step === 3 && extraction && (
        <section className="panel-card" style={{ padding: 24 }}>
          <h2>3. Revisión antes de aplicar</h2>
          <div className="onboarding-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <article className="onboarding-card"><strong>{stats.products}</strong><p className="meta-line">Productos detectados</p></article>
            <article className="onboarding-card"><strong>{stats.faqs}</strong><p className="meta-line">FAQs detectadas</p></article>
            <article className="onboarding-card"><strong>{stats.policies}</strong><p className="meta-line">Políticas detectadas</p></article>
          </div>

          <h3>Resumen</h3>
          <p className="meta-line">{extraction.summary || "Sin resumen"}</p>
          {extraction.warnings?.map((warning) => <p key={warning} className="status danger">{warning}</p>)}

          <h3>Productos</h3>
          <div className="table-wrap"><table><thead><tr><th>Nombre</th><th>Precio</th><th>Stock</th><th>Categoría</th></tr></thead><tbody>{(extraction.products || []).slice(0, 20).map((p, i) => <tr key={`${p.name}-${i}`}><td>{p.name}</td><td>{p.price || 0}</td><td>{p.stock || 0}</td><td>{p.category || "-"}</td></tr>)}</tbody></table></div>

          <h3>FAQs</h3>
          {(extraction.faqs || []).slice(0, 10).map((faq, i) => <article key={i} className="onboarding-card"><strong>{faq.question}</strong><p className="meta-line">{faq.answer}</p></article>)}

          <h3>Políticas</h3>
          <ul>{(extraction.policies || []).slice(0, 20).map((policy, i) => <li key={i}>{policy}</li>)}</ul>

          <label className="check-row"><input type="checkbox" checked={replaceProducts} onChange={(e) => setReplaceProducts(e.target.checked)} /> Reemplazar productos existentes</label>
          <label className="check-row"><input type="checkbox" checked={replaceFaqs} onChange={(e) => setReplaceFaqs(e.target.checked)} /> Reemplazar FAQs existentes</label>

          <div className="header-actions" style={{ marginTop: 20 }}>
            <button className="ghost-btn" onClick={() => setStep(2)}>Volver</button>
            <button className="primary-btn" onClick={applyExtraction} disabled={loading}>{loading ? "Aplicando..." : "Aplicar al cliente"}</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="panel-card" style={{ padding: 24 }}>
          <h2>4. Onboarding listo</h2>
          <p className="meta-line">La IA ya tiene perfil, productos, FAQs, precios y políticas del cliente. Ahora puedes probar respuestas en Bot Lab.</p>
          <div className="header-actions">
            <Link className="primary-btn" href="/dev/bot-lab">Probar IA</Link>
            <Link className="ghost-btn" href="/settings/ai">Ver configuración IA</Link>
            <button className="ghost-btn" onClick={() => { setExtraction(null); setFiles([]); setStep(1); }}>Nuevo onboarding</button>
          </div>
        </section>
      )}
    </main>
  );
}
