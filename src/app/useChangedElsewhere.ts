import { useEffect, useState } from "react";
import { changedElsewhere, type Overlap, type RepoSnapshot } from "../api";

/** Wait this long after the repository changes before checking, so quick reloads count once. */
const SETTLE = 800;

/**
 * Files you're working on (uncommitted, or committed on your branch) that other recently
 * changed branches also changed since yours split off. Checked again when your changes,
 * your branch or the other branches move.
 */
export function useChangedElsewhere(snapshot: RepoSnapshot | null): Overlap[] {
  const [found, setFound] = useState<{ key: string; overlaps: Overlap[] } | null>(null);
  const path = snapshot && !snapshot.bare ? snapshot.path : null;
  const files = snapshot?.worktree
    ? [...snapshot.worktree.staged, ...snapshot.worktree.unstaged].flatMap((file) => (file.oldPath ? [file.oldPath, file.path] : [file.path]))
    : [];
  // What the answer depends on: where you are, your changes, and where every branch points.
  const tips = (snapshot?.commits ?? [])
    .flatMap((commit) => commit.refs.filter((ref) => ref.kind === "branch" || ref.kind === "remote").map((ref) => `${ref.name}@${commit.id}`))
    .join(",");
  const key = path ? [path, snapshot?.headCommit, files.join("\n"), tips].join("|") : "";

  useEffect(() => {
    if (!path) return;
    let live = true;
    const timer = setTimeout(() => {
      changedElsewhere(path, files)
        .then((overlaps) => live && setFound({ key, overlaps }))
        .catch(() => live && setFound({ key, overlaps: [] }));
    }, SETTLE);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` covers `files`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Until the new answer arrives, keep the last one for the same repository.
  return found && path && found.key.startsWith(`${path}|`) ? found.overlaps : [];
}
