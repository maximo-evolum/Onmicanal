"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail } from "./api";
import { AgentSession } from "./types";
import { SESSION_COOKIE, TOKEN_COOKIE } from "./constants";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=604800; samesite=lax`;
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function getStoredSession(): AgentSession | null {
  const raw = getCookie(SESSION_COOKIE);
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
      setCookie(SESSION_COOKIE, JSON.stringify(data.user));
      setCookie(TOKEN_COOKIE, data.token);
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
    clearCookie(SESSION_COOKIE);
    clearCookie(TOKEN_COOKIE);
    router.push("/login");
    router.refresh();
  }

  return <button className="ghost-btn" onClick={handleLogout}>Cerrar sesión</button>;
}
