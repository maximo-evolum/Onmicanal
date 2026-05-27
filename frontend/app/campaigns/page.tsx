"use client";

import { useState } from "react";
import { generateCampaignPro } from "@/lib/api";
import { BackToInbox } from "@/components/BackToInbox";
import { Topbar } from "@/components/topbar";
import { getStoredSession } from "@/lib/auth";

type CampaignVariant = {
  text: string;
  hashtags: string;
  image: string;
};

export default function CampaignsPage() {
  const agent = getStoredSession();
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!prompt.trim()) {
      setError("Escribe el producto o servicio que quieres promocionar.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await generateCampaignPro({
        product: prompt,
        platform
      });

      setVariants(data.variants || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la campaña");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-single">
      <main className="main">
        <Topbar agent={agent} />
        <div className="content-toolbar"><BackToInbox /></div>

        <div className="chat-header">
          <h1 className="chat-title">Campañas IA</h1>
          <div className="meta-line">Genera posts y previews para Instagram, Facebook u otras redes.</div>
        </div>

        <div className="campaign-builder">
          <div className="conversation-card active">
            <div className="meta-line">Producto o servicio</div>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ej: vender zapatillas Nike, servicio de diseño web, asesoría legal..."
            />

            <div className="meta-line" style={{ marginTop: 12 }}>Plataforma</div>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="linkedin">LinkedIn</option>
            </select>

            {error ? <div className="meta-line" style={{ marginTop: 12 }}>{error}</div> : null}

            <div style={{ marginTop: 16 }}>
              <button className="primary-btn" onClick={generate} disabled={loading}>
                {loading ? "Generando..." : "Generar campaña"}
              </button>
            </div>
          </div>

          <div className="campaign-grid">
            {variants.length === 0 ? (
              <div className="empty-state">Genera una campaña para ver variantes de copy e imagen.</div>
            ) : (
              variants.map((variant, index) => (
                <article key={index} className="campaign-preview-card">
                  <div className="meta-line">Variante {index + 1}</div>
                  <img src={variant.image} alt={`Campaña ${index + 1}`} />
                  <p>{variant.text}</p>
                  <small>{variant.hashtags}</small>
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="ghost-btn"
                      onClick={() => navigator.clipboard?.writeText(`${variant.text}\n\n${variant.hashtags}`)}
                    >
                      Copiar texto
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
