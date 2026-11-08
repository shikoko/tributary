import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { fileHistory, type CommitRow, type Identity } from "../api";
import { ancestors } from "../lib/graph";
import { baseName } from "../lib/paths";
import { stepThrough } from "../lib/search";
import type { Focus } from "./constants";

const sameAuthor = (commit: CommitRow, name: string, email: string) =>
  email ? commit.authorEmail.toLowerCase() === email.toLowerCase() : commit.authorName === name;

interface Options {
  repoPath: string | null;
  commits: CommitRow[] | undefined;
  byId: Map<string, CommitRow>;
  indexById: Map<string, number>;
  selectedIndex: number | undefined;
  select: (id: string) => void;
  /** The repository's git identity, for "Highlight my commits". */
  user: Identity | null;
  notify: (text: string) => void;
  /** Show a file picker, without refreshing on focus while it's open. */
  whilePicking: (work: () => Promise<void>) => Promise<void>;
}

/**
 * Highlighting: a branch's history, an author's commits, or the commits that changed a
 * file or folder stay bright, and everything else fades.
 */
export function useHighlight({ repoPath, commits, byId, indexById, selectedIndex, select, user, notify, whilePicking }: Options) {
  const [focus, setFocus] = useState<Focus | null>(null);

  const focusIds = useMemo(() => {
    if (!focus || !commits) return null;
    if (focus.kind === "history") return ancestors(focus.commitId, byId);
    if (focus.kind === "path") return new Set(focus.ids);
    return new Set(commits.filter((c) => c.kind === "commit" && sameAuthor(c, focus.name, focus.email)).map((c) => c.id));
  }, [focus, byId, commits]);

  // The highlighted commit went away (after a reset, say): stop highlighting.
  useEffect(() => {
    if (focus?.kind === "history" && commits && !byId.has(focus.commitId)) setFocus(null);
  }, [focus, commits, byId]);

  const highlightingMine = Boolean(
    focus?.kind === "author" && user && (user.email ? focus.email.toLowerCase() === user.email.toLowerCase() : focus.name === user.name),
  );
  const highlightMine = () =>
    highlightingMine || !user ? setFocus(null) : setFocus({ kind: "author", name: user.name ?? "", email: user.email ?? "" });

  /** Highlight the commits that changed a file or folder ("dir/"), and select the newest loaded one. */
  const showHistory = useCallback(
    async (file: string) => {
      if (!repoPath) return;
      const history = await fileHistory(repoPath, file);
      setFocus({ kind: "path", ...history });
      const newest = history.ids.find((id) => indexById.has(id));
      if (newest) select(newest);
      else
        notify(
          history.ids.length
            ? `None of the commits that changed ${baseName(history.path)} are loaded`
            : `No commits changed ${baseName(history.path)}`,
        );
    },
    [repoPath, indexById, select, notify],
  );

  /** Choose a file or folder, and show its history. */
  const pickHistory = (directory: boolean) =>
    whilePicking(async () => {
      if (!repoPath) return;
      const picked = await open({
        directory,
        multiple: false,
        defaultPath: repoPath,
        title: directory ? "Show the history of a folder" : "Show the history of a file",
      });
      if (typeof picked === "string") await showHistory(directory ? `${picked}/` : picked);
    });

  /** The loaded commits that changed the file or folder whose history is shown, in list order. */
  const pathMatches = useMemo(() => {
    if (focus?.kind !== "path") return [];
    return focus.ids
      .map((id) => indexById.get(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
  }, [focus, indexById]);

  const stepHistory = (direction: 1 | -1) => {
    const next = stepThrough(pathMatches, selectedIndex ?? -1, direction);
    if (commits && next !== undefined) select(commits[next].id);
  };

  /** Files in a commit that belong to the history being shown. */
  const isHistoryFile =
    focus?.kind === "path"
      ? (path: string) => (focus.folder ? path === focus.path || path.startsWith(`${focus.path}/`) : focus.names.includes(path))
      : undefined;

  return {
    focus,
    setFocus,
    focusIds,
    clear: useCallback(() => setFocus(null), []),
    highlightHistory: (name: string, commitId: string) => setFocus({ kind: "history", name, commitId }),
    highlightAuthor: (name: string, email: string) => setFocus({ kind: "author", name, email }),
    highlightingMine,
    highlightMine,
    showHistory,
    pickHistory,
    pathMatches,
    stepHistory,
    isHistoryFile,
  };
}

export type Highlight = ReturnType<typeof useHighlight>;
