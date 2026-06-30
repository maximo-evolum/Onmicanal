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

export function AccountPill({
  fallbackName = "Usuario",
  className = "module-account-pill",
}: {
  fallbackName?: string | null;
  className?: string;
}) {
  const [session, setSession] = useState<AgentSession | null>(null);

  useEffect(() => {
    setSession(getStoredSession());
  }, []);

  const name = session?.name || fallbackName || "Usuario";
  const avatarUrl = session?.avatarUrl || "";

  return (
    <span className={`${className} account-pill-with-avatar`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} />
      ) : (
        <i>{initials(name)}</i>
      )}
      <strong>{name}</strong>
    </span>
  );
}
