import { useEffect, useState } from "react";
import type { CommitRow } from "../api";
import type { RefEntry, RefPill } from "./refs";

/**
 * A branch's lane in the graph: its own commits, from its tip down its first parents while
 * they stay in its column, to `last`, the oldest of them; the line from `last` goes on to
 * the commit it was branched from (in another lane), or nowhere at the start of history.
 */
export interface Lane {
  ids: Set<string>;
  last: string;
  column: number;
}

/** A branch or tag label the pointer is on, in the sidebar or the graph. */
export interface LaneLabel {
  /** "remote": a remote branch, like origin/feature. */
  kind: "branch" | "remote" | "tag";
  name: string;
}

/** The label a branch or tag in the sidebar is, to light its lanes (none for a stash or a hidden branch). */
export function entryLane(entry: RefEntry): LaneLabel | null {
  return entry.kind === "stash" || entry.hidden ? null : { kind: entry.kind, name: entry.name };
}

/** The label a branch or tag label in the graph is, to light its lanes (none for a stash). */
export function pillLane(pill: RefPill): LaneLabel | null {
  if (pill.kind === "tag") return { kind: "tag", name: pill.name };
  if (pill.kind === "branch") return { kind: pill.local ? "branch" : "remote", name: pill.name };
  return null;
}

/**
 * The commits a label's lanes start from. For a tag, its commit. For a branch, its own and
 * those of its copies on remotes (the branches of the same name there), which can be ahead
 * of it or behind: one stands for all of them, as in the sidebar.
 */
export function laneTips(commits: CommitRow[], label: LaneLabel): string[] {
  const tips: string[] = [];
  // origin/feature/door is the remote origin's feature/door.
  const branchOf = (remote: string) => remote.slice(remote.indexOf("/") + 1);
  const name = label.kind === "remote" ? branchOf(label.name) : label.name;
  for (const commit of commits) {
    const at = commit.refs.some((ref) =>
      label.kind === "tag"
        ? ref.kind === "tag" && ref.name === name
        : (ref.kind === "branch" && ref.name === name) || (ref.kind === "remote" && branchOf(ref.name) === name),
    );
    if (at) tips.push(commit.id);
  }
  return tips;
}

/**
 * The lanes from commits `tipIds`, leaving out those of tips already in another's lane (a
 * branch's copy that's ahead of it has the branch's commits in its own lane).
 */
export function lanesOf(commits: CommitRow[], indexById: Map<string, number>, tipIds: string[]): Lane[] {
  const lanes: Lane[] = [];
  // Newest first: the lane from a newer tip can take in an older one.
  const tips = tipIds.filter((id) => indexById.has(id)).sort((a, b) => indexById.get(a)! - indexById.get(b)!);
  for (const tip of tips) {
    if (lanes.some((lane) => lane.ids.has(tip))) continue;
    const lane = laneOf(commits, indexById, tip);
    if (lane) lanes.push(lane);
  }
  return lanes;
}

/** The lane of the branch (or tag) at commit `tipId`, or null when that commit isn't loaded. */
export function laneOf(commits: CommitRow[], indexById: Map<string, number>, tipId: string): Lane | null {
  const start = indexById.get(tipId);
  if (start === undefined) return null;
  const column = commits[start].graph.column;
  const ids = new Set([tipId]);
  let current = commits[start];
  for (;;) {
    const parent = current.parents.length > 0 ? indexById.get(current.parents[0]) : undefined;
    if (parent === undefined || commits[parent].graph.column !== column) break;
    current = commits[parent];
    ids.add(current.id);
  }
  return { ids, last: current.id, column };
}

/** How long the pointer rests on a branch's label before its lane lights up, in milliseconds. */
const LIGHT_AFTER = 120;
/** How long a lane stays lit after the pointer leaves its label: time to reach the next one. */
const KEEP_FOR = 80;

/**
 * Lights lanes up (`light`) as the pointer moves over branches' labels: `hover` with the
 * label it's on, or null when it leaves. A lane lights up a moment after the
 * pointer reaches a label, so passing over a list of branches doesn't flash the graph; from
 * one lit lane to the next, it changes straight away.
 */
export function laneHover<T>(light: (label: T | null) => void) {
  let lit: T | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (label: T | null) => {
    lit = label;
    light(label);
  };
  return {
    hover(label: T | null) {
      clearTimeout(timer);
      if (label === null) {
        // Before its lane lit up, there's nothing to put out.
        if (lit !== null) timer = setTimeout(() => set(null), KEEP_FOR);
      } else if (lit !== null) set(label);
      else timer = setTimeout(() => set(label), LIGHT_AFTER);
    },
    stop: () => clearTimeout(timer),
  };
}

/** The label whose lanes are lit, and `hover` to light another's (laneHover). */
export function useLaneHover(): [LaneLabel | null, (label: LaneLabel | null) => void] {
  const [label, setLabel] = useState<LaneLabel | null>(null);
  const [lanes] = useState(() => laneHover<LaneLabel>(setLabel));
  useEffect(() => lanes.stop, [lanes]);
  return [label, lanes.hover];
}
