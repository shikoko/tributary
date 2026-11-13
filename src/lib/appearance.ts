// How Tributary looks: light or dark, the accent colour, the graph's colours and the diff
// colours. The stylesheet's colours are roles (styles.css :root); this sets the ones that
// depend on the accent, and the attributes that switch the others.

export type ThemeChoice = "dark" | "light" | "system";
export type Theme = "dark" | "light";
export type LanePaletteName = "vivid" | "soft" | "safe";
/** A built-in palette, or the colours you chose. */
export type LaneChoice = LanePaletteName | "custom";
export type DiffColors = "green-red" | "blue-orange";
/**
 * How the graph's lines turn between lanes (graphPainter.ts). "mixed": smooth (like
 * Apple's corners) into the next lane, round for longer jumps.
 */
export type CurveStyle = "mixed" | "round" | "smooth" | "tight" | "sweep";
export const CURVE_STYLES: CurveStyle[] = ["mixed", "round", "smooth", "tight", "sweep"];
/** Commits in the graph: their authors' pictures (or initials), or dots. Merges are dots either way. */
export type GraphNodes = "authors" | "dots";
/**
 * How a dot on the graph (a merge, or any commit when the graph shows dots) shows its
 * checks: a small dot beside it, or the dot itself in the checks' colour, ringed in its
 * lane's colour ("ringed"), in its lane's colour with a ring of the checks' colour ("halo"),
 * or in the checks' colour alone ("filled").
 */
export type CiDots = "beside" | "ringed" | "halo" | "filled";
export const CI_DOTS: CiDots[] = ["beside", "ringed", "halo", "filled"];

export interface Appearance {
  theme: ThemeChoice;
  /** `#rrggbb`. */
  accent: string;
  lanes: LaneChoice;
  /** Your own lane colours (`#rrggbb`), used with `lanes: "custom"` in both themes. */
  customLanes: string[];
  diffColors: DiffColors;
  curves: CurveStyle;
  nodes: GraphNodes;
  ciDots: CiDots;
}

export const DEFAULT_ACCENT = "#1fb5ff";

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  accent: DEFAULT_ACCENT,
  lanes: "vivid",
  customLanes: [],
  diffColors: "green-red",
  curves: "mixed",
  nodes: "authors",
  ciDots: "ringed",
};

/** Your own lane colours: from two to this many. */
export const MAX_CUSTOM_LANES = 16;

/**
 * Accent colours to pick from, with where their gradient ends, and a partner: a different
 * colour that goes with it, for a second thing shown beside the first (the file count under
 * a progress bar).
 */
export const ACCENTS: { name: string; color: string; end: string; pair: string }[] = [
  { name: "Azure", color: "#1fb5ff", end: "#4d7cff", pair: "#a77bff" },
  { name: "Blue", color: "#4d7cff", end: "#8a5cff", pair: "#19d7b4" },
  { name: "Violet", color: "#a77bff", end: "#e65cff", pair: "#1fb5ff" },
  { name: "Pink", color: "#ff4f9a", end: "#ff6a45", pair: "#1fb5ff" },
  { name: "Coral", color: "#ff6a45", end: "#ff9a2e", pair: "#19c9b4" },
  { name: "Amber", color: "#ffad1f", end: "#ff7a2e", pair: "#a77bff" },
  { name: "Green", color: "#2fd07a", end: "#14b8a6", pair: "#4d7cff" },
  { name: "Teal", color: "#19c9b4", end: "#1f9bff", pair: "#ff4f9a" },
  { name: "Graphite", color: "#8e97a8", end: "#6c7486", pair: "#c9cfda" },
];

/**
 * The graph's lane colours, for each theme: distinct from their neighbours, and readable
 * on the background. "safe" is built on the Okabe–Ito colours, which people with the
 * common kinds of colour blindness can tell apart.
 */
