import { useCallback, useEffect, useState } from "react";
import { lfsHealth, type LfsHealth, type RepoSnapshot } from "../api";
import { useRepoSetting } from "../lib/repoPrefs";

/** Whether `health` reports anything to fix. */
export function needsAttention(health: LfsHealth | null): health is LfsHealth {
  return Boolean(health && (health.notInstalled || health.notSetUp || health.pointers > 0));
}

/**
 * How Git LFS is doing in the open repository. Checked when it opens and when HEAD
 * moves; while something's wrong, after every reload too, so the warning goes away once
 * it's fixed (in a terminal, say). The notice can be dismissed until the problem changes.
 */
export function useLfsHealth(snapshot: RepoSnapshot | null) {
  const [found, setFound] = useState<{ path: string; health: LfsHealth | null } | null>(null);
  const [checks, setChecks] = useState(0);
  const path = snapshot && !snapshot.bare ? snapshot.path : null;
  const head = snapshot?.headCommit ?? null;
  const current = found && found.path === path ? found.health : null;
  const watch = needsAttention(current) ? snapshot : null;

  useEffect(() => {
    if (!path) return;
    let live = true;
    lfsHealth(path)
      .then((health) => live && setFound({ path, health }))
      .catch(() => live && setFound({ path, health: null }));
    return () => {
      live = false;
    };
  }, [path, head, checks, watch]);

  const recheck = useCallback(() => setChecks((count) => count + 1), []);
  // Dismissed: hidden until the problem changes.
  const signature = current ? `${current.notInstalled}/${current.notSetUp}/${current.pointers}` : "";
  const [dismissed, setDismissed] = useRepoSetting<string>("lfsNoticeDismissed", path, "");
  return {
    health: current,
    recheck,
    /** Something to fix that the user hasn't dismissed. */
    notice: needsAttention(current) && dismissed !== signature ? current : null,
    dismiss: () => setDismissed(signature),
  };
}
export type LfsHealthState = ReturnType<typeof useLfsHealth>;
