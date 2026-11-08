import { LANE_PALETTES } from "./appearance";

/** Avatars keep the vivid colours in both themes: their initials are dark. */
const AVATAR_COLORS = LANE_PALETTES.vivid.dark;

/** A lane's colour, from the graph colours in use (ThemeContext). */
export function laneColor(column: number, lanes: string[]): string {
  return lanes[column % lanes.length];
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** A stable colour for an author, based on their email. */
export function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
