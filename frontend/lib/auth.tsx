"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail } from "./api";
import { AgentSession } from "./types";
import { SESSION_COOKIE, TOKEN_COOKIE, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from "./constants";

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

function setStoredAuth(session: AgentSession, token: string) {
  const serializedSession = JSON.stringify(session);
  setCookie(SESSION_COOKIE, serializedSession);
  setCookie(TOKEN_COOKIE, token);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, serializedSession);
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);

    // Compatibilidad con versiones anteriores del frontend que buscaban otras claves.
    window.localStorage.setItem("token", token);
    window.localStorage.setItem("auth_token", token);
    window.localStorage.setItem("jwt", token);
  }
}

function clearStoredAuth() {
  clearCookie(SESSION_COOKIE);
  clearCookie(TOKEN_COOKIE);

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("auth_token");
    window.localStorage.removeItem("jwt");
  }
}

export function getStoredSession(): AgentSession | null {
  const raw =
    getCookie(SESSION_COOKIE) ||
    (typeof window !== "undefined" ? window.localStorage.getItem(SESSION_STORAGE_KEY) : null);

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
      setStoredAuth(data.user, data.token);
      router.push(data.user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div>
          <h1>Entrar a la plataforma</h1>
          <div className="meta-line">Ingresa tus credenciales para acceder a la plataforma.</div>
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
      </div>
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();
  function handleLogout() {
    clearStoredAuth();
    router.push("/login");
    router.refresh();
  }

  return <button className="ghost-btn" onClick={handleLogout}>Cerrar sesión</button>;
}
