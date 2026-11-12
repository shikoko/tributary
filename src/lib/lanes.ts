import { useEffect, useState } from "react";
import type { CommitRow } from "../api";

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
 * commit of the label it's on, or null when it leaves. A lane lights up a moment after the
 * pointer reaches a label, so passing over a list of branches doesn't flash the graph; from
 * one lit lane to the next, it changes straight away.
 */
export function laneHover(light: (commitId: string | null) => void) {
  let lit: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (commitId: string | null) => {
    lit = commitId;
    light(commitId);
  };
  return {
    hover(commitId: string | null) {
      clearTimeout(timer);
      if (commitId === null) {
        // Before its lane lit up, there's nothing to put out.
        if (lit !== null) timer = setTimeout(() => set(null), KEEP_FOR);
      } else if (lit !== null) set(commitId);
      else timer = setTimeout(() => set(commitId), LIGHT_AFTER);
    },
    stop: () => clearTimeout(timer),
  };
}

/** The commit whose lane is lit, and `hover` to light another (laneHover). */
export function useLaneHover(): [string | null, (commitId: string | null) => void] {
  const [tip, setTip] = useState<string | null>(null);
  const [lanes] = useState(() => laneHover(setTip));
  useEffect(() => lanes.stop, [lanes]);
  return [tip, lanes.hover];
}
