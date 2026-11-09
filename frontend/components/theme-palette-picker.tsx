/** Archivo: Implementa el componente de interfaz theme palette picker para la aplicación web. */
"use client";

import { useEffect, useState } from "react";

const COLOR_MODE_KEY = "evolum_color_mode";
const THEME_KEY = "evolum_theme";
const THEMES = new Set(["purple", "cyan", "ember", "emerald", "sapphire", "executive"]);

function applyColorMode(isDark: boolean) {
  if (typeof document === "undefined") return;
  const savedAccent = window.localStorage.getItem(THEME_KEY);
  const accentTheme = THEMES.has(savedAccent || "") ? savedAccent || "purple" : "purple";
  // Mantiene sincronizadas las pantallas nuevas y las vistas heredadas.
  // Al volver a claro se restaura el acento seleccionado por la persona.
  document.documentElement.dataset.theme = isDark ? "dark" : accentTheme;
  document.documentElement.dataset.designSystem = isDark ? "dark" : "finance";
  document.documentElement.dataset.uiLayout = "model-a";
}

export function ThemePalettePicker() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const next = window.localStorage.getItem(COLOR_MODE_KEY) === "dark";
    setIsDark(next);
    applyColorMode(next);
  }, []);

  function toggleColorMode() {
    const next = !isDark;
    setIsDark(next);
    applyColorMode(next);
    window.localStorage.setItem(COLOR_MODE_KEY, next ? "dark" : "light");
  }

  return (
    <div className="theme-palette-picker" aria-label="Preferencia visual">
      <div>
        <strong>Apariencia</strong>
        <small>{isDark ? "El modo oscuro está activo." : "El modo claro está activo."}</small>
      </div>
      <button className="dark-mode-toggle" type="button" onClick={toggleColorMode} aria-pressed={isDark}>
        <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
        {isDark ? "Usar modo claro" : "Cambiar a modo oscuro"}
      </button>
    </div>
  );
}
