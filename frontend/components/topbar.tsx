"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentSession } from "@/lib/types";
import { getStoredSession, LogoutButton } from "@/lib/auth";
import { getMyModules } from "@/lib/api";

export function Topbar({ agent }: { agent?: AgentSession | null }) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(agent || null);
  const [plan, setPlan] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    setSession(agent || getStoredSession());
    getMyModules()
      .then((data) => setPlan(data.plan || ""))
      .catch(() => setPlan(""));
  }, [agent]);

  const userName = mounted ? session?.name || "Usuario" : "Usuario";

  return (
    <div className="topbar">
      <div>
        <h1 className="brand-title">Inbox IA</h1>
        <div className="workspace-pill">
          <span>Omnicanal + IA</span>{plan ? <span>/ Plan {plan}</span> : null}
        </div>
      </div>

      <div className="topbar-actions">
        <Link className="ghost-btn" href="/crm-principal">Inicio EVOLUM</Link>
        {session?.role === "SUPER_ADMIN" ? <Link className="ghost-btn" href="/admin">Desarrollador</Link> : null}
        <span className="badge accent">{userName}</span>
        <LogoutButton />
      </div>
    </div>
  );
}
