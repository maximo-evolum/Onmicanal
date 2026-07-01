"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "evolum_theme";
const BACKGROUND_THEME_KEY = "evolum_background_theme";

const palettes = [
  { id: "purple", label: "Neon", colors: ["#7c3aed", "#a855f7", "#22d3ee"] },
  { id: "cyan", label: "Cian", colors: ["#0891b2", "#22d3ee", "#34d399"] },
  { id: "ember", label: "Amber", colors: ["#ea580c", "#f59e0b", "#fb7185"] },
  { id: "emerald", label: "Verde", colors: ["#059669", "#10b981", "#38bdf8"] },
  { id: "sapphire", label: "Azul", colors: ["#2563eb", "#38bdf8", "#14b8a6"] }
] as const;

const backgroundPalettes = [
  { id: "nocturne", label: "Nocturno", colors: ["#0a0712", "#140f25", "#21183a"] },
  { id: "graphite", label: "Grafito", colors: ["#05070d", "#101827", "#1f2937"] },
  { id: "ocean", label: "Oceano", colors: ["#06111f", "#0b2239", "#123b5d"] },
  { id: "forest", label: "Bosque", colors: ["#06120e", "#0b2219", "#12362a"] }
] as const;

export type ThemePalette = (typeof palettes)[number]["id"];
export type BackgroundPalette = (typeof backgroundPalettes)[number]["id"];

function applyTheme(theme: ThemePalette) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

function applyBackgroundTheme(theme: BackgroundPalette) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.bgTheme = theme;
}

export function ThemePalettePicker() {
  const [theme, setTheme] = useState<ThemePalette>("purple");
  const [backgroundTheme, setBackgroundTheme] = useState<BackgroundPalette>("nocturne");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(THEME_KEY) : null;
    const storedBackground = typeof window !== "undefined" ? window.localStorage.getItem(BACKGROUND_THEME_KEY) : null;
    const next = palettes.some((item) => item.id === stored) ? (stored as ThemePalette) : "purple";
    const nextBackground = backgroundPalettes.some((item) => item.id === storedBackground)
      ? (storedBackground as BackgroundPalette)
      : "nocturne";
    setTheme(next);
    setBackgroundTheme(nextBackground);
    applyTheme(next);
    applyBackgroundTheme(nextBackground);
  }, []);

  function selectTheme(next: ThemePalette) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  function selectBackgroundTheme(next: BackgroundPalette) {
    setBackgroundTheme(next);
    applyBackgroundTheme(next);
    window.localStorage.setItem(BACKGROUND_THEME_KEY, next);
  }

  return (
    <div className="theme-palette-picker" aria-label="Paletas de color">
      <strong>Paleta visual</strong>
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
      <strong>Fondo</strong>
      <div>
        {backgroundPalettes.map((palette) => (
          <button
            className={palette.id === backgroundTheme ? "active" : ""}
            key={palette.id}
            type="button"
            onClick={() => selectBackgroundTheme(palette.id)}
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
