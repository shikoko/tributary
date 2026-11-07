import { useEffect, useState } from "react";
import { worktrees, type RepoSnapshot, type Worktree } from "../api";

/** The open repository's working trees, read again whenever the repository is reloaded. */
export function useWorktrees(snapshot: RepoSnapshot | null): Worktree[] {
  const [found, setFound] = useState<{ path: string; list: Worktree[] } | null>(null);
  const path = snapshot && !snapshot.bare ? snapshot.path : null;
  useEffect(() => {
    if (!path) return;
    let live = true;
    worktrees(path)
      .then((list) => live && setFound({ path, list }))
      .catch(() => live && setFound({ path, list: [] }));
    return () => {
      live = false;
    };
  }, [path, snapshot]);
  return found && found.path === path ? found.list : [];
}
