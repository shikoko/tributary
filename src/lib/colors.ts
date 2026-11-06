/** Lane colours, picked to stay distinct from their neighbours on a dark background. */
export const LANE_COLORS = [
  "#1fb5ff", // azure
  "#ff4f9a", // pink
  "#8ce04a", // lime
  "#ffad1f", // amber
  "#a77bff", // violet
  "#19d7b4", // teal
  "#ff6a45", // coral
  "#ffe24a", // yellow
  "#4d7cff", // blue
  "#e65cff", // magenta
  "#36e07c", // green
  "#ff8e3c", // orange
];

export function laneColor(column: number): string {
  return LANE_COLORS[column % LANE_COLORS.length];
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
  return LANE_COLORS[Math.abs(hash) % LANE_COLORS.length];
}
