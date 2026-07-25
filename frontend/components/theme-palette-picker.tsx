"use client";

import { useEffect, useState } from "react";

const COLOR_MODE_KEY = "evolum_color_mode";

function applyColorMode(isDark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.designSystem = isDark ? "dark" : "finance";
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
