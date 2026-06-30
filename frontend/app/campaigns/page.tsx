"use client";

import { useEffect, useMemo, useState } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { AccountPill } from "@/components/account-pill";
import { ModuleGate } from "@/components/module-gate";
import { generateCampaignCopy, generateCampaignImages, generateCampaignPro, getCampaignJob, getConversations, publishCampaign, CampaignPlatform, CampaignVariant, CampaignProResult } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { Conversation } from "@/lib/types";

const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp"
};

const PLATFORM_HELP: Record<CampaignPlatform, string> = {
  instagram: "Post visual",
  facebook: "Post en página",
  whatsapp: "Mensaje/campaña"
};

const ALL_PLATFORMS: CampaignPlatform[] = ["instagram", "facebook", "whatsapp"];

function togglePlatform(current: CampaignPlatform[], platform: CampaignPlatform) {
  if (current.includes(platform)) return current.filter((item) => item !== platform);
  return [...current, platform];
}

function normalizeCampaignPhone(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits.length >= 8 ? digits : "";
}

function phoneFromConversation(conversation: Conversation) {
  if (conversation.contact?.channel !== "whatsapp") return "";
  return normalizeCampaignPhone(conversation.contact.externalId || conversation.contact.username || conversation.contact.name || "");
}

export default function CampaignsPage() {
  const agent = getStoredSession();
  const [product, setProduct] = useState("");
  const [idea, setIdea] = useState("");
  const [visualTitle, setVisualTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [cta, setCta] = useState("");
  const [platforms, setPlatforms] = useState<CampaignPlatform[]>(["instagram"]);
  const [whatsappRecipientsText, setWhatsappRecipientsText] = useState("");
  const [useInboxWhatsappRecipients, setUseInboxWhatsappRecipients] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientImportMessage, setRecipientImportMessage] = useState<string | null>(null);
  const [variantCount, setVariantCount] = useState<number>(2);
  const [quickMode, setQuickMode] = useState<boolean>(false);
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [copyLoading, setCopyLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [campaignJobId, setCampaignJobId] = useState<string | null>(null);
  const [campaignJobProgress, setCampaignJobProgress] = useState<number>(0);
  const [campaignJobMessage, setCampaignJobMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishResults, setPublishResults] = useState<Array<{ platform: string; status: string; note?: string; error?: string }> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const selectedVariant = variants[selectedIndex] || null;
  const inboxWhatsappRecipients = useMemo(
    () => [...new Set(conversations.map(phoneFromConversation).filter(Boolean))],
    [conversations]
  );
  const whatsappRecipients = useMemo(
    () => {
      const manual = whatsappRecipientsText
        .split(/[\n,;]/)
        .map(normalizeCampaignPhone)
        .filter(Boolean);
      return [...new Set([
        ...(useInboxWhatsappRecipients ? inboxWhatsappRecipients : []),
        ...manual
      ])];
    },
    [inboxWhatsappRecipients, useInboxWhatsappRecipients, whatsappRecipientsText]
  );

  const previewCaption = useMemo(() => {
    if (!selectedVariant) return caption;
    return `${caption || selectedVariant.caption || selectedVariant.text || ""}${selectedVariant.hashtags ? `\n\n${selectedVariant.hashtags}` : ""}`;
  }, [caption, selectedVariant]);

  useEffect(() => {
    let active = true;

    async function loadWhatsappRecipients() {
      try {
        setRecipientsLoading(true);
        const data = await getConversations();
        if (active) setConversations(data || []);
      } catch {
        if (active) setConversations([]);
      } finally {
        if (active) setRecipientsLoading(false);
      }
    }

    loadWhatsappRecipients();
    return () => {
      active = false;
    };
  }, []);

  async function importWhatsappRecipientsFromInbox() {
    try {
      setRecipientsLoading(true);
      setRecipientImportMessage(null);
      const data = await getConversations();
      const nextConversations = data || [];
      setConversations(nextConversations);

      const detected = [...new Set(nextConversations.map(phoneFromConversation).filter(Boolean))];
      if (!detected.length) {
        setRecipientImportMessage("No se encontraron numeros WhatsApp en el inbox.");
        return;
      }

      const current = whatsappRecipientsText
        .split(/[\n,;]/)
        .map(normalizeCampaignPhone)
        .filter(Boolean);
      const merged = [...new Set([...current, ...detected])];
      setWhatsappRecipientsText(merged.join("\n"));
      setUseInboxWhatsappRecipients(false);
      setRecipientImportMessage(`${detected.length} numeros importados desde el inbox.`);
    } catch {
      setRecipientImportMessage("No se pudieron importar los numeros del inbox.");
    } finally {
      setRecipientsLoading(false);
    }
  }

  function buildPayload() {
    return {
      product,
      idea,
      visualTitle,
      caption,
      cta,
      platforms,
      variantCount: quickMode ? 1 : variantCount,
      quickMode
    };
  }

  function validateCampaignInput() {
    if (!product.trim() && !idea.trim()) {
      setError("Escribe el producto/servicio o la idea de campaña.");
      return false;
    }

    if (platforms.length === 0) {
      setError("Selecciona al menos una plataforma.");
      return false;
    }

    return true;
  }

  async function generateCopyOnly() {
    if (!validateCampaignInput()) return;

    try {
      setCopyLoading(true);
      setError(null);
      setPublishResults(null);

      const data = await generateCampaignCopy(buildPayload());
      const nextVariants = data.variants || [];
      setVariants(nextVariants);
      setSelectedIndex(0);
      setCampaignId(data.campaign?.id);
      if (!visualTitle && nextVariants[0]?.title) setVisualTitle(nextVariants[0].title);
      if (!caption && nextVariants[0]?.caption) setCaption(nextVariants[0].caption);
      if (!cta && nextVariants[0]?.cta) setCta(nextVariants[0].cta || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el copy de campaña");
    } finally {
      setCopyLoading(false);
    }
  }

  function applyCampaignResult(data: CampaignProResult) {
    const nextVariants = data.variants || [];
    setVariants(nextVariants);
    setSelectedIndex(0);
    setCampaignId(data.campaign?.id || campaignId);
    if (!visualTitle && nextVariants[0]?.title) setVisualTitle(nextVariants[0].title);
    if (!caption && nextVariants[0]?.caption) setCaption(nextVariants[0].caption);
    if (!cta && nextVariants[0]?.cta) setCta(nextVariants[0].cta || "");
  }

  async function waitForCampaignJob(jobId: string) {
    setCampaignJobId(jobId);
    setCampaignJobProgress(5);
    setCampaignJobMessage("Generando imágenes en segundo plano...");

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const job = await getCampaignJob(jobId);
      setCampaignJobProgress(job.progress || 0);
      setCampaignJobMessage(job.message || null);

      if (job.status === "COMPLETED") {
        if (job.result) applyCampaignResult(job.result);
        setCampaignJobMessage("Campaña lista");
        return;
      }

      if (job.status === "FAILED") {
        throw new Error(job.error || "La generación de imágenes falló");
      }
    }

    throw new Error("La generación sigue en proceso. Vuelve a consultar en unos segundos.");
  }

  async function generateImagesOnly() {
    if (!validateCampaignInput()) return;

    try {
      setImageLoading(true);
      setError(null);
      setPublishResults(null);
      setCampaignJobProgress(0);
      setCampaignJobMessage(null);

      const baseVariants = variants.length ? variants : undefined;
      const data = await generateCampaignImages({
        ...buildPayload(),
        campaignId,
        variants: baseVariants
      });

      if (data.async && data.jobId) {
        await waitForCampaignJob(data.jobId);
      } else {
        applyCampaignResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron generar imágenes");
    } finally {
      setImageLoading(false);
    }
  }

  async function generate() {
    if (!validateCampaignInput()) return;

    try {
      setFullLoading(true);
      setError(null);
      setPublishResults(null);
      setCampaignJobProgress(0);
      setCampaignJobMessage("Generando copy...");

      const copy = await generateCampaignCopy(buildPayload());
      applyCampaignResult(copy);

      const data = await generateCampaignImages({
        ...buildPayload(),
        campaignId: copy.campaign?.id || campaignId,
        variants: copy.variants
      });

      if (data.async && data.jobId) {
        await waitForCampaignJob(data.jobId);
      } else {
        applyCampaignResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la campaña");
    } finally {
      setFullLoading(false);
    }
  }

  async function publish() {
    if (!selectedVariant) {
      setError("Primero genera y selecciona una variante.");
      return;
    }

    if (platforms.length === 0) {
      setError("Selecciona al menos una plataforma para publicar.");
      return;
    }

    try {
      setPublishing(true);
      setError(null);
      const result = await publishCampaign({
        campaignId,
        product,
        idea,
        visualTitle: visualTitle || selectedVariant.title,
        caption: caption || selectedVariant.caption,
        cta,
        platforms,
        whatsappRecipients,
        selectedVariant: {
          ...selectedVariant,
          title: visualTitle || selectedVariant.title,
          caption: caption || selectedVariant.caption
        },
        variants
      });

      setPublishResults(result.results || []);
      setCampaignId(result.campaign?.id || campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo publicar la campaña");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <ModuleGate moduleKey="campaigns">
    <div className={`module-with-menu-shell campaign-page ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar
        active="Campañas"
        isDeveloper={agent?.role === "SUPER_ADMIN"}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
      />
      <main className="main">
        <header className="module-app-header">
          <div>
            <span className="eyebrow">Marketing IA</span>
            <h1>Campañas IA</h1>
            <div className="meta-line">Crea imagenes, titulos y textos listos para publicar en los canales del cliente.</div>
          </div>
          <div className="module-app-actions">
            <AccountPill fallbackName={agent?.name || "Usuario"} />
          </div>
        </header>

        <div className="campaign-builder-v2">
          <section className="campaign-form-card">
            <div className="campaign-form-grid">
              <label>
                <span>Producto o servicio</span>
                <input
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="Ej: Servicios de Parrilladas"
                />
              </label>

              <label>
                <span>Título visual de la imagen</span>
                <input
                  value={visualTitle}
                  onChange={(e) => setVisualTitle(e.target.value)}
                  placeholder="Ej: Parrilladas Premium para Eventos"
                />
              </label>

              <label className="campaign-full">
                <span>Idea de campaña</span>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  placeholder="Ej: Promocionar eventos familiares de invierno, servicio premium, reservas anticipadas..."
                />
              </label>

              <label className="campaign-full">
                <span>Descripción para redes sociales</span>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                  placeholder="Texto que se publicará como caption o mensaje promocional..."
                />
              </label>

              <label>
                <span>CTA</span>
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="Ej: Reserva tu fecha hoy"
                />
              </label>

              <div className="campaign-platforms">
                <span>Plataformas del cliente</span>
                <div className="platform-button-row">
                  {ALL_PLATFORMS.map((platform) => {
                    const active = platforms.includes(platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        className={active ? "platform-btn active" : "platform-btn"}
                        onClick={() => setPlatforms((current) => togglePlatform(current, platform))}
                      >
                        <strong>{PLATFORM_LABELS[platform]}</strong>
                        <small>{PLATFORM_HELP[platform]}</small>
                      </button>
                    );
                  })}
                </div>
                {platforms.includes("whatsapp") ? (
                  <div className="campaign-whatsapp-recipients">
                    <span>Destinatarios WhatsApp</span>
                    <button
                      type="button"
                      className="campaign-import-recipients"
                      onClick={importWhatsappRecipientsFromInbox}
                      disabled={recipientsLoading}
                    >
                      {recipientsLoading ? "Importando..." : "Importar numeros del inbox"}
                    </button>
                    <label className="campaign-inline-check campaign-recipient-toggle">
                      <input
                        type="checkbox"
                        checked={useInboxWhatsappRecipients}
                        onChange={(e) => setUseInboxWhatsappRecipients(e.target.checked)}
                      />
                      <span>Usar numeros detectados desde el inbox WhatsApp</span>
                    </label>
                    <small>
                      {recipientsLoading
                        ? "Buscando numeros en conversaciones..."
                        : `${inboxWhatsappRecipients.length} numeros detectados desde chats WhatsApp.`}
                    </small>
                    {recipientImportMessage ? <small>{recipientImportMessage}</small> : null}
                    <textarea
                      value={whatsappRecipientsText}
                      onChange={(e) => setWhatsappRecipientsText(e.target.value)}
                      placeholder="Agrega numeros extra separados por coma o salto de linea. Ej: 56912345678"
                    />
                    <small>{whatsappRecipients.length ? `${whatsappRecipients.length} destinatarios listos para enviar.` : "Si lo dejas vacio, WhatsApp quedara preparado sin enviar."}</small>
                  </div>
                ) : null}
              </div>

              <div className="campaign-optimization-panel campaign-full">
                <div>
                  <span>Optimización de generación</span>
                  <small>Primero puedes generar solo el texto y luego las imágenes para ahorrar tiempo y costo.</small>
                </div>

                <div className="campaign-option-row">
                  <label className="campaign-inline-check">
                    <input
                      type="checkbox"
                      checked={quickMode}
                      onChange={(e) => {
                        setQuickMode(e.target.checked);
                        if (e.target.checked) setVariantCount(1);
                      }}
                    />
                    <span>Modo rápido low-cost</span>
                  </label>

                  <label className="campaign-variant-select">
                    <span>Cantidad de variantes</span>
                    <select
                      value={quickMode ? 1 : variantCount}
                      disabled={quickMode}
                      onChange={(e) => setVariantCount(Number(e.target.value))}
                    >
                      <option value={1}>1 imagen rápida</option>
                      <option value={2}>2 variantes</option>
                      <option value={4}>4 variantes</option>
                      <option value={8}>8 variantes</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {error ? <div className="campaign-alert error">{error}</div> : null}

            {(imageLoading || fullLoading || campaignJobId) && campaignJobMessage ? (
              <div className="campaign-job-panel">
                <div className="campaign-job-row">
                  <strong>{campaignJobMessage}</strong>
                  <span>{Math.round(campaignJobProgress)}%</span>
                </div>
                <div className="campaign-job-bar">
                  <div style={{ width: `${Math.min(100, Math.max(5, campaignJobProgress))}%` }} />
                </div>
                <small>La generación continúa en segundo plano para evitar que la página quede congelada.</small>
              </div>
            ) : null}

            <div className="campaign-actions">
              <button className="ghost-btn" onClick={generateCopyOnly} disabled={copyLoading || imageLoading || fullLoading}>
                {copyLoading ? "Generando copy..." : "1. Generar copy"}
              </button>
              <button className="primary-btn" onClick={generateImagesOnly} disabled={copyLoading || imageLoading || fullLoading}>
                {imageLoading ? "Generando imágenes..." : variants.length ? "2. Generar imágenes" : "Generar imágenes"}
              </button>
              <button className="ghost-btn" onClick={generate} disabled={copyLoading || imageLoading || fullLoading}>
                {fullLoading ? "Generando todo..." : "Generar todo"}
              </button>
              <button className="ghost-btn" onClick={publish} disabled={publishing || !selectedVariant || !(selectedVariant.imageUrl || selectedVariant.image)}>
                {publishing ? "Publicando..." : "Publicar campaña"}
              </button>
            </div>

            {(copyLoading || imageLoading || fullLoading) ? (
              <div className="campaign-loading-panel">
                <strong>{imageLoading || fullLoading ? "Generando imágenes IA" : "Generando textos de campaña"}</strong>
                <span>{imageLoading || fullLoading ? "Esto puede tardar más según la cantidad de variantes seleccionadas." : "Esto normalmente tarda pocos segundos."}</span>
              </div>
            ) : null}

            {publishResults ? (
              <div className="campaign-publish-results">
                {publishResults.map((result) => (
                  <div key={result.platform} className={`publish-result ${result.status.toLowerCase()}`}>
                    <strong>{result.platform}</strong>
                    <span>{result.status}</span>
                    {result.note ? <small>{result.note}</small> : null}
                    {result.error ? <small>{result.error}</small> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="campaign-preview-panel">
            <div className="campaign-preview-header">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>Publicación seleccionada</h2>
              </div>
              {selectedVariant ? <span className="badge accent">Variante {selectedIndex + 1}</span> : null}
            </div>

            {selectedVariant ? (
              <div className="campaign-selected-preview">
                {(selectedVariant.imageUrl || selectedVariant.image) ? (
                  <div className="campaign-image-frame">
                    <img src={selectedVariant.imageUrl || selectedVariant.image} alt={visualTitle || selectedVariant.title} />
                  </div>
                ) : (
                  <div className="campaign-image-frame campaign-image-placeholder">
                    <span>Copy listo</span>
                    <small>Genera imágenes cuando apruebes el texto.</small>
                  </div>
                )}
                <div className="campaign-copy-preview">
                  <h3>{visualTitle || selectedVariant.title}</h3>
                  <p>{previewCaption}</p>
                  {cta ? <span className="badge">{cta}</span> : null}
                </div>
              </div>
            ) : (
              <div className="empty-state">Genera una campaña para ver imagen, título y descripción.</div>
            )}
          </section>
        </div>

        <section className="campaign-variants-section">
          <div className="campaign-preview-header">
            <div>
              <p className="eyebrow">Variantes IA</p>
              <h2>Escoge la imagen que más te guste</h2>
            </div>
          </div>

          <div className="campaign-grid-v2">
            {variants.length === 0 ? (
              <div className="empty-state">Todavía no hay variantes generadas.</div>
            ) : (
              variants.map((variant, index) => (
                <article
                  key={variant.id || index}
                  className={index === selectedIndex ? "campaign-preview-card-v2 selected" : "campaign-preview-card-v2"}
                >
                  <button type="button" className="campaign-card-select" onClick={() => setSelectedIndex(index)}>
                    {(variant.imageUrl || variant.image) ? (
                      <div className="campaign-image-frame small">
                        <img src={variant.imageUrl || variant.image} alt={`Campaña ${index + 1}`} />
                      </div>
                    ) : (
                      <div className="campaign-image-frame small campaign-image-placeholder">
                        <span>Copy</span>
                        <small>Sin imagen aún</small>
                      </div>
                    )}
                    <div className="campaign-card-body">
                      <span className="badge">Variante {index + 1}</span>
                      <h3>{variant.title}</h3>
                      <p>{variant.caption || variant.text}</p>
                      <small>{variant.hashtags}</small>
                    </div>
                  </button>
                  <div className="campaign-card-actions">
                    <button
                      className="ghost-btn"
                      onClick={() => navigator.clipboard?.writeText(`${variant.title}\n\n${variant.caption || variant.text}\n\n${variant.hashtags}`)}
                    >
                      Copiar texto
                    </button>
                    <button className={index === selectedIndex ? "primary-btn" : "ghost-btn"} onClick={() => setSelectedIndex(index)}>
                      {index === selectedIndex ? "Seleccionada" : "Usar esta"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
    </ModuleGate>
  );
}
