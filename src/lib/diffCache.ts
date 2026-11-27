import type { FileDiff } from "../api";

/** How many files' changes are kept, at most. */
const MOST_FILES = 30;
/** How much of their pictures and lines, in characters (about as many bytes): pictures come as data URLs. */
const MOST_CHARACTERS = 150_000_000;

/** How big a file's changes are, near enough, in characters: its pictures and its lines. */
export function weight(diff: FileDiff): number {
  let total = (diff.media?.before?.length ?? 0) + (diff.media?.after?.length ?? 0);
  for (const hunk of diff.hunks) {
    total += hunk.section.length;
    for (const line of hunk.lines) total += line.text.length + 16;
  }
  return total;
}

interface Entry {
  diff: Promise<FileDiff>;
  /** Known once it has loaded. */
  weight: number;
}

/**
 * Files' changes shown lately, or loaded ahead of being shown (the next file, the same file in
 * the next commit), so going back and forth through them doesn't load them again. The oldest
 * go first, when there are more than `most` of them or they weigh more than `mostWeight`.
 * Changes that failed to load, or that `keep` turns down once loaded, aren't kept.
 */
export class DiffCache {
  private entries = new Map<string, Entry>();
  private total = 0;

  constructor(
    private readonly most = MOST_FILES,
    private readonly mostWeight = MOST_CHARACTERS,
  ) {}

  /** The changes under `key`: as kept, or loaded with `load` (and kept, if `keep` says so). */
  get(key: string, load: () => Promise<FileDiff>, keep: (diff: FileDiff) => boolean = () => true): Promise<FileDiff> {
    const kept = this.entries.get(key);
    if (kept) {
      // The newest again.
      this.entries.delete(key);
      this.entries.set(key, kept);
      return kept.diff;
    }
    const entry: Entry = { diff: load(), weight: 0 };
    this.entries.set(key, entry);
    entry.diff.then(
      (diff) => {
        if (this.entries.get(key) !== entry) return;
        if (!keep(diff)) {
          this.entries.delete(key);
          return;
        }
        entry.weight = weight(diff);
        this.total += entry.weight;
        this.trim();
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    this.trim();
    return entry.diff;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Let go of the oldest until there are few enough, light enough; never the newest. */
  private trim() {
    while (this.entries.size > 1 && (this.entries.size > this.most || this.total > this.mostWeight)) {
      const [oldest, entry] = this.entries.entries().next().value as [string, Entry];
      this.entries.delete(oldest);
      this.total -= entry.weight;
    }
  }
}

/** The app's: the changes of the files shown and about to be. */
export const diffs = new DiffCache();
