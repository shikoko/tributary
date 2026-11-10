import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { submodules as readSubmodules, type Action, type RepoSnapshot, type Submodule } from "../api";
import { submoduleNotice } from "../lib/submodules";
import type { Running } from "./constants";
import type { SubmoduleUpdates } from "./usePreferences";

const NONE: Submodule[] = [];

/** Wait this long after the repository changes before looking, so quick reloads count once. */
const SETTLE = 500;

/** Actions that can move the commits recorded for submodules. */
const SWITCHES = new Set<Action["kind"]>([
  "checkoutBranch",
  "checkoutRemoteBranch",
  "checkoutCommit",
  "createBranch",
  "pull",
  "fetchLatest",
  "merge",
  "rebase",
]);

interface Options {
  snapshot: RepoSnapshot | null;
  mode: SubmoduleUpdates;
  act: (action: Action, kind?: Running) => Promise<boolean>;
}

/**
 * The repository's submodules and where each is, looked at again when the checked-out
 * commit or your changes move (a submodule's new commits show up as a change). After a
 * checkout or pull leaves some behind, they're offered to update, or updated, as the
 * setting says.
 */
export function useSubmodules({ snapshot, mode, act }: Options) {
  const [found, setFound] = useState<{ key: string; list: Submodule[] } | null>(null);
  const [asked, setAsked] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  /** Submodules a checkout or pull left away from their recorded commits (ahead counts too). */
  const [moved, setMoved] = useState<{ path: string; submodules: Set<string> } | null>(null);
  /** A checkout or pull just ran here: update what it left behind once the list is read again (at this count). */
  const pending = useRef<number | null>(null);
  const path = snapshot && !snapshot.bare ? snapshot.path : null;
  const changes = snapshot?.worktree ? [...snapshot.worktree.staged, ...snapshot.worktree.unstaged].map((file) => `${file.status}:${file.path}`) : [];
  const key = path ? [path, snapshot?.headCommit, changes.join("\n"), asked].join("|") : "";

  useEffect(() => {
    if (!path) return;
    let live = true;
    const timer = setTimeout(() => {
      readSubmodules(path)
        .then((list) => live && setFound({ key, list }))
        .catch(() => live && setFound({ key, list: [] }));
    }, SETTLE);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` covers what the answer depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Until the new answer arrives, keep the last one for the same repository (the same list
  // from one render to the next, so what depends on it doesn't run again for nothing).
  const list = useMemo(() => (found && path && found.key.startsWith(`${path}|`) ? found.list : NONE), [found, path]);
  const fresh = found?.key === key;

  const update = useCallback((paths: string[]) => act({ kind: "updateSubmodules", paths }, "submodules"), [act]);

  // Updating without asking, right after a checkout or pull.
  useEffect(() => {
    if (!fresh || pending.current === null || asked < pending.current) return;
    pending.current = null;
    const late = list.filter((submodule) => submodule.state === "behind" || submodule.state === "different" || submodule.state === "ahead");
    if (path) setMoved({ path, submodules: new Set(late.map((submodule) => submodule.path)) });
    if (mode === "always" && late.length > 0) update(late.map((submodule) => submodule.path));
  }, [fresh, asked, list, mode, update, path]);

  const movedHere = moved && moved.path === path ? moved.submodules : undefined;
  const notice = mode === "never" ? null : submoduleNotice(list, movedHere);
  // A dismissed notice stays away until it's about other submodules or commits.
  const noticeKey = notice ? JSON.stringify(list.filter((submodule) => notice.paths.includes(submodule.path)).map((s) => [s.path, s.recorded])) : null;

  return {
    list,
    /** What to offer in the banner, if anything. */
    notice: notice && noticeKey !== dismissed ? notice : null,
    dismiss: () => setDismissed(noticeKey),
    update,
    refresh: useCallback(() => setAsked((count) => count + 1), []),
    /**
     * An action ran: look again (it may have updated, staged or moved them). After a checkout
     * or pull, offer to update the ones it left behind (or update them, if that's the setting).
     */
    ran: (action: Action) => {
      if (!path || list.length === 0) return;
      if (SWITCHES.has(action.kind)) pending.current = asked + 1;
      setAsked(asked + 1);
    },
  };
}

export type Submodules = ReturnType<typeof useSubmodules>;
