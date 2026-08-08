"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail } from "./api";
import { AgentSession } from "./types";
import { API_BASE_URL, SESSION_COOKIE, SESSION_STORAGE_KEY } from "./constants";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=604800; samesite=lax`;
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function cookieSafeSession(session: AgentSession) {
  return JSON.stringify({
    ...session,
    avatarUrl: session.avatarUrl?.startsWith("data:") ? "" : session.avatarUrl
  });
}

function setStoredAuth(session: AgentSession) {
  const serializedSession = JSON.stringify(session);
  setCookie(SESSION_COOKIE, cookieSafeSession(session));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, serializedSession);
    // La sesión autenticada vive en la cookie HTTP-only emitida por el API.
    // El navegador no conserva JWT accesibles desde JavaScript.
    window.sessionStorage.removeItem("evolum_access_token");
  }
}

export function mergeStoredSession(patch: Partial<AgentSession>) {
  const current = getStoredSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  const serializedSession = JSON.stringify(next);
  setCookie(SESSION_COOKIE, cookieSafeSession(next));

  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, serializedSession);
    window.dispatchEvent(new Event("evolum-session-updated"));
  }

  return next;
}

function clearStoredAuth() {
  clearCookie(SESSION_COOKIE);

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem("inbox_token");
    window.sessionStorage.removeItem("inbox_token");
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("auth_token");
    window.localStorage.removeItem("jwt");
    window.sessionStorage.removeItem("evolum_access_token");
  }
}

export function getStoredSession(): AgentSession | null {
  const raw =
    (typeof window !== "undefined" ? window.localStorage.getItem(SESSION_STORAGE_KEY) : null) ||
    getCookie(SESSION_COOKIE);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as AgentSession;
  } catch {
    return null;
  }
}

export function useAgentSession() {
  const [session, setSession] = useState<AgentSession | null>(null);
  useEffect(() => {
    setSession(getStoredSession());
  }, []);
  return session;
}

export function LoginPage() {
  const router = useRouter();
    const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const data = await loginWithEmail(email, password || undefined);
      setStoredAuth(data.user);
      router.push("/crm-principal");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-layout">
        <section className="login-brand-panel" aria-label="Acerca de EVOLUM OS">
          <div className="login-brand-head">
            <img className="login-brand-logo" src="/brand/evolum-logo.png" alt="EVOLUM OS" />
            <div><strong>EVOLUM <em>OS</em></strong><span>El Sistema Operativo para Empresas</span></div>
          </div>
          <div className="login-brand-copy">
            <p className="eyebrow">Operación en un solo lugar</p>
            <h1>Haz crecer tu empresa. Nosotros nos encargamos del resto.</h1>
            <p>Centraliza clientes, procesos, documentos, automatizaciones y decisiones para que tu equipo avance con claridad.</p>
          </div>
          <div className="login-benefit-list">
            <div><b>✓</b><span><strong>Todo conectado</strong><small>CRM, agenda, conversaciones y datos operativos.</small></span></div>
            <div><b>↗</b><span><strong>Decisiones con contexto</strong><small>Indicadores claros para priorizar cada día.</small></span></div>
            <div><b>◈</b><span><strong>IA que trabaja contigo</strong><small>Automatiza seguimiento sin perder el control humano.</small></span></div>
          </div>
          <div className="login-brand-footer"><i /> Plataforma segura y preparada para crecer contigo.</div>
        </section>

      <div className="login-card">
        <div className="login-card-intro">
          <h1>Entrar a la plataforma</h1>
          <div className="meta-line">Ingresa tus credenciales para acceder a la plataforma.</div>
        </div>
        <div className="login-access-note">
          <i>✓</i>
          <span><strong>Tu espacio EVOLUM está listo</strong><small>Accede a tus herramientas, datos y tareas desde un solo lugar.</small></span>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <div className="meta-line">{error}</div> : null}
          <button className="primary-btn" type="submit" disabled={submitting || !email || !password}>
            {submitting ? "Entrando..." : "Entrar"}
          </button>
          
        </form>
        <div className="login-card-foot"><i /> Acceso protegido para tu equipo y tu operación.</div>
      </div>
      </div>
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();
  function handleLogout() {
    void fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
    clearStoredAuth();
    router.push("/login");
    router.refresh();
  }

  return <button className="ghost-btn logout-button" onClick={handleLogout}>Cerrar sesión</button>;
}
