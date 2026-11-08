import { useCallback } from "react";
import type { RepoSnapshot, Visibility } from "../api";
import { NO_VISIBILITY, useRepoSetting } from "../lib/repoPrefs";
import { DEFAULT_PROTECTED } from "../components/Safety";

const unique = (names: string[]) => [...new Set(names)];
const toggled = (names: string[], name: string) => (names.includes(name) ? names.filter((other) => other !== name) : [...names, name]);

/**
 * What's remembered for each repository: hidden and soloed branches (changing them
 * reloads the graph), pinned ones, protected ones, and a dismissed prune hint.
 */
export function useRepositorySettings(snapshot: RepoSnapshot | null, refresh: () => void) {
  const path = snapshot?.path ?? null;
  const [visibility, setVisibility] = useRepoSetting<Visibility>("visibility", path, NO_VISIBILITY);
  const [pins, setPins] = useRepoSetting<string[]>("pins", path, []);
  // Protected branches can't be deleted, and rewriting them (rebase, hard reset, force
  // push) needs their name typed first.
  const [protectedBranches, setProtectedBranches] = useRepoSetting<string[]>("protectedBranches", path, DEFAULT_PROTECTED);
  const [pruneHintDismissed, setPruneHintDismissed] = useRepoSetting<string>("pruneHintDismissed", path, "");

  const changeVisibility = useCallback(
    (change: (current: Visibility) => Visibility) => {
      setVisibility(change);
      refresh();
    },
    [setVisibility, refresh],
  );
  /** Hide refs (full names), or show them again. While soloing, hiding means no longer showing only it, and showing means adding it. */
  const setHidden = (names: string[], hidden: boolean) =>
    changeVisibility((current) =>
      current.solo.length > 0
        ? { ...current, solo: hidden ? current.solo.filter((n) => !names.includes(n)) : unique([...current.solo, ...names]) }
        : { ...current, hidden: hidden ? unique([...current.hidden, ...names]) : current.hidden.filter((n) => !names.includes(n)) },
    );
  const soloing = visibility.solo.length > 0;

  // "3 branches gone from origin · Clean up", until they're pruned or the hint is
  // dismissed (for those branches: it comes back when another one goes).
  const goneSignature = snapshot?.goneBranches.join("\n") ?? "";
  const pruneHint =
    snapshot && snapshot.goneBranches.length > 0 && goneSignature !== pruneHintDismissed
      ? { count: snapshot.goneBranches.length, remote: snapshot.remotes.length === 1 ? snapshot.remotes[0] : "the remote" }
      : null;

  return {
    visibility,
    setHidden,
    /** Show only these refs (full names), adding them to what's already soloed. */
    solo: (names: string[]) => changeVisibility((current) => ({ ...current, solo: unique([...current.solo, ...names]) })),
    showAllBranches: () => changeVisibility(() => NO_VISIBILITY),
    soloing,
    hiddenCount: soloing ? visibility.solo.length : visibility.hidden.length,
    pins,
    togglePin: (name: string) => setPins((current) => toggled(current, name)),
    protectedBranches,
    setProtectedBranches,
    toggleProtected: (name: string) => setProtectedBranches(toggled(protectedBranches, name)),
    /** The checked-out branch, if it's protected. */
    protectedHead: snapshot?.headBranch && protectedBranches.includes(snapshot.headBranch) ? snapshot.headBranch : null,
    pruneHint,
    dismissPruneHint: () => setPruneHintDismissed(goneSignature),
  };
}

export type RepositorySettings = ReturnType<typeof useRepositorySettings>;
