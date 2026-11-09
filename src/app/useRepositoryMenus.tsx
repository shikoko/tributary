import { useContext } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Action, CommitRow, DiffSource, FileChange, FileChecks, RepoSnapshot, Worktree } from "../api";
import type { ToastMessage } from "../components/Toast";
import { rewritable } from "../lib/graph";
import type { LfsLocks } from "../lib/locks";
import { baseName, joinPath } from "../lib/paths";
import { PullRequestsContext } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { openInApp, type PullRequest, type Stacked } from "../api";
import { useOpenApps } from "../lib/apps";
import type { MenuContext, OpenDialog } from "../menus";
import type { FileMenuContext } from "./fileMenus";
import { openMenuItems } from "./openMenu";
import type { SubmoduleMenuContext, WorktreeMenuContext } from "./listMenus";
import type { BranchCounts } from "./useBranchCounts";
import type { CompareRequest } from "./useComparison";
import type { Highlight } from "./useHighlight";
import type { RepositorySettings } from "./useRepositorySettings";
import type { RepoError } from "./useRepository";

interface Options {
  snapshot: RepoSnapshot;
  /** False while an action runs, or for a bare repository. */
  canChange: boolean;
  counts: BranchCounts;
  act: (action: Action) => Promise<boolean>;
  openDialog: (dialog: OpenDialog) => void;
  showRequest: (pr: PullRequest) => void;
  /** Show what changed when a branch was rewritten. */
  showRewrite: (rewrite: { branch: string; base: string | null }) => void;
  /** Branches built on other unmerged branches. */
  stacks: Map<string, Stacked>;
  highlight: Highlight;
  settings: RepositorySettings;
  byId: Map<string, CommitRow>;
  worktrees: Worktree[];
  openTab: (path: string) => void;
  compare: (request: CompareRequest | null) => void;
  setError: (error: RepoError | null) => void;
  lfs: LfsLocks;
  checks: FileChecks | null;
  notify: (toast: ToastMessage) => void;
  showChanges: (file: FileChange, source: DiffSource) => void;
  showBlame: (path: string, source: DiffSource) => void;
  updateSubmodules: (paths: string[]) => void;
}

/** What the right-click menus of a repository need: its commits, branches, files, worktrees and submodules. */
export function useRepositoryMenus({
  snapshot,
  canChange,
  counts,
  act,
  openDialog,
  showRequest,
  showRewrite,
  stacks,
  highlight,
  settings,
  byId,
  worktrees,
  openTab,
  compare,
  setError,
  lfs,
  checks,
  notify,
  showChanges,
  showBlame,
  updateSubmodules,
}: Options) {
  const requests = useContext(PullRequestsContext);
  const openApps = useOpenApps();
  const run = (action: Action) => act(action);
  const ctx: MenuContext = {
    snapshot,
    canChange,
    localBranches: counts.localBranches,
    run,
    open: openDialog,
    requests,
    showRequest: showRequest,
    showRewrite,
    stackOf: (branch: string) => stacks.get(branch),
    focus: highlight.highlightHistory,
    focusAuthor: highlight.highlightAuthor,
    visibility: settings.visibility,
    setHidden: settings.setHidden,
    solo: settings.solo,
    pins: settings.pins,
    togglePin: settings.togglePin,
    protectedBranches: settings.protectedBranches,
    toggleProtected: settings.toggleProtected,
    rewritable: (commit: CommitRow) => rewritable(commit, snapshot, counts.headHistory, byId),
    beforeHead: (commit: CommitRow) => commit.id !== snapshot.headCommit && counts.headHistory.has(commit.id),
    openUrl: openInBrowser,
    worktrees: worktrees,
    openWorktree: openTab,
    compare: compare,
    notify: (text) => notify({ text }),
  };
  const fileMenuContext: FileMenuContext = {
    snapshot,
    canChange,
    run,
    openDialog,
    showHistory: (file) => highlight.showHistory(file).catch((e) => setError({ message: String(e) })),
    locks: lfs.locks ? lfs.byPath : null,
    checks: checks,
    reveal: (path) => revealItemInDir(joinPath(snapshot.path, path)).catch(() => notify({ text: `${baseName(path)} isn't in the working tree` })),
    editor: openApps.editor,
    openInEditor: (path) => openApps.editor && openInApp(openApps.editor.id, snapshot.path, path).catch((e) => notify({ text: String(e) })),
    showChanges,
    showBlame,
  };
  const worktreeContext: WorktreeMenuContext = {
    canChange,
    open: openTab,
    reveal: (path) => revealItemInDir(path).catch(() => notify({ text: `${path} isn't there any more` })),
    remove: (worktree) => openDialog({ kind: "removeWorktree", worktree }),
    prune: () => act({ kind: "pruneWorktrees" }),
  };
  const submoduleContext: SubmoduleMenuContext = {
    canChange,
    open: (submodule) => openTab(joinPath(snapshot.path, submodule.path)),
    update: updateSubmodules,
    stage: (path) => act({ kind: "stage", paths: [path] }),
    reveal: (submodule) => revealItemInDir(joinPath(snapshot.path, submodule.path)).catch(() => notify({ text: `${submodule.path} isn't there` })),
  };
  // The toolbar's Open menu.
  const openMenu = () =>
    openMenuItems({
      snapshot,
      editor: openApps.editor,
      terminal: openApps.terminal,
      reveal: () => revealItemInDir(snapshot.path).catch((e) => setError({ message: String(e) })),
      openIn: (app) => openInApp(app.id, snapshot.path).catch((e) => notify({ text: String(e) })),
      notify: (text) => notify({ text }),
    });
  return { ctx, fileMenuContext, worktreeContext, submoduleContext, openMenu };
}
