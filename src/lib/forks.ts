// Your forks on GitHub: their names, which to sync by themselves and when, and what to say
// about how syncing went. The Forks screen (components/ForksView) and the automatic sync
// (app/useForkSync) share these.
import type { Fork, ForkSync, SyncOutcome } from "../api";

/** How often the forks with Auto on are synced, while Tributary is open. */
export type ForkSyncEvery = "hour" | "day" | "off";

const EVERY_MS: Record<Exclude<ForkSyncEvery, "off">, number> = { hour: 60 * 60_000, day: 24 * 60 * 60_000 };

/** A fork's name as GitHub writes it, like "rosa-bell/notebook-sync": how Auto remembers it. */
export const forkKey = (fork: Pick<Fork, "owner" | "name">) => `${fork.owner}/${fork.name}`;

/** Its original's, like "mayachen/notebook-sync". */
export const parentKey = (fork: Fork) => `${fork.parent.owner}/${fork.parent.name}`;

/** Whether the forks with Auto on are due to be synced at `now`, last synced at `last` (both in milliseconds). */
export function syncDue(every: ForkSyncEvery, last: number | null, now: number): boolean {
  if (every === "off") return false;
  return last === null || now - last >= EVERY_MS[every];
}

/** Whether a sync brought the original's commits in. */
export const synced = (outcome: SyncOutcome) => outcome === "fastForward" || outcome === "merged";

/** What syncing a fork did, in a sentence without its full stop, under it. */
export function outcomeText(sync: ForkSync): string {
  switch (sync.outcome) {
    case "fastForward":
      return "Synced: it moved straight on to the original's commits";
    case "merged":
      return "Synced: the original's commits were merged into it, with a merge commit";
    case "upToDate":
      return "It already had all of the original's commits";
    case "conflict":
      return "Its own changes clash with the original's";
    case "refused":
      return sync.message || "GitHub didn't sync it";
  }
}

/** How one fork's automatic sync went: a sync's outcome, or "failed" when it couldn't be asked. */
export interface ForkRunResult {
  name: string;
  outcome: SyncOutcome | "failed";
  message: string;
}

/** The last automatic sync: when, and how each fork with Auto on went. */
export interface ForkRun {
  /** Milliseconds since the epoch. */
  time: number;
  results: ForkRunResult[];
}

/** "a", "a and b", "a, b and c". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What an automatic sync did, in a sentence or two; null when it had nothing to say (all up to date). */
export function describeForkRun(run: ForkRun): string | null {
  const done = run.results.filter((result) => result.outcome === "fastForward" || result.outcome === "merged").map((result) => result.name);
  const clashed = run.results.filter((result) => result.outcome === "conflict").map((result) => result.name);
  const failed = run.results.filter((result) => result.outcome === "refused" || result.outcome === "failed");
  const parts: string[] = [];
  if (done.length > 0) parts.push(`Synced ${listNames(done)} with ${done.length === 1 ? "its original" : "their originals"}.`);
  if (clashed.length > 0)
    parts.push(
      `${listNames(clashed)} couldn't sync by ${clashed.length === 1 ? "itself: its" : "themselves: their"} own changes clash with the original's.`,
    );
  for (const result of failed) parts.push(`${result.name} couldn't sync: ${result.message.replace(/\.$/, "")}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** A bar's width for `count` commits, where `most` gets `full` pixels: never under 6 when there are any. */
export function barWidth(count: number, most: number, full: number): number {
  if (count <= 0 || most <= 0) return 0;
  return Math.max(6, Math.round((Math.min(count, most) / most) * full));
}

/** A count of commits short enough for beside a bar: 999, then 1.7k, 17k, 170k, then 1.7M. */
export function shortCount(count: number): string {
  if (count < 1000) return String(count);
  const [value, unit] = count < 999_500 ? [count / 1000, "k"] : [count / 1_000_000, "M"];
  return `${value < 9.95 ? Math.round(value * 10) / 10 : Math.round(value)}${unit}`;
}
