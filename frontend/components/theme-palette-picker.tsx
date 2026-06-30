"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "evolum_theme";

const palettes = [
  { id: "purple", label: "Neon", colors: ["#7c3aed", "#a855f7", "#22d3ee"] },
  { id: "cyan", label: "Cian", colors: ["#0891b2", "#22d3ee", "#34d399"] },
  { id: "ember", label: "Amber", colors: ["#ea580c", "#f59e0b", "#fb7185"] },
  { id: "emerald", label: "Verde", colors: ["#059669", "#10b981", "#38bdf8"] }
] as const;

export type ThemePalette = (typeof palettes)[number]["id"];

function applyTheme(theme: ThemePalette) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function ThemePalettePicker() {
  const [theme, setTheme] = useState<ThemePalette>("purple");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(THEME_KEY) : null;
    const next = palettes.some((item) => item.id === stored) ? (stored as ThemePalette) : "purple";
    setTheme(next);
    applyTheme(next);
  }, []);

  function selectTheme(next: ThemePalette) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  return (
    <div className="theme-palette-picker" aria-label="Paletas de color">
      <strong>Paleta</strong>
      <div>
        {palettes.map((palette) => (
          <button
            className={palette.id === theme ? "active" : ""}
            key={palette.id}
            type="button"
            onClick={() => selectTheme(palette.id)}
            title={palette.label}
          >
            <span>
              {palette.colors.map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </span>
            {palette.label}
          </button>
        ))}
      </div>
    </div>
  );
}
