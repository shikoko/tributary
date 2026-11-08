// Choosing changed lines in a diff, to stage, unstage or discard just those. A line is
// known by its sign and number: "+12" is line 12 after the change (added), "-7" line 7
// before it (removed). Unchanged lines can't be chosen.
import type { DiffLine, Hunk } from "../api";

export function lineKey(line: DiffLine): string | null {
  if (line.kind === "added" && line.new !== null) return `+${line.new}`;
  if (line.kind === "removed" && line.old !== null) return `-${line.old}`;
  return null;
}

/** The changed lines' keys, in the order they're shown. */
export function changedKeys(hunks: Hunk[]): string[] {
  return hunks.flatMap((hunk) => hunk.lines.map(lineKey).filter((key): key is string => key !== null));
}

/** A hunk's changed lines. */
export function hunkKeys(hunk: Hunk): string[] {
  return changedKeys([hunk]);
}

/** The keys from `from` to `to` (either way round), in `order`. */
export function keysBetween(order: string[], from: string, to: string): string[] {
  const [a, b] = [order.indexOf(from), order.indexOf(to)];
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The line numbers to send: added lines by their new number, removed by their old. */
export function linesOf(keys: Iterable<string>): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  for (const key of keys) {
    const number = Number(key.slice(1));
    if (key.startsWith("+")) added.push(number);
    else if (key.startsWith("-")) removed.push(number);
  }
  const ascending = (x: number, y: number) => x - y;
  return { added: added.sort(ascending), removed: removed.sort(ascending) };
}

/** "3 lines" or "1 line". */
export function linesLabel(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}
