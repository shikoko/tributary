import type { Progress } from "../api";

/**
 * How far it is overall, 0 to 100: the files, when they're counted (the bar's own percentage
 * is then about one file, or the bytes), or the percentage; null when that isn't known.
 */
export function overallPercent(value: Progress | null): number | null {
  if (!value) return null;
  if (value.files && value.files.total > 1) return Math.round((value.files.done / value.files.total) * 100);
  return value.percent ?? null;
}