export const LANE_PALETTES: Record<LanePaletteName, Record<Theme, string[]>> = {
  vivid: {
    dark: ["#1fb5ff", "#ff4f9a", "#8ce04a", "#ffad1f", "#a77bff", "#19d7b4", "#ff6a45", "#ffe24a", "#4d7cff", "#e65cff", "#36e07c", "#ff8e3c"],
    light: ["#0a8bd1", "#dc2f7c", "#4b931b", "#cf8300", "#7a4fe3", "#0b9a81", "#dc4b26", "#a88b00", "#2f5ee3", "#b33ccc", "#17984f", "#d4661a"],
  },
  soft: {
    dark: ["#7cc4e8", "#e895b8", "#a9cf88", "#e3bd78", "#b9a3e8", "#7fd1c0", "#e8a08a", "#ddd08a", "#8fa5e8", "#d49ae3", "#86d4a4", "#e8b088"],
    light: ["#4a8fb5", "#b5628a", "#6a934b", "#a7833d", "#7c68b3", "#4a978a", "#b36b56", "#958737", "#5770b3", "#9a62ab", "#4a996b", "#b37d4c"],
  },
  safe: {
    dark: ["#56b4e9", "#e69f00", "#19b38a", "#f0e442", "#cc79a7", "#e8702a", "#3d93dc", "#a0a8b8"],
    light: ["#2a8cc6", "#c28600", "#009e73", "#9c8f00", "#b0588a", "#d55e00", "#0072b2", "#677083"],
  },
};

export const LANE_PALETTE_LABELS: Record<LanePaletteName, string> = {
  vivid: "Vivid",
  soft: "Soft",
  safe: "Colour-blind safe",
};

type Rgb = [number, number, number];

/** `#rgb` or `#rrggbb`, or null when it isn't one. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  const value = parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** `a`, moved `amount` (0–1) of the way to `b`. */
function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255];
  const max = Math.max(rs, gs, bs);
  const min = Math.min(rs, gs, bs);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rs ? (gs - bs) / d + (gs < bs ? 6 : 0) : max === gs ? (bs - rs) / d + 2 : (rs - gs) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `color`, moved towards `toward` until it reads on `background` (at least `min`:1). */
