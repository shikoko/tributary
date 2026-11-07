import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  cancelAction,
  commitDetails,
  fileHistory,
  fullRefName,
  initRepository,
  onProgress,
  openRepository,
  PAGE_SIZE,
  runActionFor,
  signOutOfGitHub,
  WORKTREE_ID,
  type Action,
  type CommitDetails,
  type CommitRow,
  type FileChange,
  type Lock,
  type Progress,
  type RepoSnapshot,
  type Visibility
} from "./api";
import { involvesUntrackedFiles, isLocalChangesError } from "./lib/errors";
import { ancestors, rewritable } from "./lib/graph";
import { undoFor } from "./lib/undo";
import { selectCommit, type SelectHow } from "./lib/selection";
import { useLfsLocks } from "./lib/locks";
import { makeLookup, PullRequestsContext, usePullRequests } from "./lib/pullRequests";
import { useUpdates } from "./lib/updates";
import { baseName, joinPath, relativeTo } from "./lib/paths";
import { loadPlace, savePlace } from "./lib/place";
import { isMac } from "./lib/platform";
import { forgetRepo, loadRecent, noteBranch, pinRepo, rememberRepo } from "./lib/recent";
import { type RefEntry } from "./lib/refs";
import { NO_VISIBILITY, readVisibility, useRepoSetting } from "./lib/repoPrefs";
import { findMatches, stepThrough } from "./lib/search";
import { readSetting } from "./lib/settings";
import { openInBrowser, webRemote } from "./lib/weblinks";
import {
  checkoutFor,
  commitMenu,
  dropMenu,
  pillForEntry,
  pillMenu,
  selectionMenu,
  type MenuContext,
  type OpenDialog
} from "./menus";
import { ActivityPanel } from "./components/ActivityPanel";
import { MessageTools } from "./components/MessageTools";
import { withCoAuthor } from "./lib/commitMessage";
import { menuItems, shortcutLabel} from "./app/appCommand";
import {
  FOCUS_REFRESH_INTERVAL,
  PROGRESS_DELAY,
  RETRYABLE,
  RUNNING_LABELS,
  ZOOM_LEVELS,
  type Busy,
  type Focus,
  type Running
} from "./app/constants";
import { useBackgroundFetch } from "./app/useBackgroundFetch";
import { useBranchCounts } from "./app/useBranchCounts";
import { useAutoLock, useFileChecks } from "./app/useFileChecks";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { appMenus, helpCommandsFor, settingsCommand, startCommands, type MenuBarContext } from "./app/appMenus";
import { fileMenuItems, lockMenuItems, type FileMenuContext } from "./app/fileMenus";
import { RepositoryDialogs } from "./app/Dialogs";
import { needsAttention, useLfsHealth } from "./app/useLfsHealth";
import { useWorktrees } from "./app/useWorktrees";
import { useGitHubStatus } from "./app/useGitHub";
import { columnMenuItems, detailsActionsFor, pushMenuItems, worktreeMenuItems, type WorktreeMenuContext } from "./app/listMenus";
import { paletteCommands } from "./app/paletteCommands";
import { useNativeMenu } from "./app/useNativeMenu";
import { settingsSections } from "./app/settingsSections";
import { usePreferences } from "./app/usePreferences";
import { useActivityLog, useFolderDrop, useWindowFocus } from "./app/useWindowEvents";
import { applyZoom, setWindowTitle } from "./app/window";
import { ProfilePictures } from "./components/Avatar";
import { CloneDialog } from "./components/CloneDialog";
import { CommandPalette} from "./components/CommandPalette";
import { CommitDetailsPanel} from "./components/CommitDetails";
import { CommitList, DEFAULT_COLUMNS } from "./components/CommitList";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import {
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  PlusIcon} from "./components/Icons";
import { MenuBar, type AppMenu } from "./components/MenuBar";
import { MultiSelectPanel } from "./components/MultiSelectPanel";
import { OperationBar } from "./components/OperationBar";
import { ProgressStrip } from "./components/ProgressStrip";
import { SettingsDialog} from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { DEFAULT_PROTECTED} from "./components/Safety";
import { ResizeHandle } from "./components/ResizeHandle";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type Tab } from "./components/TabBar";
import { Toast, type ToastMessage } from "./components/Toast";
import { Toolbar, type RemoteAction } from "./components/Toolbar";
import { ViewBanner } from "./components/ViewBanner";
import { LfsHealthBanner } from "./components/LfsHealthBanner";
import { DiagnosticsDialog } from "./components/DiagnosticsDialog";
import { GitHubSignInDialog } from "./components/GitHubSignInDialog";
import { Welcome } from "./components/Welcome";
import { conflictSides, EMPTY_DRAFT, WorktreeDetailsPanel, type CommitDraft } from "./components/WorktreeDetails";

const unique = (names: string[]) => [...new Set(names)];
const sameAuthor = (commit: CommitRow, name: string, email: string) =>
  email ? commit.authorEmail.toLowerCase() === email.toLowerCase() : commit.authorName === name;

