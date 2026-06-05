"use client";

import { useMemo, useState } from "react";
import { generateCampaignPro, publishCampaign, CampaignPlatform, CampaignVariant } from "@/lib/api";
import { BackToInbox } from "@/components/BackToInbox";
import { Topbar } from "@/components/topbar";
import { getStoredSession } from "@/lib/auth";

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

export default function CampaignsPage() {
  const agent = getStoredSession();
  const [product, setProduct] = useState("");
  const [idea, setIdea] = useState("");
  const [visualTitle, setVisualTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [cta, setCta] = useState("");
  const [platforms, setPlatforms] = useState<CampaignPlatform[]>(["instagram"]);
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishResults, setPublishResults] = useState<Array<{ platform: string; status: string; note?: string; error?: string }> | null>(null);

  const selectedVariant = variants[selectedIndex] || null;

  const previewCaption = useMemo(() => {
    if (!selectedVariant) return caption;
    return `${caption || selectedVariant.caption || selectedVariant.text || ""}${selectedVariant.hashtags ? `\n\n${selectedVariant.hashtags}` : ""}`;
  }, [caption, selectedVariant]);

  async function generate() {
    if (!product.trim() && !idea.trim()) {
      setError("Escribe el producto/servicio o la idea de campaña.");
      return;
    }

    if (platforms.length === 0) {
      setError("Selecciona al menos una plataforma.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setPublishResults(null);

      const data = await generateCampaignPro({
        product,
        idea,
        visualTitle,
        caption,
        cta,
        platforms
      });

      const nextVariants = data.variants || [];
      setVariants(nextVariants);
      setSelectedIndex(0);
      setCampaignId(data.campaign?.id);
      if (!visualTitle && nextVariants[0]?.title) setVisualTitle(nextVariants[0].title);
      if (!caption && nextVariants[0]?.caption) setCaption(nextVariants[0].caption);
      if (!cta && nextVariants[0]?.cta) setCta(nextVariants[0].cta || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la campaña");
    } finally {
      setLoading(false);
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
    <div className="page page-single campaign-page">
      <main className="main">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <section className="campaign-hero">
          <div>
            <p className="eyebrow">Marketing IA</p>
            <h1 className="chat-title">Campañas IA</h1>
            <div className="meta-line">Crea imágenes, títulos y textos listos para publicar en los canales del cliente.</div>
          </div>
          <div className="campaign-status-pill">
            {variants.length ? `${variants.length} variantes listas` : "Borrador"}
          </div>
        </section>

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
              </div>
            </div>

            {error ? <div className="campaign-alert error">{error}</div> : null}

            <div className="campaign-actions">
              <button className="primary-btn" onClick={generate} disabled={loading}>
                {loading ? "Generando campaña..." : "Generar campaña"}
              </button>
              <button className="ghost-btn" onClick={publish} disabled={publishing || !selectedVariant}>
                {publishing ? "Publicando..." : "Publicar campaña"}
              </button>
            </div>

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
                <div className="campaign-image-frame">
                  <img src={selectedVariant.imageUrl || selectedVariant.image} alt={visualTitle || selectedVariant.title} />
                </div>
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
                    <div className="campaign-image-frame small">
                      <img src={variant.imageUrl || variant.image} alt={`Campaña ${index + 1}`} />
                    </div>
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
  );
}
