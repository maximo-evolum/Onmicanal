/** Archivo: Renderiza la barra operativa compartida que materializa el formato ejecutivo de EVOLUM OS. */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NotificationCenter } from "@/components/notification-center";
import { getStoredSession, LogoutButton } from "@/lib/auth";

export type EvolumWorkspaceShortcut = {
  label: string;
  href: string;
  description: string;
  group: string;
  active?: boolean;
};

type EvolumWorkspaceChromeProps = {
  activeLabel: string;
  workspaceLabel: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  shortcuts: EvolumWorkspaceShortcut[];
};

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "EV";
}

/**
 * Marco superior común de la maqueta aprobada (Modelo A). No inventa datos ni
 * duplica navegación: recibe solo los accesos que el menú EV ya autorizó.
 */
export function EvolumWorkspaceChrome({
  activeLabel,
  workspaceLabel,
  menuOpen,
  onToggleMenu,
  shortcuts
}: EvolumWorkspaceChromeProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const syncSession = () => setUserName(getStoredSession()?.name || "");
    syncSession();
    window.addEventListener("storage", syncSession);
    window.addEventListener("evolum-session-updated", syncSession);
    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("evolum-session-updated", syncSession);
    };
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const matches = useMemo(() => {
    if (!normalizedQuery) return shortcuts.slice(0, 8);
    return shortcuts.filter((item) => `${item.label} ${item.description} ${item.group}`.toLocaleLowerCase("es").includes(normalizedQuery)).slice(0, 8);
  }, [normalizedQuery, shortcuts]);

  return (
    <header className={`evolum-workspace-chrome ${menuOpen ? "is-menu-open" : "is-menu-collapsed"}`} aria-label="Barra de trabajo EVOLUM">
      <div className="evolum-workspace-chrome-main">
        <button
          className="evolum-workspace-menu-toggle"
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? "Contraer menú EVOLUM" : "Abrir menu EVOLUM"}
          aria-expanded={menuOpen}
          title={menuOpen ? "Contraer menú" : "Abrir menú"}
        >
          <span aria-hidden="true">{menuOpen ? "‹" : "›"}</span>
        </button>

        <div className="evolum-workspace-location" aria-label="Ubicación actual">
          <span>{workspaceLabel}</span>
          <b aria-hidden="true">/</b>
          <strong>{activeLabel}</strong>
        </div>

        <label className="evolum-workspace-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
              if (event.key === "Enter" && matches[0]) {
                event.preventDefault();
                setSearchOpen(false);
                setQuery("");
                router.push(matches[0].href);
              }
            }}
            placeholder="Buscar módulo, función o vista"
            aria-label="Buscar módulo, función o vista"
          />
          {(searchOpen || normalizedQuery) ? (
            <span className="evolum-workspace-search-results" role="listbox" aria-label="Resultados de navegación">
              {matches.length ? matches.map((item) => (
                <Link href={item.href} key={`${item.group}-${item.href}`} role="option" onClick={() => { setSearchOpen(false); setQuery(""); }}>
                  <small>{item.group}</small>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </Link>
              )) : <span className="evolum-workspace-search-empty">No hay un módulo autorizado que coincida.</span>}
            </span>
          ) : null}
        </label>

        <div className="evolum-workspace-actions">
          <NotificationCenter placement="header" />
          <span className="evolum-workspace-mobile-logout">
            <LogoutButton compact />
          </span>
          <span className="evolum-workspace-user" title={userName || "Usuario EVOLUM"} aria-label={userName || "Usuario EVOLUM"}>{initials(userName)}</span>
        </div>
      </div>

    </header>
  );
}
