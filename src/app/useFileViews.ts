import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prefetchLfs, WORKTREE_ID, type CommitRow, type DiffSource, type FileChange, type RepoSnapshot } from "../api";
import { commitTargets, findTarget, highlightedFirst, rangeTargets, worktreeTargets, type CommitSteps, type DiffTarget, type ShownDiff } from "../lib/diffTargets";
import type { CommitDetailsCache } from "./useCommitDetails";
import { useComparison } from "./useComparison";
import type { Highlight } from "./useHighlight";
import type { Selection } from "./useSelection";

interface Options {
  snapshot: RepoSnapshot;
  selection: Selection;
  details: CommitDetailsCache;
  highlight: Highlight;
  byId: Map<string, CommitRow>;
  /** Close the other views over the commit list (team activity, a pull request). */
  closeOthers: () => void;
  /** An open pull request's files, whose changes open over it. */
  request: RequestRange | null;
}

/** An open pull request's files: changed from where it split (`base`) to its latest commit (`head`). */
export interface RequestRange {
  /** Changes with its commits: its diffs aren't shown for another. */
  key: string;
  base: string;
  head: string;
  files: FileChange[];
  /** What the changes are called in their header: its branch and the one it goes into, like "art/barber-v2 → main". */
  label: string;
}

/**
 * The views of files over the commit list: a file's changes (in a commit, your changes,
 * between two compared commits, or in an open pull request), and who changed each line.
 * Also the comparison of two commits or branches, whose files open in the changes.
 */
