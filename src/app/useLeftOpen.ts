import { useEffect, useRef, useState } from "react";
import type { PullRequest } from "../api";

/**
 * Changes when a pull request leaves the open list (merged or closed on the site): the
 * remote's branches have moved, so it's worth fetching now rather than at the next
 * scheduled fetch. Not for the first list, nor when another repository opens.
 */
export function useLeftOpen(repoPath: string | null, list: PullRequest[]): string {
  const seen = useRef<{ path: string | null; open: Set<number> } | null>(null);
  const [nudge, setNudge] = useState("");
  useEffect(() => {
    const open = new Set(list.map((pr) => pr.number));
    const before = seen.current;
    seen.current = { path: repoPath, open };
    if (!before || before.path !== repoPath) return;
    const gone = [...before.open].filter((number) => !open.has(number));
    if (gone.length > 0) setNudge(`${repoPath}#${gone.join(",")}@${Date.now()}`);
  }, [repoPath, list]);
  return nudge;
}
