import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  effectiveTheme,
  LANE_PALETTES,
  lanePalette,
  normalizeAppearance,
  readCanvasColors,
  type Appearance,
  type CanvasColors,
  type CurveStyle,
  type GraphNodes,
  type Theme,
} from "../lib/appearance";
import { readSetting } from "../lib/settings";

export const APPEARANCE_KEY = "appearance";

const darkQuery = () => (typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null);

/** The theme in use and the colours canvases draw with. */
export interface ThemeInfo {
  theme: Theme;
  colors: CanvasColors;
  curves: CurveStyle;
  nodes: GraphNodes;
}

const FALLBACK: ThemeInfo = {
  theme: "dark",
  curves: "mixed",
  nodes: "authors",
  colors: {
    background: "#14161b",
    selectedBackground: "#252b38",
    accent: "#1fb5ff",
    ring: "#ffffff",
    match: "#ffd23f",
    faint: "#596071",
    border: "#282d38",
    borderStrong: "#353b48",
    lanes: LANE_PALETTES.vivid.dark,
  },
};

export const ThemeContext = createContext<ThemeInfo>(FALLBACK);

/** The colours canvases (the graph, waveforms, 3D views) draw with. */
export function useThemeColors(): CanvasColors {
  return useContext(ThemeContext).colors;
}

/** Before the first render: the remembered colours, so the window doesn't start in the wrong ones. */
export function applyStoredAppearance() {
  const appearance = normalizeAppearance(readSetting<Partial<Appearance> | null>(APPEARANCE_KEY, null));
  applyAppearance(appearance, effectiveTheme(appearance.theme, darkQuery()?.matches ?? true));
  // index.html starts dark, so the window isn't white while the app loads; the theme takes over now.
  document.body.style.removeProperty("background");
}

/** The window's own parts (title bar, window background) in the same theme. */
function applyToWindow(choice: Appearance["theme"], background: string) {
  try {
    const window = getCurrentWindow();
    window.setTheme(choice === "system" ? null : choice).catch(() => {});
    window.setBackgroundColor(background).catch(() => {});
  } catch {
    // Not in the app (the browser preview).
  }
}

/** Apply `value` (stored settings, possibly old or partial) and follow the system's theme when asked. */
export function useAppearance(value: Partial<Appearance> | undefined): ThemeInfo {
  const appearance = useMemo(() => normalizeAppearance(value ?? DEFAULT_APPEARANCE), [value]);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? true);
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = effectiveTheme(appearance.theme, systemDark);
  const [info, setInfo] = useState<ThemeInfo>(FALLBACK);
  useLayoutEffect(() => {
    applyAppearance(appearance, theme);
    const colors = readCanvasColors(lanePalette(appearance, theme));
    setInfo({ theme, colors, curves: appearance.curves, nodes: appearance.nodes });
    applyToWindow(appearance.theme, colors.background);
  }, [appearance, theme]);
  return info;
}
