"use client";

import { useEffect, useState } from "react";
import { getStoredSession } from "@/lib/auth";
import type { AgentSession } from "@/lib/types";

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "EV";
}

function normalizeAvatarUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("data:image") && raw.includes(";base64") && !raw.includes(";base64,")) {
    return raw.replace(";base64", ";base64,");
  }

  return raw.replace("base64,,", "base64,");
}

export function AccountPill({
  fallbackName = "Usuario",
  className = "module-account-pill",
}: {
  fallbackName?: string | null;
  className?: string;
}) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    function syncSession() {
      setSession(getStoredSession());
    }

    syncSession();
    window.addEventListener("storage", syncSession);
    window.addEventListener("evolum-session-updated", syncSession);

    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("evolum-session-updated", syncSession);
    };
  }, []);

  const name = session?.name || fallbackName || "Usuario";
  const avatarUrl = normalizeAvatarUrl(session?.avatarUrl);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  return (
    <span className={`${className} account-pill-with-avatar`}>
      {avatarUrl && !avatarFailed ? (
        <img src={avatarUrl} alt={name} onError={() => setAvatarFailed(true)} />
      ) : (
        <i>{initials(name)}</i>
      )}
      <strong>{name}</strong>
    </span>
  );
}