export function useFileViews({ snapshot, selection, details, highlight, byId, closeOthers, request }: Options) {
  // Two commits or branches compared, in the details panel instead of a commit.
  const comparing = useComparison(snapshot.path, selection.selectedId);
  const { request: compareRequest, comparison } = comparing;
  const compared = useMemo(
    () => (compareRequest && comparison?.base ? { ...compareRequest, ...comparison, base: comparison.base } : null),
    [compareRequest, comparison],
  );

  // The diff view: a file's changes in the selected commit, in your changes, or between two compared.
  const [diffAt, setDiffAt] = useState<(ShownDiff & { origin: string }) | null>(null);
  const compareOrigin = compared && comparing.key ? `compare:${comparing.key}` : null;
  const origin = compareOrigin ?? (selection.selected && !selection.multi ? selection.selectedId : null);
  // An open pull request's files: shown over it, whatever is selected under it.
  const requestOrigin = request ? `request:${request.key}` : null;
  const commitFiles = diffAt && diffAt.origin !== WORKTREE_ID ? details.cache.current.get(diffAt.origin)?.files : undefined;
  const diffTargets: DiffTarget[] = useMemo(() => {
    if (!diffAt) return [];
    if (diffAt.origin === WORKTREE_ID) return worktreeTargets(snapshot.worktree);
    if (diffAt.origin === requestOrigin && request) return rangeTargets(request.base, request.head, request.files, request.label);
    if (diffAt.origin === compareOrigin && compared) return rangeTargets(compared.base, compared.to.id, compared.files, `${compared.from.label} → ${compared.to.label}`);
    return commitTargets(diffAt.origin, highlightedFirst(commitFiles ?? [], highlight.isHistoryFile), byId.get(diffAt.origin)?.kind === "stash");
  }, [diffAt, snapshot.worktree, commitFiles, highlight.isHistoryFile, byId, compareOrigin, compared, requestOrigin, request]);
  const diffIndex = diffAt && (diffAt.origin === origin || diffAt.origin === requestOrigin) ? findTarget(diffTargets, diffAt.source, diffAt.path) : -1;
  const shownDiff = diffIndex >= 0 ? diffTargets[diffIndex] : null;
  // Another commit was selected, or the file isn't changed any more.
  useEffect(() => {
    if (diffAt && !shownDiff) setDiffAt(null);
  }, [diffAt, shownDiff]);

  // From a commit's file to the same file in the commit before or after it (the list's
  // commits, newest first), keeping the changes open: that commit is selected, and the
  // details follow. One without the file shows its first file; one with no files is passed.
  const commitRows = useMemo(() => snapshot.commits.filter((commit) => commit.kind === "commit"), [snapshot.commits]);
  const fromCommit = diffAt && shownDiff?.source.kind === "commit" && shownDiff.source.id === diffAt.origin ? diffAt.origin : null;
  const commitAt = useMemo(() => (fromCommit ? commitRows.findIndex((commit) => commit.id === fromCommit) : -1), [commitRows, fromCommit]);
  // The last step's direction: what's got ready next is the commit after it that way.
  const direction = useRef<1 | -1>(1);
  const stepping = useRef(0);
  const { select } = selection;
  const stepCommit = useCallback(
    async (delta: 1 | -1) => {
      if (commitAt < 0 || !diffAt) return;
      direction.current = delta;
      const step = ++stepping.current;
      for (let at = commitAt + delta; at >= 0 && at < commitRows.length; at += delta) {
        const commit = commitRows[at];
        const loaded = await details.load(commit.id).catch(() => null);
        // Stepped again, or away, meanwhile.
        if (step !== stepping.current || !loaded) return;
        const targets = commitTargets(commit.id, highlightedFirst(loaded.files, highlight.isHistoryFile));
        const target = targets.find((candidate) => candidate.file.path === diffAt.path) ?? targets[0];
        if (!target) continue;
        select(commit.id);
        setDiffAt({ origin: commit.id, source: target.source, path: target.file.path });
        return;
      }
    },
    [commitAt, commitRows, diffAt, details, highlight.isHistoryFile, select],
  );
  const commitSteps: CommitSteps | null =
    commitAt >= 0 ? { commit: commitRows[commitAt], position: commitAt, total: commitRows.length, more: Boolean(snapshot.truncated), onStep: (delta) => void stepCommit(delta) } : null;

  // Got ready while a commit's file is shown: its Git LFS files, all at once, and the commit
  // after it (the way the last step went): its Git LFS files too, and the same file's changes.
  const [nearby, setNearby] = useState<DiffTarget[]>([]);
  const shownPath = shownDiff?.file.path;
  useEffect(() => {
    if (commitAt < 0 || !shownPath) return;
    prefetchLfs(snapshot.path, commitRows[commitAt].id);
    const next = commitRows[commitAt + direction.current];
    if (!next) return;
    let current = true;
    details.load(next.id).then(
      (loaded) => {
        if (!current) return;
        const targets = commitTargets(next.id, highlightedFirst(loaded.files, highlight.isHistoryFile));
        const target = targets.find((candidate) => candidate.file.path === shownPath) ?? targets[0];
        setNearby(target ? [target] : []);
        prefetchLfs(snapshot.path, next.id);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [commitAt, commitRows, shownPath, snapshot.path, details, highlight.isHistoryFile]);

  // Who changed each line of a file: at a commit, or as it is in your working tree.
  const [blameAt, setBlameAt] = useState<{ path: string; at: string | null } | null>(null);

  const showChanges = (file: FileChange, source: DiffSource) => {
    setBlameAt(null);
    closeOthers();
    if (origin) setDiffAt({ origin, source, path: file.path });
  };
  /** A file of the open pull request: its changes over the pull request, which stays open under them. */
  const showRequestChanges = (file: FileChange) => {
    if (!request || !requestOrigin) return;
    setBlameAt(null);
    setDiffAt({ origin: requestOrigin, source: { kind: "range", from: request.base, to: request.head }, path: file.path });
  };
  const showBlame = (path: string, source: DiffSource) => {
    setDiffAt(null);
    closeOthers();
    setBlameAt({ path, at: source.kind === "commit" ? source.id : source.kind === "range" ? source.to : null });
  };
  const stepDiff = (index: number) => {
    const target = diffTargets[index];
    if (target && diffAt) setDiffAt({ origin: diffAt.origin, source: target.source, path: target.file.path });
  };
  const closeDiff = useCallback(() => setDiffAt(null), []);
  const closeBlame = useCallback(() => setBlameAt(null), []);

  /** The changes shown are an open pull request's: over it, with a way back to it. */
  const overRequest = Boolean(shownDiff && diffAt && diffAt.origin === requestOrigin);
  return {
    comparing,
    compared,
    diffTargets,
    diffIndex,
    shownDiff,
    showChanges,
    showRequestChanges,
    overRequest,
    stepDiff,
    closeDiff,
    commitSteps,
    nearby: commitSteps ? nearby : [],
    blameAt,
    showBlame,
    closeBlame,
  };
}

export type FileViews = ReturnType<typeof useFileViews>;
