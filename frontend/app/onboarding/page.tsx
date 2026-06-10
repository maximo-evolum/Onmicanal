"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  applyOnboardingExtraction,
  getOnboardingKnowledge,
  OnboardingExtraction,
  saveOnboardingProfile,
  uploadOnboardingFiles
} from "../../lib/api";

type OnboardingForm = {
  businessName: string;
  industry: string;
  description: string;
  tone: string;
  objective: string;
  restrictions: string;
};

type ProductDraft = NonNullable<OnboardingExtraction["products"]>[number];
type FaqDraft = NonNullable<OnboardingExtraction["faqs"]>[number];

const emptyForm: OnboardingForm = {
  businessName: "",
  industry: "",
  description: "",
  tone: "cercano, claro y orientado a la venta",
  objective: "responder consultas, recomendar productos/servicios, resolver dudas y avanzar hacia venta o agendamiento",
  restrictions: "No inventar precios, stock, disponibilidad ni políticas. Si falta información, pedir confirmación a un humano."
};

const industryExamples = [
  "Ecommerce",
  "Clínica / Salud",
  "Servicios profesionales",
  "Restaurante / Eventos",
  "Educación",
  "Automotriz",
  "Inmobiliaria",
  "Venta Web"
];

const steps = [
  { id: 1, title: "Perfil", subtitle: "Personalidad y reglas" },
  { id: 2, title: "Archivos", subtitle: "CSV, Excel, PDF o TXT" },
  { id: 3, title: "Revisión", subtitle: "Datos extraídos" },
  { id: 4, title: "Aplicar", subtitle: "Activar IA del cliente" }
];

function asList(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) return value.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function createEmptyExtraction(form: OnboardingForm): OnboardingExtraction {
  return {
    business: {
      name: form.businessName || null,
      industry: form.industry || null,
      tone: form.tone || null,
      objective: form.objective || null,
      description: form.description || null
    },
    products: [],
    faqs: [],
    policies: asList(form.restrictions),
    suggestedTone: form.tone,
    summary: "Perfil IA creado manualmente sin archivos. Puedes aplicar esta configuración o subir documentos para enriquecerla.",
    warnings: ["No se subieron archivos. La IA usará solo el perfil manual cargado."],
    usedAI: false,
    fileResults: []
  };
}