export default function App() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** When several commits are selected: all of them, in the order they were added. */
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ message: string; retry?: Action; worktree?: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; onSideways?: (step: 1 | -1) => void } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [running, setRunning] = useState<Running>(null);
  const [progress, setProgress] = useState<{ label: string; value: Progress | null; visible: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<CommitDraft>(EMPTY_DRAFT);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Where the commit list starts scrolled to, for the repository that was just opened. */
  const [initialScroll, setInitialScroll] = useState(0);

  // Remembered between launches.
  const preferences = usePreferences();
  const { tabs, setTabs, setActiveTab, sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth } = preferences;
  const { detailsWidth, setDetailsWidth, columnWidths, setColumnWidths, columnOptions, setColumnOptions } = preferences;
  const { daySeparators, setDaySeparators, dense, zoom, setZoom, autoFetch } = preferences;
  const { firstParentOnly, setFirstParentOnly, profilePictures } = preferences;
  const { previews, activityOpen, setActivityOpen, fetchMinutes } = preferences;
  const { newCommitNotices, autoUpdate, largeFileMB } = preferences;
  const { autoLock } = preferences;
  const updates = useUpdates(autoUpdate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [gitHubSignInOpen, setGitHubSignInOpen] = useState(false);
  const github = useGitHubStatus(settingsOpen);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  // Remembered for each repository.
  const [visibility, setVisibility] = useRepoSetting<Visibility>("visibility", snapshot?.path ?? null, NO_VISIBILITY);
  const [pins, setPins] = useRepoSetting<string[]>("pins", snapshot?.path ?? null, []);
  // Protected branches can't be deleted, and rewriting them (rebase, hard reset, force push)
  // needs their name typed first.
  const [protectedBranches, setProtectedBranches] = useRepoSetting<string[]>(
    "protectedBranches",
    snapshot?.path ?? null,
    DEFAULT_PROTECTED,
  );
  const toggleProtected = (name: string) =>
    setProtectedBranches(
      protectedBranches.includes(name) ? protectedBranches.filter((other) => other !== name) : [...protectedBranches, name],
    );
  /** The checked-out branch, if it's protected. */
  const protectedHead = snapshot?.headBranch && protectedBranches.includes(snapshot.headBranch) ? snapshot.headBranch : null;
  // "3 branches gone from origin · Clean up", until they're pruned or the hint is
  // dismissed (for those branches: it comes back when another one goes).
  const [pruneHintDismissed, setPruneHintDismissed] = useRepoSetting<string>("pruneHintDismissed", snapshot?.path ?? null, "");
  const goneSignature = snapshot?.goneBranches.join("\n") ?? "";
  const pruneHint =
    snapshot && snapshot.goneBranches.length > 0 && goneSignature !== pruneHintDismissed
      ? { count: snapshot.goneBranches.length, remote: snapshot.remotes.length === 1 ? snapshot.remotes[0] : "the remote" }
      : null;

  const lfs = useLfsLocks(snapshot?.path ?? null);
  // Git LFS files that weren't downloaded, or Git LFS missing: say so until it's fixed,
  // or dismissed (it comes back if the problem changes).
  const lfsStatus = useLfsHealth(snapshot);
  const worktreeList = useWorktrees(snapshot);
  const lfsSignature = lfsStatus.health
    ? `${lfsStatus.health.notInstalled}/${lfsStatus.health.notSetUp}/${lfsStatus.health.pointers}`
    : "";
  const [lfsNoticeDismissed, setLfsNoticeDismissed] = useRepoSetting<string>("lfsNoticeDismissed", snapshot?.path ?? null, "");
  const onGitHub = Boolean(snapshot?.webRemotes.some((remote) => remote.host === "github"));
  const prs = usePullRequests(snapshot?.path ?? null, onGitHub);
  const prLookup = useMemo(() => makeLookup(prs.list, openInBrowser), [prs.list]);
  const searchInput = useRef<HTMLInputElement>(null);
  const detailsCache = useRef(new Map<string, CommitDetails>());
  /** Commit messages being written, by repository. */
  const drafts = useRef(new Map<string, CommitDraft>());
  /** Increases with every load, so answers to older loads can be ignored. */
  const loadCount = useRef(0);
  const lastLoad = useRef(0);
  /** True while something is loading or the folder picker is open; focus refreshes wait. */
  const blockFocusRefresh = useRef(false);
  /** Sizes when a panel resize started. */
  const resizeStart = useRef({ sidebar: 0, details: 0 });
  const scrollTop = useRef(0);
  const firstParentRef = useRef(firstParentOnly);
  firstParentRef.current = firstParentOnly;
  /** Where a shift-click selection starts. */
  const selectionAnchor = useRef<string | null>(null);

  const load = useCallback(
    async (path: string, mode: "open" | "refresh" | "more", limit = PAGE_SIZE) => {
      const request = ++loadCount.current;
      blockFocusRefresh.current = true;
      setBusy(mode === "open" ? { kind: "open", path } : { kind: mode });
      setError(null);
      const firstParent = firstParentRef.current;
      const current = () => request === loadCount.current;
      const fallback = (next: RepoSnapshot) => {
        const loaded = (id: string | null) => (id && next.commits.some((c) => c.id === id) ? id : null);
        return loaded(next.headCommit) ?? next.commits[0]?.id ?? null;
      };
      const show = (next: RepoSnapshot) => {
        setSnapshot(next);
        setSelectedId((selected) =>
          mode !== "open" && selected && next.commits.some((c) => c.id === selected) ? selected : fallback(next),
        );
        setSelection((selected) => {
          const still = selected?.filter((id) => next.commits.some((c) => c.id === id)) ?? [];
          return mode !== "open" && still.length > 1 ? still : null;
        });
        setRecent(noteBranch(next.path, next.headBranch));
      };

      try {
        if (mode === "open") {
          // When opening, show the graph first: reading uncommitted changes can take a
          // while in big working trees, so they follow in a second load.
          const next = await openRepository(path, limit, false, firstParent, readVisibility(path));
          if (!current()) return;
          detailsCache.current = new Map();
          setQuery("");
          setFocus(null);
          setDraft(drafts.current.get(next.path) ?? EMPTY_DRAFT);
          // Back to where you were in this repository.
          const place = loadPlace(next.path);
          scrollTop.current = place?.scrollTop ?? 0;
          setInitialScroll(scrollTop.current);
          show(next);
          if (place?.selectedId && next.commits.some((c) => c.id === place.selectedId)) {
            setSelectedId(place.selectedId);
          }
          setRecent(rememberRepo(next.path, next.name, next.headBranch));
          setTabs((current) => {
            const tab = { path: next.path, name: next.name };
            const index = current.findIndex((t) => t.path === next.path || t.path === path);
            if (index < 0) return [...current, tab];
            return current.map((t, i) => (i === index ? tab : t));
          });
          setActiveTab(next.path);
          setWindowTitle(`${next.name} — Tributary`);
          setBusy(null);
          const full = await openRepository(path, limit, true, firstParent, readVisibility(next.path)).catch(() => null);
          if (current() && full?.worktree) setSnapshot(full);
        } else {
          // The graph is already on screen, so load everything at once to avoid flicker.
          const next = await openRepository(path, limit, true, firstParent, readVisibility(path));
          if (!current()) return;
          show(next);
        }
      } catch (e) {
        if (current()) setError({ message: String(e) });
      } finally {
        if (current()) {
          setBusy(null);
          blockFocusRefresh.current = false;
          lastLoad.current = Date.now();
        }
      }
    },
    [setTabs, setActiveTab],
  );

  const reloadLimit = snapshot ? Math.max(PAGE_SIZE, snapshot.commits.length) : PAGE_SIZE;

  const pick = useCallback(async () => {
    blockFocusRefresh.current = true;
    try {
      const path = await open({ directory: true, multiple: false, title: "Open a git repository" });
      if (typeof path === "string") {
        await load(path, "open");
        return;
      }
    } catch (e) {
      setError({ message: String(e) });
    }
    blockFocusRefresh.current = false;
  }, [load]);

  /** Create a repository in a folder you choose, and open it. */
  const createRepository = useCallback(async () => {
    blockFocusRefresh.current = true;
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose a folder for the new repository" });
      if (typeof path === "string") {
        const message = await initRepository(path);
        await load(path, "open");
        setToast({ text: message });
        return;
      }
    } catch (e) {
      setError({ message: String(e) });
    }
    blockFocusRefresh.current = false;
  }, [load]);

  const refresh = useCallback(() => {
    if (snapshot) load(snapshot.path, "refresh", reloadLimit);
  }, [snapshot, load, reloadLimit]);

  /** Remember where you are in the current repository. */
  const rememberPlace = useCallback(() => {
    if (snapshot) savePlace(snapshot.path, { selectedId, scrollTop: scrollTop.current });
  }, [snapshot, selectedId]);

  const showWelcome = useCallback(() => {
    loadCount.current++;
    setSnapshot(null);
    setSelectedId(null);
    setSelection(null);
    setError(null);
    setBusy(null);
    setQuery("");
    setFocus(null);
    blockFocusRefresh.current = false;
    setActiveTab(null);
    setWindowTitle("Tributary");
  }, [setActiveTab]);

  const switchTab = useCallback(
    (path: string) => {
      if (snapshot?.path === path) return;
      rememberPlace();
      load(path, "open");
    },
    [snapshot, rememberPlace, load],
  );

  const closeTab = useCallback(
    (path: string) => {
      const index = tabs.findIndex((tab) => tab.path === path);
      const remaining = tabs.filter((tab) => tab.path !== path);
      setTabs(remaining);
      if (snapshot?.path !== path) return;
      rememberPlace();
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) load(next.path, "open");
      else showWelcome();
    },
    [tabs, setTabs, snapshot, rememberPlace, load, showWelcome],
  );

  /**
   * The "New tab" start screen: the welcome screen (open, clone, new, recent repositories)
   * in a tab of its own. Opening anything from it, or going to another tab, replaces it.
   * `returnTo` is the tab it was opened from, to go back to if it's closed.
   */
  const [startTab, setStartTab] = useState<{ returnTo: string } | null>(null);
  const newTab = useCallback(() => {
    // Without a repository open, the start screen is already showing.
    if (!snapshot) return;
    rememberPlace();
    setStartTab({ returnTo: snapshot.path });
    showWelcome();
  }, [snapshot, rememberPlace, showWelcome]);
  const closeStartTab = useCallback(() => {
    const back = startTab && tabs.find((tab) => tab.path === startTab.returnTo);
    setStartTab(null);
    const next = back ?? tabs[tabs.length - 1];
    if (next) load(next.path, "open");
  }, [startTab, tabs, load]);
  useEffect(() => {
    if (snapshot) setStartTab(null);
  }, [snapshot]);

  // Save your place a moment after you stop moving around.
  useEffect(() => {
    const timer = setTimeout(rememberPlace, 400);
    return () => clearTimeout(timer);
  }, [rememberPlace]);

  // Keep the commit message you're writing when switching tabs.
  useEffect(() => {
    if (snapshot) drafts.current.set(snapshot.path, draft);
  }, [draft, snapshot]);

  /** Run a git action, reload, then show what happened. Resolves to true when it worked. */
  const act = useCallback(
    async (action: Action, kind: Running = "other", options: { quiet?: boolean; confirmed?: boolean } = {}): Promise<boolean> => {
      if (!snapshot) return false;
      // Rewriting the protected, checked-out branch: type its name first.
      if (!options.confirmed && protectedHead && (action.kind === "rebase" || action.kind === "interactiveRebase")) {
        setDialog({ kind: "protectedAction", action, branch: protectedHead });
        return false;
      }
      const before = snapshot;
      setRunning(kind);
      setError(null);
      blockFocusRefresh.current = true;

      // Fetches, pulls and pushes show a progress bar, unless they finish quickly.
      let stopListening: (() => void) | undefined;
      let showTimer: number | undefined;
      if (kind && kind !== "other") {
        setProgress({ label: RUNNING_LABELS[kind], value: null, visible: false });
        showTimer = window.setTimeout(
          () => setProgress((current) => current && { ...current, visible: true }),
          PROGRESS_DELAY,
        );
        stopListening = await onProgress((value) => setProgress((current) => current && { ...current, value })).catch(
          () => undefined,
        );
      }

      let message: string | null = null;
      let pullRequest: string | undefined;
      let backup: string | undefined;
      let failure: string | null = null;
      try {
        ({ message, pullRequest, backup } = await runActionFor(before.path, action));
      } catch (e) {
        failure = String(e);
      }
      window.clearTimeout(showTimer);
      stopListening?.();
      setProgress(null);
      setRunning(null);
      // Reload even after a failure (a pull with conflicts still changes things), and
      // only then show the result, since reloading clears old errors.
      await load(before.path, "refresh", Math.max(PAGE_SIZE, before.commits.length));
      // Locks change when you lock or unlock, and may have changed on the server.
      if (action.kind === "lockFiles" || action.kind === "unlockFiles") lfs.refresh(true);
      else if (kind && kind !== "other") lfs.refresh();
      // A push can open the way for a pull request, and a fetch can bring new ones.
      if (kind && kind !== "other") prs.refresh(true);
      if (failure === "Cancelled.") {
        setToast({ text: "Cancelled" });
        return false;
      }
      if (failure) {
        const retry: Action | undefined =
          RETRYABLE.has(action.kind) && isLocalChangesError(failure)
            ? { kind: "stashAndRetry", action, includeUntracked: involvesUntrackedFiles(failure) }
            : undefined;
        // The branch is checked out in another working tree: offer to open that.
        const worktree = /already (?:used by worktree|checked out) at '([^']+)'/.exec(failure)?.[1];
        setError({ message: failure, retry, worktree });
        return false;
      }
      // A squash merge waits to be committed: show it.
      if (action.kind === "merge" && action.mode === "squash") setSelectedId(WORKTREE_ID);
      if (pullRequest) {
        const url = pullRequest;
        setToast({ text: message ?? "Pushed", action: { label: "Create pull request", onClick: () => openInBrowser(url) } });
      } else if (!options.quiet && message) {
        const undo: Action | null = backup && action.kind === "discardFiles" ? { kind: "restoreDiscarded", reference: backup } : undoFor(action, before);
        setToast({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo, "other", { confirmed: true }) } : undefined });
      }
      return true;
    },
    [snapshot, load, protectedHead, lfs.refresh, prs.refresh],
  );

  /** A dialog finished its action: reload and show what happened, with an optional undo. */
  const finishDialog = useCallback(
    (message: string, undo?: Action) => {
      setDialog(null);
      setToast({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo, "other", { confirmed: true }) } : undefined });
      refresh();
    },
    [refresh, act],
  );
  const hideToast = useCallback(() => setToast(null), []);

  const commits = snapshot?.commits;
  const indexById = useMemo(() => new Map((commits ?? []).map((commit, index) => [commit.id, index])), [commits]);
  const byId = useMemo(() => new Map((commits ?? []).map((commit) => [commit.id, commit])), [commits]);
  const selectedIndex = selectedId ? indexById.get(selectedId) : undefined;
  const selected = selectedIndex !== undefined ? snapshot?.commits[selectedIndex] : undefined;
  const selectedIds = useMemo(() => (selection ? new Set(selection) : null), [selection]);
  /** The selected commits in list order, newest first. */
  const selectedCommits = useMemo(
    () => (selection && commits ? commits.filter((commit) => selection.includes(commit.id)) : []),
    [selection, commits],
  );

  /** Select a commit: alone, a range from the last one (shift), or adding / removing it (⌘ or Ctrl). */
  const select = useCallback(
    (id: string | null, how: SelectHow = {}) => {
      const current = { selectedId, ids: selection, anchor: selectionAnchor.current };
      const next = selectCommit(current, id, how, commits ?? [], indexById);
      selectionAnchor.current = next.anchor;
      setSelectedId(next.selectedId);
      setSelection(next.ids);
    },
    [commits, indexById, selectedId, selection],
  );

  // Search: matching commits are highlighted, and Enter / Shift+Enter move between them.
  const matches = useMemo(() => (snapshot ? findMatches(snapshot.commits, query) : []), [snapshot, query]);
  const matchIds = useMemo(
    () => (query.trim() && snapshot ? new Set(matches.map((index) => snapshot.commits[index].id)) : null),
    [matches, query, snapshot],
  );
  // Highlighting: a branch's history or an author's commits stay bright, everything else fades.
  const focusIds = useMemo(() => {
    if (!focus || !commits) return null;
    if (focus.kind === "history") return ancestors(focus.commitId, byId);
    if (focus.kind === "path") return new Set(focus.ids);
    return new Set(commits.filter((c) => c.kind === "commit" && sameAuthor(c, focus.name, focus.email)).map((c) => c.id));
  }, [focus, byId, commits]);
  useEffect(() => {
    // The highlighted commit went away (for example after a reset): stop highlighting.
    if (focus?.kind === "history" && snapshot && !byId.has(focus.commitId)) setFocus(null);
  }, [focus, snapshot, byId]);
  const user = snapshot?.user ?? null;
  const highlightingMine = Boolean(
    focus?.kind === "author" && user && (user.email ? focus.email.toLowerCase() === user.email.toLowerCase() : focus.name === user.name),
  );
  const highlightMine = () =>
    highlightingMine || !user ? setFocus(null) : setFocus({ kind: "author", name: user.name ?? "", email: user.email ?? "" });

  const search = (text: string) => {
    setQuery(text);
    // Jump to the first match as you type.
    const first = snapshot ? findMatches(snapshot.commits, text)[0] : undefined;
    if (snapshot && first !== undefined) select(snapshot.commits[first].id);
  };
  const stepSearch = (step: 1 | -1) => {
    const next = stepThrough(matches, selectedIndex ?? -1, step);
    if (snapshot && next !== undefined) select(snapshot.commits[next].id);
  };

  // File history: the commits that changed a file or folder stay bright, and the banner steps through them.
  const showHistory = async (file: string) => {
    if (!snapshot) return;
    try {
      const history = await fileHistory(snapshot.path, file);
      setFocus({ kind: "path", ...history });
      const newest = history.ids.find((id) => indexById.has(id));
      if (newest) select(newest);
      else
        setToast({
          text: history.ids.length
            ? `None of the commits that changed ${baseName(history.path)} are loaded`
            : `No commits changed ${baseName(history.path)}`,
        });
    } catch (e) {
      setError({ message: String(e) });
    }
  };
  const pickHistory = async (directory: boolean) => {
    if (!snapshot) return;
    blockFocusRefresh.current = true;
    try {
      const picked = await open({
        directory,
        multiple: false,
        defaultPath: snapshot.path,
        title: directory ? "Show the history of a folder" : "Show the history of a file",
      });
      if (typeof picked === "string") await showHistory(directory ? `${picked}/` : picked);
    } catch (e) {
      setError({ message: String(e) });
    } finally {
      blockFocusRefresh.current = false;
    }
  };
  /** Lock files you choose with Git LFS. */
  const pickFilesToLock = async () => {
    if (!snapshot) return;
    blockFocusRefresh.current = true;
    try {
      const picked = await open({ multiple: true, directory: false, defaultPath: snapshot.path, title: "Lock files" });
      const files = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      const paths = files.map((file) => relativeTo(snapshot.path, file));
      const inside = paths.filter((path): path is string => path !== null);
      if (inside.length < paths.length) setError({ message: "Only files inside this repository can be locked." });
      if (inside.length > 0) await act({ kind: "lockFiles", paths: inside });
    } catch (e) {
      setError({ message: String(e) });
    } finally {
      blockFocusRefresh.current = false;
    }
  };
  /** The loaded commits that changed the file or folder whose history is shown, in list order. */
  const pathMatches = useMemo(() => {
    if (focus?.kind !== "path") return [];
    return focus.ids
      .map((id) => indexById.get(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
  }, [focus, indexById]);
  const stepHistory = (step: 1 | -1) => {
    const next = stepThrough(pathMatches, selectedIndex ?? -1, step);
    if (snapshot && next !== undefined) select(snapshot.commits[next].id);
  };
  /** Files in a commit that belong to the history being shown. */
  const isHistoryFile = (path: string) => {
    if (focus?.kind !== "path") return false;
    return focus.folder ? path === focus.path || path.startsWith(`${focus.path}/`) : focus.names.includes(path);
  };

  const loadDetails = useCallback(
    async (id: string) => {
      const cached = detailsCache.current.get(id);
      if (cached) return cached;
      if (!snapshot) throw new Error("No repository");
      const details = await commitDetails(snapshot.path, id);
      detailsCache.current.set(id, details);
      return details;
    },
    [snapshot],
  );

  /** An abbreviated commit id in a message → a loaded commit, if there is exactly one. */
  const resolveCommit = useCallback(
    (prefix: string) => {
      const found = (commits ?? []).filter((commit) => commit.kind === "commit" && commit.id.startsWith(prefix));
      return found.length === 1 ? found[0].id : null;
    },
    [commits],
  );

  const zoomBy = useCallback(
    (step: 1 | -1 | 0) =>
      setZoom((current) => {
        if (step === 0) return 1;
        const index = ZOOM_LEVELS.findIndex((level) => level >= current - 0.001);
        return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (index < 0 ? 4 : index) + step))];
      }),
    [setZoom],
  );
  useEffect(() => applyZoom(zoom), [zoom]);

  // Hidden and soloed branches: remembered for the repository, then reloaded.
  const changeVisibility = useCallback(
    (change: (current: Visibility) => Visibility) => {
      setVisibility(change);
      refresh();
    },
    [setVisibility, refresh],
  );
  const setHidden = (names: string[], hidden: boolean) =>
    changeVisibility((current) =>
      current.solo.length > 0
        ? // While soloing, hiding means no longer showing only it, and showing means adding it.
          { ...current, solo: hidden ? current.solo.filter((n) => !names.includes(n)) : unique([...current.solo, ...names]) }
        : { ...current, hidden: hidden ? unique([...current.hidden, ...names]) : current.hidden.filter((n) => !names.includes(n)) },
    );
  const solo = (names: string[]) => changeVisibility((current) => ({ ...current, solo: unique([...current.solo, ...names]) }));
  const showAllBranches = () => changeVisibility(() => NO_VISIBILITY);
  const togglePin = (name: string) =>
    setPins((current) => (current.includes(name) ? current.filter((pin) => pin !== name) : [...current, name]));
  const soloing = visibility.solo.length > 0;
  const hiddenCount = soloing ? visibility.solo.length : visibility.hidden.length;

  // The latest state, for timers and window events that outlive a render.
  const latest = useRef({ snapshot, dialog, running, refresh });
  latest.current = { snapshot, dialog, running, refresh };

  useKeyboardShortcuts({
    togglePalette: () => setPaletteOpen((open) => !open),
    openSettings: () => setSettingsOpen(true),
    open: pick,
    newTab,
    closeTab: () => {
      if (snapshot) closeTab(snapshot.path);
      else if (startTab) closeStartTab();
    },
    showTab: (index) => {
      const tab = tabs[index];
      if (tab) switchTab(tab.path);
    },
    cycleTab: (backwards) => {
      if (tabs.length < 2 || !snapshot) return;
      const index = tabs.findIndex((tab) => tab.path === snapshot.path);
      switchTab(tabs[(index + (backwards ? tabs.length - 1 : 1)) % tabs.length].path);
    },
    refresh,
    focusSearch: () => {
      searchInput.current?.focus();
      searchInput.current?.select();
    },
    toggleSidebar: () => setSidebarOpen((open) => !open),
    toggleActivity: () => setActivityOpen((open) => !open),
    zoom: zoomBy,
    showShortcuts: () => setShortcutsOpen(true),
    // Windows and Linux: F10 opens the menu bar, as in other apps there.
    openMenuBar: () => !isMac && openBarMenu(0),
    escape: () => {
      // Stop highlighting first, then drop a multiple selection, then close the details.
      if (focus) setFocus(null);
      else if (selection) setSelection(null);
      else setSelectedId(null);
    },
  });

  // Reopen your tabs (or the last repository) on launch.
  useEffect(() => {
    if (!readSetting("reopenLast", true)) return;
    const active = readSetting<string | null>("tabs.active", null);
    const open = readSetting<Tab[]>("tabs.list", []);
    const path = active ?? open[0]?.path ?? loadRecent()[0]?.path;
    if (path) load(path, "open");
  }, [load]);

  const activity = useActivityLog();
  // A folder dropped onto the window opens it.
  const droppingFolder = useFolderDrop((path) => !latest.current.dialog && load(path, "open"));
  // Pick up changes made elsewhere (a commit in the terminal, an edit in the editor)
  // when coming back to the window.
  useWindowFocus(() => {
    const { snapshot, dialog, running, refresh } = latest.current;
    if (!snapshot || dialog || running || blockFocusRefresh.current) return;
    if (Date.now() - lastLoad.current < FOCUS_REFRESH_INTERVAL) return;
    refresh();
    lfs.refresh();
    prs.refresh();
  });

  const repoPath = snapshot?.path ?? null;
  const canFetch = Boolean(snapshot && !snapshot.bare && snapshot.remotes.length > 0);
  const tabNews = useBackgroundFetch({
    snapshot,
    tabs,
    enabled: autoFetch,
    minutes: fetchMinutes,
    notices: newCommitNotices,
    isBusy: () => Boolean(latest.current.dialog || latest.current.running),
    afterFetch: () => {
      if (!latest.current.dialog && !latest.current.running) latest.current.refresh();
      lfs.refresh();
      prs.refresh();
    },
    notify: setToast,
    pull: () => act({ kind: "pull" }, "pull"),
    show: (id) => select(id),
    switchTab,
  });

  const checks = useFileChecks(snapshot, largeFileMB);
  useAutoLock({
    enabled: autoLock,
    repoPath,
    checks,
    locks: lfs.locks ? lfs.byPath : null,
    busy: running !== null,
    lock: (paths) => act({ kind: "lockFiles", paths }),
  });

  // The "only this branch" setting changed: reload.
  const firstParentLoaded = snapshot?.firstParent;
  useEffect(() => {
    if (firstParentLoaded !== undefined && firstParentLoaded !== firstParentOnly) latest.current.refresh();
  }, [firstParentOnly, firstParentLoaded]);

  const { headHistory, ahead, behind, aheadBehind, localBranches } = useBranchCounts(snapshot, byId);

  const activityHere = activity.entries;
  const lastHere = [...activityHere].reverse().find((entry) => entry.folder === snapshot?.path && !entry.background);
  const activityFailed = Boolean(lastHere && !lastHere.success);

  const showMenu = (x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items });
  const menuUnder = (anchor: HTMLElement, items: MenuItem[], width = 240) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({ x: Math.max(4, Math.min(rect.left, rect.right - width)), y: rect.bottom + 4, items });
  };

  function resetLayout() {
    setColumnWidths({ refs: null, graph: null });
    setColumnOptions(DEFAULT_COLUMNS);
    setSidebarWidth(220);
    setDetailsWidth(380);
  }
  function reveal() {
    if (snapshot) revealItemInDir(snapshot.path).catch((e) => setError({ message: String(e) }));
  }

  const menuBarContext: MenuBarContext = {
    snapshot,
    running: running !== null,
    head: snapshot?.headCommit ? byId.get(snapshot.headCommit) : undefined,
    preferences,
    hiddenCount,
    highlightingMine,
    usesLocks: Boolean(lfs.locks),
    usesLfs: Boolean(checks?.usesLfs),
    lfsPointers: lfsStatus.health?.pointers ?? 0,
    do: {
      open: pick,
      clone: () => setDialog({ kind: "clone" }),
      create: createRepository,
      settings: () => setSettingsOpen(true),
      palette: () => setPaletteOpen(true),
      shortcuts: () => setShortcutsOpen(true),
      zoom: zoomBy,
      newTab,
      closeTab,
      search: () => searchInput.current?.focus(),
      showAllBranches,
      highlightMine,
      resetLayout,
      refresh,
      act: (action, kind) => act(action, kind ?? "other"),
      dialog: setDialog,
      select: (id) => select(id),
      history: pickHistory,
      lockFiles: pickFilesToLock,
      reveal,
      diagnostics: () => setDiagnosticsOpen(true),
    },
  };
  const menus = appMenus(menuBarContext);
  useNativeMenu(menus, { settings: () => setSettingsOpen(true) });

  const barMenus = menus.map((m): AppMenu => ({ label: m.label, items: menuItems(m.entries) }));
  /** Open the menu bar's `index`th menu; ← and → go to the ones beside it. */
  const openBarMenu = (index: number) => {
    const anchors = document.querySelectorAll<HTMLElement>(".menu-bar-item");
    const anchor = anchors[index];
    if (!anchor || !barMenus[index]) return;
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: barMenus[index].items,
      onSideways: (step) => openBarMenu((index + step + barMenus.length) % barMenus.length),
    });
  };
  const menuBar = isMac ? undefined : <MenuBar menus={barMenus} onOpen={(m) => openBarMenu(barMenus.indexOf(m))} />;

  const settingsDialog = settingsOpen && (
    <SettingsDialog
      sections={settingsSections({
        preferences,
        version,
        updates,
        onInstallUpdate: () => setUpdateOpen(true),
        github: {
          status: github.status,
          error: github.error,
          onSignIn: () => setGitHubSignInOpen(true),
          onSignOut: () =>
            signOutOfGitHub()
              .then(() => setToast({ text: "Signed out of GitHub" }))
              .catch((e) => setToast({ text: `Couldn't sign out: ${e}` }))
              .finally(github.recheck),
        },
        repository: snapshot && {
          name: snapshot.name,
          path: snapshot.path,
          protectedBranches,
          setProtectedBranches,
          onCleanUpLfs: () => {
            setSettingsOpen(false);
            setDialog({ kind: "pruneLfs" });
          },
        },
      })}
      onClose={() => setSettingsOpen(false)}
    />
  );
  const gitHubSignInDialog = gitHubSignInOpen && (
    <GitHubSignInDialog
      status={github.status}
      onCancel={() => setGitHubSignInOpen(false)}
      onDone={(account) => {
        setGitHubSignInOpen(false);
        setToast({ text: `Signed in to GitHub as ${account.login}` });
        github.recheck();
        prs.refresh(true);
      }}
    />
  );
  const diagnosticsDialog = diagnosticsOpen && (
    <DiagnosticsDialog
      repoPath={snapshot?.path ?? null}
      extra={{ Zoom: `${Math.round(zoom * 100)}%`, Webview: navigator.userAgent }}
      onCopied={() => {
        setDiagnosticsOpen(false);
        setToast({ text: "Copied the diagnostics" });
      }}
      onClose={() => setDiagnosticsOpen(false)}
    />
  );
  const updateDialog = updateOpen && updates.available && <UpdateDialog update={updates.available} onClose={() => setUpdateOpen(false)} />;
  const updatePill = updates.available && (
    <button className="update-pill" onClick={() => setUpdateOpen(true)} title={`Tributary ${updates.available.version} is available`}>
      <DownloadIcon size={13} />
      Update
    </button>
  );

  const withProfilePictures = (children: React.ReactNode) => (
    <ProfilePictures.Provider value={profilePictures}>
      <PullRequestsContext.Provider value={prs.list.length > 0 ? prLookup : null}>{children}</PullRequestsContext.Provider>
    </ProfilePictures.Provider>
  );
  const dropOverlay = droppingFolder && (
    <div className="drop-overlay">
      <FolderIcon size={28} />
      <span>Drop a folder to open it</span>
    </div>
  );
  const cloneDialog = dialog?.kind === "clone" && (
    <CloneDialog
      onCancel={() => setDialog(null)}
      onDone={(path) => {
        setDialog(null);
        rememberPlace();
        load(path, "open");
      }}
    />
  );

  if (!snapshot) {
    return withProfilePictures(
      <div className="app">
        {(tabs.length > 0 || !isMac) && (
          <TabBar
            tabs={tabs}
            activePath={null}
            startTab={startTab !== null}
            onSelect={(path) => load(path, "open")}
            onClose={closeTab}
            onCloseStart={closeStartTab}
            onNew={newTab}
            menuBar={menuBar}
            extra={updatePill}
            news={tabNews}
          />
        )}
        {tabs.length === 0 && isMac && <div className="window-drag-strip" data-tauri-drag-region />}
        <Welcome
          recent={recent}
          opening={busy?.kind === "open" ? busy.path : null}
          error={error?.message ?? null}
          onPick={pick}
          onClone={() => setDialog({ kind: "clone" })}
          onCreate={createRepository}
          onOpen={(path) => load(path, "open")}
          onForget={(path) => setRecent(forgetRepo(path))}
          onPin={(path, pinned) => setRecent(pinRepo(path, pinned))}
        />
        {cloneDialog}
        {paletteOpen && (
          <CommandPalette
            commands={[...startCommands(menuBarContext), settingsCommand(menuBarContext), ...helpCommandsFor(menuBarContext)].map((c) => ({ id: c.id, label: c.label, icon: c.icon, shortcut: c.keys && shortcutLabel(c.keys), run: c.run }))}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
        {settingsDialog}
        {diagnosticsDialog}
        {gitHubSignInDialog}
        {updateDialog}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onSideways={menu.onSideways} onClose={() => setMenu(null)} />}
        {dropOverlay}
        {toast && <Toast toast={toast} onDone={hideToast} />}
      </div>,
    );
  }

  const branchLabel = snapshot.headBranch ?? "HEAD";
  const canChange = !snapshot.bare && running === null;

  const rewritableAfter = (commit: CommitRow) => rewritable(commit, snapshot, headHistory, byId);

  const ctx: MenuContext = {
    snapshot,
    canChange,
    localBranches,
    run: (action) => act(action),
    open: setDialog,
    focus: (name, commitId) => setFocus({ kind: "history", name, commitId }),
    focusAuthor: (name, email) => setFocus({ kind: "author", name, email }),
    visibility,
    setHidden,
    solo,
    pins,
    togglePin,
    protectedBranches,
    toggleProtected,
    rewritable: rewritableAfter,
    openUrl: openInBrowser,
    worktrees: worktreeList,
    openWorktree: switchTab,
  };
  const commitById = (id: string) => byId.get(id);
  const conflictedPaths = (snapshot.worktree?.unstaged ?? []).filter((file) => file.status === "conflicted").map((file) => file.path);
  const conflicts = conflictedPaths.length;

  const fileMenuContext: FileMenuContext = {
    snapshot,
    canChange,
    run: (action) => act(action),
    openDialog: setDialog,
    showHistory,
    locks: lfs.locks ? lfs.byPath : null,
    checks,
    reveal: (path) =>
      revealItemInDir(joinPath(snapshot.path, path)).catch(() => setToast({ text: `${baseName(path)} isn't in the working tree` })),
  };
  const worktreeContext: WorktreeMenuContext = {
    canChange,
    open: switchTab,
    reveal: (path) => revealItemInDir(path).catch(() => setToast({ text: `${path} isn't there any more` })),
    remove: (worktree) => setDialog({ kind: "removeWorktree", worktree }),
    prune: () => act({ kind: "pruneWorktrees" }),
  };
  const fileMenu = (file: FileChange, x: number, y: number, where: "worktree" | "commit") =>
    showMenu(x, y, fileMenuItems(fileMenuContext, file, where));
  const lockMenu = (lock: Lock, x: number, y: number) => showMenu(x, y, lockMenuItems(fileMenuContext, lock));
  const messageTools = (
    <MessageTools
      commits={snapshot.commits}
      you={user}
      onUseMessage={async (commit) => {
        const details = await loadDetails(commit.id).catch(() => null);
        setDraft((current) => ({ ...current, summary: details?.summary ?? commit.summary, description: details?.body ?? "" }));
      }}
      onAddCoAuthor={(person) => setDraft((current) => ({ ...current, description: withCoAuthor(current.description, person) }))}
      openMenu={menuUnder}
    />
  );

  const pushMenu = (anchor: HTMLElement) =>
    menuUnder(anchor, pushMenuItems(() => act({ kind: "push", force: false }, "push"), setDialog));
  const viewMenu = (anchor: HTMLElement) => {
    const view = menus.find((m) => m.label === "View");
    if (view) menuUnder(anchor, menuItems(view.entries.filter((entry) => entry === "-" || !["search", "palette"].includes(entry.id))), 320);
  };
  const headerMenu = (x: number, y: number) =>
    showMenu(x, y, columnMenuItems(columnOptions, setColumnOptions, daySeparators, setDaySeparators));
  const remoteActions: Record<RemoteAction, Action> = {
    fetch: { kind: "fetch" },
    pull: { kind: "pull" },
    push: { kind: "push", force: false },
  };
  const detailsActions = (commit: CommitRow) => detailsActionsFor(commit, snapshot, canChange, (action) => act(action), setDialog);
  const commands = () =>
    paletteCommands({
      menus,
      snapshot,
      tabs,
      canChange,
      localBranches,
      branchLabel,
      focused: focus !== null,
      preferences,
      run: (action, options) => act(action, "other", options),
      switchTab,
      setFocus,
      setHidden,
      openSettings: () => setSettingsOpen(true),
      highlightMine,
    });

  const head = snapshot.headCommit ? commitById(snapshot.headCommit) : undefined;
  const panelResize = (panel: "sidebar" | "details") => ({
    onResizeStart: () => (resizeStart.current = { sidebar: sidebarWidth, details: detailsWidth }),
    onResize: (delta: number) =>
      panel === "sidebar"
        ? setSidebarWidth(Math.round(Math.min(480, Math.max(160, resizeStart.current.sidebar + delta))))
        : setDetailsWidth(Math.round(Math.min(720, Math.max(300, resizeStart.current.details - delta)))),
    onReset: () => (panel === "sidebar" ? setSidebarWidth(220) : setDetailsWidth(380)),
  });

  const sidebarMenu = (entry: RefEntry, x: number, y: number) => {
    const name = fullRefName(entry);
    const commit = commitById(entry.commitId);
    if (entry.hidden || !commit) {
      // A hidden branch: its commit may not even be loaded.
      if (!name) return;
      showMenu(x, y, [
        { label: `Show ${entry.name}`, icon: <EyeIcon />, onSelect: () => setHidden([name], false) },
        { label: pins.includes(name) ? `Unpin ${entry.name}` : `Pin ${entry.name} in the sidebar`, icon: <PlusIcon />, onSelect: () => togglePin(name) },
      ]);
      return;
    }
    showMenu(x, y, pillMenu(ctx, pillForEntry(entry), commit));
  };

  const focusedCount = focusIds?.size ?? 0;
  const multi = selectedCommits.length > 1;

  return withProfilePictures(
    <div className="app">
      <TabBar
        tabs={tabs}
        activePath={snapshot.path}
        startTab={false}
        onSelect={switchTab}
        onClose={closeTab}
        onCloseStart={closeStartTab}
        onNew={newTab}
        menuBar={menuBar}
        extra={updatePill}
        news={tabNews}
      />
      <Toolbar
        snapshot={snapshot}
        refreshing={busy !== null}
        running={running === "other" || running === "download" ? null : running}
        ahead={ahead}
        behind={behind}
        search={{
          query,
          total: matches.length,
          current: selectedIndex !== undefined ? matches.indexOf(selectedIndex) + 1 : 0,
        }}
        searchInput={searchInput}
        onSearch={search}
        onSearchStep={stepSearch}
        onRemote={(action) => act(remoteActions[action], action)}
        onPushMenu={pushMenu}
        lastFetch={snapshot.lastFetched ? snapshot.lastFetched * 1000 : null}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onViewMenu={viewMenu}
        onRefresh={refresh}
        onPick={pick}
        onClose={() => closeTab(snapshot.path)}
      />
      {progress?.visible && (
        <ProgressStrip label={progress.label} progress={progress.value} onCancel={() => cancelAction().catch(() => {})} />
      )}
      {snapshot.operation && (
        <OperationBar
          operation={snapshot.operation}
          branch={snapshot.operation.branch ?? branchLabel}
          conflicts={conflicts}
          sides={conflictSides(snapshot)}
          onKeepAll={(keep) => act({ kind: "resolveConflicts", paths: conflictedPaths, keep })}
          busy={running !== null}
          onContinue={() => act({ kind: "continueOperation" })}
          onSkip={() => act({ kind: "skipCommit" })}
          onAbort={() => act({ kind: "abortOperation" })}
          onShowFiles={() => select(WORKTREE_ID)}
        />
      )}
      {error && (
        <div className="error-banner inline" role="alert">
          <span>{error.message}</span>
          {error.retry && (
            <button className="error-action" onClick={() => act(error.retry!)} disabled={running !== null}>
              Stash changes and retry
            </button>
          )}
          {error.worktree && (
            <button className="error-action" onClick={() => switchTab(error.worktree!)}>
              Open that worktree
            </button>
          )}
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {needsAttention(lfsStatus.health) && lfsNoticeDismissed !== lfsSignature && (
        <LfsHealthBanner
          health={lfsStatus.health}
          busy={running !== null}
          onDownload={() => act({ kind: "downloadLfsFiles" }, "download")}
          onSetUp={() => act({ kind: "setUpLfs" }, "download")}
          onGetLfs={() => openInBrowser("https://git-lfs.com")}
          onDismiss={() => setLfsNoticeDismissed(lfsSignature)}
        />
      )}
      {(focus || snapshot.firstParent || soloing) && (
        <ViewBanner
          focus={focus}
          firstParent={snapshot.firstParent}
          solo={visibility.solo}
          branchLabel={branchLabel}
          mine={highlightingMine}
          focusedCount={focusedCount}
          pathMatches={pathMatches}
          selectedIndex={selectedIndex}
          onStep={stepHistory}
          onShowEverything={() => (focus ? setFocus(null) : snapshot.firstParent ? setFirstParentOnly(false) : showAllBranches())}
        />
      )}
      <main className="workspace">
        {sidebarOpen && (
          <>
            <Sidebar
              commits={snapshot.commits}
              hiddenRefs={snapshot.hiddenRefs}
              visibility={visibility}
              pins={pins}
              selectedId={selectedId}
              width={sidebarWidth}
              aheadBehind={aheadBehind}
              onSelect={(id) => byId.has(id) && select(id)}
              onActivate={(entry) => {
                const commit = commitById(entry.commitId);
                const checkout = commit && checkoutFor(ctx, pillForEntry(entry), commit);
                if (checkout && canChange) act(checkout);
              }}
              onContextMenu={sidebarMenu}
              onFocus={(entry) => byId.has(entry.commitId) && setFocus({ kind: "history", name: entry.name, commitId: entry.commitId })}
              onToggleVisible={(entry) => {
                const name = fullRefName(entry);
                if (!name) return;
                const shown = soloing ? visibility.solo.includes(name) : !entry.hidden;
                setHidden([name], shown);
              }}
              onShowAll={showAllBranches}
              onPrune={canChange ? () => setDialog({ kind: "prune" }) : null}
              protectedBranches={protectedBranches}
              locks={lfs.locks?.locks ?? null}
              locksError={lfs.locks?.error ?? null}
              onLockMenu={lockMenu}
              onLockFiles={canChange ? pickFilesToLock : null}
              worktrees={worktreeList}
              onOpenWorktree={(worktree) => !worktree.current && switchTab(worktree.path)}
              onWorktreeMenu={(worktree, x, y) => showMenu(x, y, worktreeMenuItems(worktree, worktreeContext))}
            />
            <ResizeHandle className="panel-handle" {...panelResize("sidebar")} />
          </>
        )}
        <CommitList
          key={snapshot.path}
          snapshot={snapshot}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={select}
          matchIds={matchIds}
          focusIds={focusIds}
          dense={dense}
          columnWidths={columnWidths}
          onColumnWidths={setColumnWidths}
          columnOptions={columnOptions}
          daySeparators={daySeparators}
          onHeaderContextMenu={headerMenu}
          previews={previews}
          loadDetails={loadDetails}
          initialScrollTop={initialScroll}
          onScrollChange={(top) => {
            scrollTop.current = top;
          }}
          onContextMenu={(commit, x, y) =>
            showMenu(x, y, multi && selectedIds?.has(commit.id) ? selectionMenu(ctx, selectedCommits) : commitMenu(ctx, commit))
          }
          onPillActivate={(pill, commit) => {
            const checkout = checkoutFor(ctx, pill, commit);
            if (checkout && canChange) act(checkout);
          }}
          onPillContextMenu={(pill, commit, x, y) => showMenu(x, y, pillMenu(ctx, pill, commit))}
          onPillFocus={(pill, commit) => setFocus({ kind: "history", name: pill.name, commitId: commit.id })}
          onDropRef={(revision, _commit, x, y) => {
            if (revision !== snapshot.headBranch) showMenu(x, y, dropMenu(ctx, revision));
          }}
          onLoadMore={() => load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
          loadingMore={busy?.kind === "more"}
        />
        {(selected || multi) && (
          <>
            <ResizeHandle className="panel-handle" {...panelResize("details")} />
            <div className="details-frame" style={{ width: detailsWidth }}>
              {multi ? (
                <MultiSelectPanel
                  commits={selectedCommits}
                  branch={snapshot.headBranch}
                  canChange={canChange && !snapshot.operation}
                  onCherryPick={() => act({ kind: "cherryPickMany", ids: [...selectedCommits].reverse().map((c) => c.id) })}
                  onRevert={() => act({ kind: "revertMany", ids: selectedCommits.map((c) => c.id) })}
                  onClose={() => setSelection(null)}
                />
              ) : selected!.kind === "worktree" ? (
                <WorktreeDetailsPanel
                  snapshot={snapshot}
                  run={(action, options) => act(action, "other", options)}
                  busy={running !== null}
                  draft={draft}
                  onDraft={setDraft}
                  onStash={() => setDialog({ kind: "stash" })}
                  onDiscard={() => head && setDialog({ kind: "reset", target: head })}
                  onClose={() => select(null)}
                  lockOf={(path) => lfs.byPath.get(path)}
                  onFileMenu={(file, x, y) => fileMenu(file, x, y, "worktree")}
                  checks={checks}
                  canLock={Boolean(lfs.locks)}
                  messageTools={messageTools}
                />
              ) : (
                <CommitDetailsPanel
                  repoPath={snapshot.path}
                  commit={selected!}
                  cache={detailsCache.current}
                  hasCommit={(id) => indexById.has(id)}
                  onSelect={select}
                  onClose={() => select(null)}
                  actions={detailsActions(selected!)}
                  remote={webRemote(snapshot)}
                  resolveCommit={resolveCommit}
                  onFileMenu={(file, x, y) => fileMenu(file, x, y, "commit")}
                  isHighlighted={focus?.kind === "path" ? isHistoryFile : undefined}
                  lockOf={lfs.locks ? (path) => lfs.byPath.get(path) : undefined}
                />
              )}
            </div>
          </>
        )}
      </main>
      {activityOpen && (
        <ActivityPanel
          entries={activityHere}
          folder={snapshot.path}
          onClear={activity.clear}
          onClose={() => setActivityOpen(false)}
        />
      )}
      <StatusBar
        snapshot={snapshot}
        ahead={ahead}
        behind={behind}
        running={running && running !== "other" ? RUNNING_LABELS[running] : running === "other" ? "Working" : null}
        hiddenCount={hiddenCount}
        soloing={soloing}
        onShowAll={showAllBranches}
        onFetch={canFetch && canChange ? () => act({ kind: "fetch" }, "fetch") : null}
        activityOpen={activityOpen}
        activityFailed={activityFailed}
        onToggleActivity={() => setActivityOpen(!activityOpen)}
        onReveal={reveal}
        pruneHint={pruneHint}
        onPrune={canChange ? () => setDialog({ kind: "prune" }) : null}
        onDismissPruneHint={() => setPruneHintDismissed(goneSignature)}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onSideways={menu.onSideways} onClose={() => setMenu(null)} />}
      {paletteOpen && <CommandPalette commands={commands()} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {settingsDialog}
      {diagnosticsDialog}
      {gitHubSignInDialog}
      {updateDialog}
      {cloneDialog}
      <RepositoryDialogs
        dialog={dialog}
        snapshot={snapshot}
        byId={byId}
        branchLabel={branchLabel}
        protectedHead={protectedHead}
        protectedBranches={protectedBranches}
        pins={pins}
        loadDetails={loadDetails}
        run={act}
        select={select}
        open={setDialog}
        onClose={() => setDialog(null)}
        onFinish={finishDialog}
        onLocksChanged={() => lfs.refresh(true)}
        worktrees={worktreeList}
        localBranches={[...localBranches]}
        openWorktree={switchTab}
      />
      {dropOverlay}
      {toast && <Toast toast={toast} onDone={hideToast} />}
    </div>,
  );
}
