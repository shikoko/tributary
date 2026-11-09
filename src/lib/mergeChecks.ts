// Whether merging (or rebasing onto) a branch would conflict, asked of git without merging,
// and said in a few words for menus.
import { mergeCheck, type MergeCheck } from "../api";
import { plural } from "./format";

/** Answers are kept this long: a menu opened again soon after doesn't ask again. */
const KEEP_FOR = 30_000;
const known = new Map<string, { at: number; check: Promise<MergeCheck> }>();

/**
 * How merging `from` into `into` (the checked-out commit, when null) would go. `at` is what
 * the answer depends on besides the names (like the commits they point to), so a new commit
 * or a fetch asks again.
 */
export function checkMerge(repo: string, from: string, into: string | null, at: string): Promise<MergeCheck> {
  const key = `${repo}\n${from}\n${into ?? ""}\n${at}`;
  const now = Date.now();
  const kept = known.get(key);
  if (kept && now - kept.at < KEEP_FOR) return kept.check;
  const check = mergeCheck(repo, from, into ?? undefined);
  known.set(key, { at: now, check });
  // A failure isn't kept: the next look asks again.
  check.catch(() => known.delete(key));
  for (const [old, { at }] of known) if (now - at >= KEEP_FOR) known.delete(old);
  return check;
}

/** "Conflicts in Hero.uasset", "Conflicts in Hero.uasset and 2 more". */
export function conflictText(check: MergeCheck): string {
  const [first] = check.conflicts;
  const name = first ? first.slice(first.lastIndexOf("/") + 1) : "";
  if (check.conflictCount <= 1) return `conflicts in ${name}`;
  return `conflicts in ${name} and ${plural(check.conflictCount - 1, "more file")}`;
}

/** A few words on how a merge (or a rebase onto it) would go, or null when git couldn't tell. */
export function describeMergeCheck(check: MergeCheck, kind: "merge" | "rebase"): { text: string; tone: "good" | "bad" | "quiet" } | null {
  switch (check.outcome) {
    case "upToDate":
      return { text: kind === "merge" ? "Already merged: nothing to bring in" : "Already on top of it: nothing to rebase", tone: "quiet" };
    case "fastForward":
      return { text: `Moves forward ${plural(check.incoming, "commit")}: no conflicts`, tone: "good" };
    case "clean":
      return { text: kind === "merge" ? `${plural(check.incoming, "commit")}, no conflicts` : `${plural(check.outgoing, "commit")} to replay, no conflicts expected`, tone: "good" };
    case "conflicts": {
      const text = conflictText(check);
      return { text: kind === "merge" ? text[0].toUpperCase() + text.slice(1) : `May stop at ${text}`, tone: "bad" };
    }
    default:
      return null;
  }
}

/** The conflicting files, one per line, for a tooltip (the first 12). */
export function conflictList(check: MergeCheck): string {
  const shown = check.conflicts.slice(0, 12);
  const more = check.conflictCount - shown.length;
  return [...shown, ...(more > 0 ? [`and ${plural(more, "more file")}`] : [])].join("\n");
}