function formatMoney(value?: number) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "Sin precio";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(number);
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingForm>(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [existing, setExisting] = useState<any>(null);
  const [extraction, setExtraction] = useState<OnboardingExtraction | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceProducts, setReplaceProducts] = useState(false);
  const [replaceFaqs, setReplaceFaqs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.style.overflowY = "auto";
    document.body.style.overflowY = "auto";
    return () => {
      document.documentElement.style.overflowY = "";
      document.body.style.overflowY = "";
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    getOnboardingKnowledge()
      .then((data) => {
        if (!mounted) return;
        setExisting(data);
        const tenant = data?.tenant;
        const profile = data?.profile;
        const settings = tenant?.aiSettings || {};
        setForm((current) => ({
          ...current,
          businessName: tenant?.name || current.businessName,
          industry: tenant?.industry || profile?.industry || settings?.industry || current.industry,
          description: tenant?.businessPrompt || profile?.basePersona || settings?.personality || current.description,
          tone: profile?.tone || settings?.tone || current.tone,
          objective: profile?.objective || settings?.objective || current.objective,
          restrictions: asList(profile?.businessRules).join("\n") || asList(settings?.businessRules).join("\n") || asList(settings?.policies).join("\n") || current.restrictions
        }));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar el estado actual del onboarding.");
      });
    return () => { mounted = false; };
  }, []);

  const stats = useMemo(() => ({
    products: extraction?.products?.length || 0,
    faqs: extraction?.faqs?.length || 0,
    policies: extraction?.policies?.length || 0,
    existingProducts: existing?.products?.length || 0,
    existingRules: existing?.rules?.length || 0,
    imports: existing?.imports?.length || 0
  }), [extraction, existing]);

  const canApply = Boolean(extraction && (form.businessName || extraction?.business?.name));

  function updateField(key: keyof OnboardingForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateProduct(index: number, patch: Partial<ProductDraft>) {
    setExtraction((current) => {
      if (!current) return current;
      const products = [...(current.products || [])];
      products[index] = { ...products[index], ...patch };
      return { ...current, products };
    });
  }

  function updateFaq(index: number, patch: Partial<FaqDraft>) {
    setExtraction((current) => {
      if (!current) return current;
      const faqs = [...(current.faqs || [])];
      faqs[index] = { ...faqs[index], ...patch };
      return { ...current, faqs };
    });
  }

  function updatePolicy(index: number, value: string) {
    setExtraction((current) => {
      if (!current) return current;
      const policies = [...(current.policies || [])];
      policies[index] = value;
      return { ...current, policies };
    });
  }

  async function saveProfile(goNext = true) {
    if (!form.businessName.trim()) {
      setError("Indica el nombre del negocio antes de guardar.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const data = await saveOnboardingProfile(form);
      setExisting((current: any) => ({ ...(current || {}), tenant: data?.tenant, profile: data?.profile }));
      setMessage("Perfil IA guardado correctamente en el tenant.");
      if (goNext) setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el perfil");
    } finally {
      setLoading(false);
    }
  }

  async function extractFiles() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (!files.length) {
        const manualExtraction = createEmptyExtraction(form);
        setImportId(null);
        setExtraction(manualExtraction);
        setMessage("Perfil manual preparado. Puedes revisar y aplicar, o volver para subir archivos.");
        setStep(3);
        return;
      }
      const result = await uploadOnboardingFiles({ files, ...form });
      setImportId(result.importId);
      setExtraction(result.extraction);
      setMessage(result.extraction.usedAI ? "Extracción IA completada. Revisa antes de aplicar." : "Extracción básica completada. Revisa y ajusta antes de aplicar.");
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
      setMessage(`Onboarding aplicado: ${result.createdProducts || 0} productos/servicios, ${result.createdFaqs || 0} FAQs y ${result.policiesCount || 0} políticas.`);
      const data = await getOnboardingKnowledge().catch(() => null);
      if (data) setExisting(data);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el onboarding");
    } finally {
      setLoading(false);
    }
  }

  function resetWizard() {
    setStep(1);
    setFiles([]);
    setExtraction(null);
    setImportId(null);
    setReplaceProducts(false);
    setReplaceFaqs(false);
    setMessage(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="onboarding-page onboarding-pro-page">
      <section className="onboarding-pro-hero">
        <div>
          <span className="badge accent">Wizard Onboarding IA</span>
          <h1>Entrena tu IA</h1>
          <p>
            Configura el perfil comercial del tenant, sube documentos y aplica conocimiento para que Bot Lab, Inbox y respuestas automáticas usen datos reales del negocio.
          </p>
        </div>
        <div className="onboarding-hero-actions">
          <Link className="ghost-btn" href="/inbox">Ir al Inbox</Link>
                  </div>
      </section>

      <section className="onboarding-status-panel">
        <article><strong>{existing?.tenant?.name || form.businessName || "Cliente"}</strong><span>Tenant actual</span></article>
        <article><strong>{existing?.tenant?.onboardingCompleted ? "Completo" : "Pendiente"}</strong><span>Estado onboarding</span></article>
        <article><strong>{stats.existingProducts}</strong><span>Productos/servicios cargados</span></article>
        <article><strong>{stats.existingRules}</strong><span>Reglas / FAQs activas</span></article>
        <article><strong>{stats.imports}</strong><span>Importaciones recientes</span></article>
      </section>

      <section className="onboarding-steps">
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`onboarding-step ${step === item.id ? "active" : ""} ${step > item.id ? "done" : ""}`}
            onClick={() => setStep(item.id)}
          >
            <span>{item.id}</span>
            <strong>{item.title}</strong>
            <small>{step > item.id ? "Completado" : item.subtitle}</small>
          </button>
        ))}
      </section>

      {message && <div className="status success onboarding-status-message">{message}</div>}
      {error && <div className="status danger onboarding-status-message">{error}</div>}

      {step === 1 && (
        <section className="onboarding-workspace-grid">
          <div className="panel-card onboarding-main-card">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Paso 1</p>
                <h2>Perfil comercial del cliente</h2>
                <p className="meta-line">Estos datos definen la personalidad, objetivo y reglas de la IA para este tenant.</p>
              </div>
              <button className="primary-btn" onClick={() => saveProfile(false)} disabled={loading}>{loading ? "Guardando..." : "Guardar perfil"}</button>
            </div>

            <div className="form-grid onboarding-form-grid">
              <label>Nombre del negocio<input value={form.businessName} onChange={(e) => updateField("businessName", e.target.value)} placeholder="Ej: Bendo" /></label>
              <label>Rubro<input value={form.industry} onChange={(e) => updateField("industry", e.target.value)} placeholder="Ej: Ecommerce, clínica, restaurante" /></label>
              <label>Objetivo IA<input value={form.objective} onChange={(e) => updateField("objective", e.target.value)} /></label>
              <label>Tono<input value={form.tone} onChange={(e) => updateField("tone", e.target.value)} /></label>
            </div>

            <div className="quick-chip-row">
              {industryExamples.map((item) => <button key={item} type="button" className="chip-button" onClick={() => updateField("industry", item)}>{item}</button>)}
            </div>

            <label className="block-label">Descripción del negocio<textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} rows={5} placeholder="Qué vende, a quién atiende, propuesta de valor, horarios, zonas, condiciones comerciales..." /></label>
            <label className="block-label">Restricciones y políticas base<textarea value={form.restrictions} onChange={(e) => updateField("restrictions", e.target.value)} rows={5} placeholder="Una regla por línea: no inventar precios, derivar casos complejos, políticas de devolución, etc." /></label>

            <div className="onboarding-footer-actions">
              <button className="primary-btn" onClick={() => saveProfile(true)} disabled={loading}>{loading ? "Guardando..." : "Guardar y continuar"}</button>
            </div>
          </div>

          <aside className="panel-card onboarding-side-card">
            <h3>Qué usa la IA desde este perfil</h3>
            <ul className="onboarding-checklist">
              <li>Rubro y contexto del negocio.</li>
              <li>Tono y estilo de respuesta.</li>
              <li>Objetivo comercial del agente.</li>
              <li>Reglas para no inventar datos.</li>
              <li>Base para Inbox, Bot Lab y respuestas automáticas.</li>
            </ul>
          </aside>
        </section>
      )}

      {step === 2 && (
        <section className="onboarding-workspace-grid">
          <div className="panel-card onboarding-main-card">
            <p className="eyebrow">Paso 2</p>
            <h2>Subir catálogo, precios, FAQs o documentos</h2>
            <p className="meta-line">Acepta CSV, Excel, PDF y TXT. Puedes subir catálogos, listas de precios, políticas, preguntas frecuentes, manuales internos o documentos del negocio.</p>

            <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
              <strong>Seleccionar archivos</strong>
              <span>CSV, XLSX, XLS, PDF o TXT · hasta 8 archivos · 150 MB FREE · 350 MB BUSINESS · 850 MB ENTERPRISE</span>
              <input ref={fileInputRef} type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.txt" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </div>

            <div className="file-list-grid">
              {files.length ? files.map((file) => (
                <article key={`${file.name}-${file.size}`}>
                  <strong>{file.name}</strong>
                  <span>{Math.round(file.size / 1024)} KB</span>
                </article>
              )) : <p className="meta-line">Todavía no hay archivos seleccionados. También puedes continuar solo con el perfil manual.</p>}
            </div>

            <div className="onboarding-footer-actions">
              <button className="ghost-btn" onClick={() => setStep(1)}>Volver</button>
              <button className="primary-btn" onClick={extractFiles} disabled={loading}>{loading ? "Analizando..." : files.length ? "Extraer con IA" : "Continuar sin archivos"}</button>
            </div>
          </div>

          <aside className="panel-card onboarding-side-card">
            <h3>Recomendación de carga</h3>
            <ul className="onboarding-checklist">
              <li>Excel/CSV para productos, precios y stock.</li>
              <li>PDF/TXT para políticas, garantías y condiciones.</li>
              <li>FAQs para mejorar respuestas rápidas.</li>
              <li>No subir archivos con datos sensibles innecesarios.</li>
            </ul>
          </aside>
        </section>
      )}

      {step === 3 && extraction && (
        <section className="panel-card onboarding-main-card onboarding-review-card">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Paso 3</p>
              <h2>Revisión antes de aplicar</h2>
              <p className="meta-line">Puedes ajustar información extraída antes de guardarla en el tenant.</p>
            </div>
            <span className={`badge ${extraction.usedAI ? "accent" : ""}`}>{extraction.usedAI ? "Extracción IA" : "Extracción básica"}</span>
          </div>

          <section className="onboarding-status-panel compact">
            <article><strong>{stats.products}</strong><span>Productos/servicios</span></article>
            <article><strong>{stats.faqs}</strong><span>FAQs</span></article>
            <article><strong>{stats.policies}</strong><span>Políticas</span></article>
          </section>

          <div className="review-summary-box">
            <h3>Resumen</h3>
            <p>{extraction.summary || "Sin resumen"}</p>
            {(extraction.warnings || []).map((warning) => <div key={warning} className="status danger">{warning}</div>)}
          </div>

          <div className="review-section">
            <div className="section-heading-row compact-row">
              <h3>Productos / servicios detectados</h3>
              <button className="ghost-btn" type="button" onClick={() => setExtraction((current) => ({ ...(current || createEmptyExtraction(form)), products: [...(current?.products || []), { name: "Nuevo producto/servicio", description: "", price: 0, stock: 0, category: "", location: "", attributes: { source: "manual" } }] }))}>Agregar</button>
            </div>
            <div className="onboarding-table-scroll">
              <table>
                <thead><tr><th>Nombre</th><th>Descripción</th><th>Precio</th><th>Stock</th><th>Categoría</th></tr></thead>
                <tbody>
                  {(extraction.products || []).slice(0, 50).map((product, index) => (
                    <tr key={`${product.name}-${index}`}>
                      <td><input value={product.name || ""} onChange={(e) => updateProduct(index, { name: e.target.value })} /></td>
                      <td><input value={product.description || ""} onChange={(e) => updateProduct(index, { description: e.target.value })} /></td>
                      <td><input type="number" value={product.price || 0} onChange={(e) => updateProduct(index, { price: Number(e.target.value || 0) })} /><small>{formatMoney(product.price)}</small></td>
                      <td><input type="number" value={product.stock || 0} onChange={(e) => updateProduct(index, { stock: Number(e.target.value || 0) })} /></td>
                      <td><input value={product.category || ""} onChange={(e) => updateProduct(index, { category: e.target.value })} /></td>
                    </tr>
                  ))}
                  {!(extraction.products || []).length && <tr><td colSpan={5}>No se detectaron productos. Puedes aplicar solo perfil, FAQs o políticas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="review-section two-columns">
            <div>
              <div className="section-heading-row compact-row"><h3>FAQs</h3><button className="ghost-btn" type="button" onClick={() => setExtraction((current) => ({ ...(current || createEmptyExtraction(form)), faqs: [...(current?.faqs || []), { question: "Nueva pregunta", answer: "Nueva respuesta" }] }))}>Agregar</button></div>
              <div className="faq-edit-list">
                {(extraction.faqs || []).slice(0, 30).map((faq, index) => (
                  <article key={`${faq.question}-${index}`} className="onboarding-card">
                    <input value={faq.question || ""} onChange={(e) => updateFaq(index, { question: e.target.value })} />
                    <textarea rows={3} value={faq.answer || ""} onChange={(e) => updateFaq(index, { answer: e.target.value })} />
                  </article>
                ))}
                {!(extraction.faqs || []).length && <p className="meta-line">No hay FAQs detectadas.</p>}
              </div>
            </div>
            <div>
              <div className="section-heading-row compact-row"><h3>Políticas</h3><button className="ghost-btn" type="button" onClick={() => setExtraction((current) => ({ ...(current || createEmptyExtraction(form)), policies: [...(current?.policies || []), "Nueva política"] }))}>Agregar</button></div>
              <div className="faq-edit-list">
                {(extraction.policies || []).slice(0, 40).map((policy, index) => (
                  <textarea key={`${policy}-${index}`} rows={3} value={policy} onChange={(e) => updatePolicy(index, e.target.value)} />
                ))}
                {!(extraction.policies || []).length && <p className="meta-line">No hay políticas detectadas.</p>}
              </div>
            </div>
          </div>

          <div className="apply-options-box">
            <label className="check-row"><input type="checkbox" checked={replaceProducts} onChange={(e) => setReplaceProducts(e.target.checked)} /> Reemplazar productos/servicios existentes</label>
            <label className="check-row"><input type="checkbox" checked={replaceFaqs} onChange={(e) => setReplaceFaqs(e.target.checked)} /> Reemplazar FAQs existentes</label>
          </div>

          <div className="onboarding-footer-actions">
            <button className="ghost-btn" onClick={() => setStep(2)}>Volver</button>
            <button className="primary-btn" onClick={applyExtraction} disabled={loading || !canApply}>{loading ? "Aplicando..." : "Aplicar al cliente"}</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="panel-card onboarding-main-card finish-card">
          <span className="badge accent">IA del cliente lista</span>
          <h2>Onboarding aplicado correctamente</h2>
          <p className="meta-line">La IA ya tiene perfil, reglas, productos/servicios, FAQs y políticas del cliente. Ahora puedes validar respuestas reales en Bot Lab y luego operar desde Inbox.</p>
          <div className="onboarding-status-panel compact">
            <article><strong>{existing?.tenant?.onboardingCompleted ? "Sí" : "En proceso"}</strong><span>Marcado como completo</span></article>
            <article><strong>{existing?.products?.length || 0}</strong><span>Productos en BD</span></article>
            <article><strong>{existing?.rules?.length || 0}</strong><span>Reglas / FAQs en BD</span></article>
          </div>
          <div className="header-actions">
            <Link className="ghost-btn" href="/inbox">Ir al Inbox</Link>
            <button className="ghost-btn" onClick={resetWizard}>Nuevo onboarding</button>
          </div>
        </section>
      )}
    </main>
  );
}
