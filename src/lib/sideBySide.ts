// Showing a diff's lines before and after the change side by side.
import type { DiffLine } from "../api";

/** A row of the two columns: indexes into the hunk's lines, or null where a side has none. */
export interface SplitRow {
  left: number | null;
  right: number | null;
}

/**
 * The rows of a hunk side by side: unchanged lines on both sides, and a run of removed
 * lines next to the added lines that follow it, in pairs. Each side is an index into the
 * hunk's lines, or null where it has no line.
 */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind === "context") {
      rows.push({ left: index, right: index });
      index++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (index < lines.length && lines[index].kind === "removed") removed.push(index++);
    while (index < lines.length && lines[index].kind === "added") added.push(index++);
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
      rows.push({ left: removed[pair] ?? null, right: added[pair] ?? null });
    }
  }
  return rows;
}
