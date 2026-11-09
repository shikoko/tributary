import { useEffect, useState } from "react";
import type { MergeCheck } from "../api";
import { checkMerge, conflictList, describeMergeCheck } from "../lib/mergeChecks";

/**
 * A menu item's second line: whether merging `from` into the checked-out branch (or
 * rebasing onto it) would conflict, worked out by git without merging. "Checking…" holds
 * the line's place meanwhile, so the menu doesn't grow under the pointer.
 */
export function MergeHint({ repo, from, at, kind }: { repo: string; from: string; at: string; kind: "merge" | "rebase" }) {
  const [check, setCheck] = useState<MergeCheck | null | "failed">(null);
  useEffect(() => {
    let current = true;
    checkMerge(repo, from, null, at)
      .then((found) => current && setCheck(found))
      .catch(() => current && setCheck("failed"));
    return () => {
      current = false;
    };
  }, [repo, from, at]);
  if (check === null) return <span>Checking for conflicts…</span>;
  const said = check === "failed" ? null : describeMergeCheck(check, kind);
  if (!said || check === "failed") return <span>Couldn't check for conflicts</span>;
  return (
    <span className={said.tone} title={check.outcome === "conflicts" ? conflictList(check) : undefined}>
      {said.text}
    </span>
  );
}
