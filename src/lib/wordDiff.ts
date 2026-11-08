import type { DiffLine } from "../api";

/** A piece of a line, and whether it's the part that changed. */
export interface Segment {
  text: string;
  changed: boolean;
}

/**
 * The part of a changed line that's different from the line it replaced: everything
 * between what they have in common at the start and at the end. Good for the usual edit
 * (a word or a value changed) and cheap enough for long files.
 */
export function changedSpan(before: string, after: string): { start: number; endBefore: number; endAfter: number } {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let end = 0;
  while (end < shortest - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, endBefore: before.length - end, endAfter: after.length - end };
}

/** Split `text` into the unchanged start, the changed middle and the unchanged end. */
function split(text: string, start: number, end: number): Segment[] {
  return [
    { text: text.slice(0, start), changed: false },
    { text: text.slice(start, end), changed: true },
    { text: text.slice(end), changed: false },
  ].filter((segment) => segment.text !== "");
}

/**
 * For each line of a hunk, its segments, with the changed words marked where a run of
 * removed lines is followed by added ones: the first removed line pairs with the first
 * added one, and so on. Lines without a partner, and lines changed almost completely,
 * aren't split.
 */
export function wordSegments(lines: DiffLine[]): (Segment[] | null)[] {
  const result: (Segment[] | null)[] = lines.map(() => null);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "removed") {
      i++;
      continue;
    }
    const removedStart = i;
    while (i < lines.length && lines[i].kind === "removed") i++;
    const addedStart = i;
    while (i < lines.length && lines[i].kind === "added") i++;
    const pairs = Math.min(addedStart - removedStart, i - addedStart);
    for (let pair = 0; pair < pairs; pair++) {
      const before = lines[removedStart + pair].text;
      const after = lines[addedStart + pair].text;
      const { start, endBefore, endAfter } = changedSpan(before, after);
      const kept = start + (before.length - endBefore);
      // Mostly different: marking words wouldn't help.
      if (kept < Math.max(before.length, after.length) * 0.3) continue;
      result[removedStart + pair] = split(before, start, endBefore);
      result[addedStart + pair] = split(after, start, endAfter);
    }
  }
  return result;
}