function readable(color: Rgb, background: Rgb, toward: Rgb, min = 4.5): Rgb {
  let result = color;
  for (let step = 0; step < 30 && contrast(result, background) < min; step++) result = mix(result, toward, 0.08);
  return result;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_TEXT: Rgb = [228, 231, 238];
const LIGHT_TEXT: Rgb = [27, 31, 38];
/** The themes' panel backgrounds (--bg-panel; --bg is close enough). */
const DARK_BG: Rgb = [26, 29, 36];
const LIGHT_BG: Rgb = [245, 246, 248];

/** The accent's roles (the CSS variables) for a theme. */
export function accentRoles(accent: string, theme: Theme): Record<string, string> {
  const color = parseHex(accent) ?? (parseHex(DEFAULT_ACCENT) as Rgb);
  const preset = ACCENTS.find((entry) => entry.color.toLowerCase() === toHex(color));
  // Without a preset's: the same colour turned a little towards blue-violet.
  const [h, s, l] = rgbToHsl(color);
  const end = preset ? (parseHex(preset.end) as Rgb) : hslToRgb([(h + 25) % 360, s, l]);
  // Its partner: a third of the way round the colour wheel, unless a preset says.
  const pair = preset ? (parseHex(preset.pair) as Rgb) : hslToRgb([(h + 120) % 360, s, l]);
  // Text on the gradient: white, unless the colours are light enough that dark reads better.
  const middle = mix(color, end, 0.5);
  const onAccent = luminance(middle) > 0.5 ? "#0d0f13" : "#ffffff";
  // Text in the accent colour has to read on the background, whatever colour was picked.
  const [background, toward] = theme === "dark" ? [DARK_BG, WHITE] : [LIGHT_BG, BLACK];
  const legible = (rgb: Rgb) => toHex(readable(rgb, background, toward));
  const text =
    theme === "dark"
      ? { text: mix(color, WHITE, 0.45), soft: mix(color, DARK_TEXT, 0.6), strong: mix(color, WHITE, 0.82) }
      : { text: mix(color, BLACK, 0.4), soft: mix(color, LIGHT_TEXT, 0.48), strong: mix(color, BLACK, 0.6) };
  return {
    "--accent": toHex(color),
    "--accent-rgb": color.map(Math.round).join(" "),
    "--accent-2": toHex(end),
    "--accent-pair": toHex(pair),
    "--accent-pair-rgb": pair.map(Math.round).join(" "),
    "--on-accent": onAccent,
    "--accent-ink": legible(color),
    "--accent-text": legible(text.text),
    "--accent-soft-text": legible(text.soft),
    "--accent-strong-text": legible(text.strong),
  };
}

export function effectiveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

/** Older or edited settings, made whole. */
export function normalizeAppearance(value: Partial<Appearance> | null | undefined): Appearance {
  const theme = value?.theme === "light" || value?.theme === "system" ? value.theme : "dark";
  const accent = value?.accent && parseHex(value.accent) ? toHex(parseHex(value.accent) as Rgb) : DEFAULT_ACCENT;
  const customLanes = (Array.isArray(value?.customLanes) ? value.customLanes : [])
    .map((color) => (typeof color === "string" ? parseHex(color) : null))
    .filter((color): color is Rgb => color !== null)
    .map(toHex)
    .slice(0, MAX_CUSTOM_LANES);
  const lanes: LaneChoice =
    value?.lanes === "custom" ? (customLanes.length >= 2 ? "custom" : "vivid") : value?.lanes && value.lanes in LANE_PALETTES ? value.lanes : "vivid";
  const diffColors = value?.diffColors === "blue-orange" ? "blue-orange" : "green-red";
  const curves = value?.curves && CURVE_STYLES.includes(value.curves) ? value.curves : "mixed";
  const nodes = value?.nodes === "dots" ? "dots" : "authors";
  const ciDots = value?.ciDots && CI_DOTS.includes(value.ciDots) ? value.ciDots : "ringed";
  return { theme, accent, lanes, customLanes, diffColors, curves, nodes, ciDots };
}

/** The lane colours in use: a built-in palette for the theme, or your own. */
export function lanePalette(appearance: Appearance, theme: Theme): string[] {
  return appearance.lanes === "custom" ? appearance.customLanes : LANE_PALETTES[appearance.lanes][theme];
}

/** Text that reads on `color`: near-black or white, whichever contrasts with it more. */
export function textOn(color: string): string {
  const rgb = parseHex(color);
  return rgb && contrast(rgb, [13, 15, 19]) > contrast(rgb, [255, 255, 255]) ? "#0d0f13" : "#ffffff";
}

/** Switch the page to these colours. */
export function applyAppearance(appearance: Appearance, theme: Theme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  root.dataset.diffColors = appearance.diffColors;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  for (const [name, value] of Object.entries(accentRoles(appearance.accent, theme))) root.style.setProperty(name, value);
}

/** The colours canvases draw with (they can't use CSS variables), read from the page. */
export interface CanvasColors {
  background: string;
  selectedBackground: string;
  accent: string;
  ring: string;
  match: string;
  faint: string;
  border: string;
  borderStrong: string;
  lanes: string[];
}

export function readCanvasColors(lanes: string[], root: HTMLElement = document.documentElement): CanvasColors {
  const style = getComputedStyle(root);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: get("--bg"),
    selectedBackground: get("--bg-selected"),
    accent: get("--accent"),
    ring: get("--graph-ring"),
    match: get("--match"),
    faint: get("--text-faint"),
    border: get("--border"),
    borderStrong: get("--border-strong"),
    lanes,
  };
}
