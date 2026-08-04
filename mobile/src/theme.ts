export type EvolumThemeMode = "lumen" | "nexo";

type ThemeColors = {
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  purple: string;
  purple2: string;
  cyan: string;
  green: string;
  orange: string;
  red: string;
  black: string;
  hero: string;
  heroText: string;
  heroMuted: string;
};

const palettes: Record<EvolumThemeMode, ThemeColors> = {
  // Lumen es la apariencia principal: clara, suave y pensada para leer datos.
  lumen: {
    bg: "#f4f8f8",
    panel: "#ffffff",
    panel2: "#eef5f5",
    panel3: "#e6f0f2",
    border: "rgba(31, 82, 89, 0.16)",
    borderStrong: "rgba(18, 150, 154, 0.44)",
    text: "#172235",
    muted: "#667786",
    purple: "#138f98",
    purple2: "#6974d8",
    cyan: "#10a9a8",
    green: "#048f6b",
    orange: "#c76b16",
    red: "#d9425d",
    black: "#0d2430",
    hero: "#0c4652",
    heroText: "#ffffff",
    heroMuted: "#d1edf0"
  },
  // Nexo conserva el lenguaje oscuro EVOLUM: violeta, azul y alta legibilidad.
  nexo: {
    bg: "#070711",
    panel: "#101022",
    panel2: "#17122d",
    panel3: "#0b1020",
    border: "rgba(168,85,247,0.28)",
    borderStrong: "rgba(199,125,255,0.62)",
    text: "#f5f1ff",
    muted: "#b8afd0",
    purple: "#7d46ed",
    purple2: "#c77dff",
    cyan: "#20d3ee",
    green: "#30d6a7",
    orange: "#ffb02e",
    red: "#ff4d75",
    black: "#05050d",
    hero: "#18122e",
    heroText: "#ffffff",
    heroMuted: "#c7c2d6"
  }
};

let activeTheme: EvolumThemeMode = "lumen";

// Se mutan las referencias para que los componentes existentes compartan el
// mismo lenguaje visual. La app vuelve a construir sus estilos al cambiar tema.
export const colors: ThemeColors = { ...palettes.lumen };

export const shadow = {
  shadowColor: "#123440",
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 12 },
  elevation: 5
};

export function applyEvolumTheme(mode: EvolumThemeMode) {
  activeTheme = mode;
  Object.assign(colors, palettes[mode]);
  Object.assign(shadow, mode === "nexo"
    ? { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 8 }
    : { shadowColor: "#123440", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 5 }
  );
}

export function getEvolumTheme() {
  return activeTheme;
}

export const evolumThemes = {
  lumen: { name: "Lumen", description: "Modo claro, limpio y cómodo para datos." },
  nexo: { name: "Nexo", description: "Modo oscuro EVOLUM, con violeta y azul eléctrico." }
} as const;
