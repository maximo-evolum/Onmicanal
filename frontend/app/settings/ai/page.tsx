"use client";

import { useEffect, useState } from "react";
import { AISettings, getAIConfig, updateAIConfig } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { Topbar } from "@/components/topbar";

const empty: AISettings = { tone: "", personality: "", objective: "", responseStyle: "", forbidden: "", businessRules: [] };

export default function AISettingsPage() {
  const agent = getStoredSession();
  const [settings, setSettings] = useState<AISettings>(empty);
  const [rules, setRules] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    getAIConfig().then((data) => { setSettings(data.settings); setRules((data.settings.businessRules || []).join("\n")); }).catch((err) => setStatus(err.message));
  }, []);

  async function save() {
    setStatus("Guardando...");
    const payload = { ...settings, businessRules: rules.split("\n").map((r) => r.trim()).filter(Boolean) };
    const result = await updateAIConfig(payload);
    setSettings(result.settings);
    setRules((result.settings.businessRules || []).join("\n"));
    setStatus("Configuración IA guardada.");
  }

  return (
    <div className="page page-single">
      <main className="main dashboard-page phase5-page">
        <Topbar agent={agent} />
        <section className="phase5-hero compact"><div><span className="eyebrow">AI Configuration Center</span><h1 className="chat-title">Personalidad, tono y reglas del bot</h1><p className="meta-line">Configura cómo debe conversar y vender la IA de este negocio.</p></div></section>
        <section className="phase5-panel ai-config-form">
          <label>Tono<input value={settings.tone || ""} onChange={(e) => setSettings({ ...settings, tone: e.target.value })} /></label>
          <label>Personalidad<textarea value={settings.personality || ""} onChange={(e) => setSettings({ ...settings, personality: e.target.value })} /></label>
          <label>Objetivo comercial<textarea value={settings.objective || ""} onChange={(e) => setSettings({ ...settings, objective: e.target.value })} /></label>
          <label>Estilo de respuesta<textarea value={settings.responseStyle || ""} onChange={(e) => setSettings({ ...settings, responseStyle: e.target.value })} /></label>
          <label>Restricciones / cosas que NO debe hacer<textarea value={settings.forbidden || ""} onChange={(e) => setSettings({ ...settings, forbidden: e.target.value })} /></label>
          <label>Reglas del negocio, una por línea<textarea value={rules} onChange={(e) => setRules(e.target.value)} /></label>
          <div className="header-actions"><button className="primary-btn" onClick={save}>Guardar configuración IA</button>{status ? <span className="badge">{status}</span> : null}</div>
        </section>
      </main>
    </div>
  );
}
