"use client";

import { useEffect } from "react";

const THEME_KEY = "evolum_theme";
const BACKGROUND_THEME_KEY = "evolum_background_theme";
const THEMES = new Set(["purple", "cyan", "ember", "emerald", "sapphire"]);
const BACKGROUNDS = new Set(["nocturne", "graphite", "ocean", "forest"]);

export function ThemeBootstrap() {
  useEffect(() => {
    const theme = window.localStorage.getItem(THEME_KEY);
    const background = window.localStorage.getItem(BACKGROUND_THEME_KEY);

    document.documentElement.dataset.theme = THEMES.has(theme || "") ? theme || "purple" : "purple";
    document.documentElement.dataset.bgTheme = BACKGROUNDS.has(background || "") ? background || "nocturne" : "nocturne";
  }, []);

  return null;
}
