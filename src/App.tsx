import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  activityLog,
  cancelAction,
  commitDetails,
  fileChecks,
  fileHistory,
  fullRefName,
  initRepository,
  onActivity,
  onProgress,
  openRepository,
  PAGE_SIZE,
  runAction,
  runActionFor,
  WORKTREE_ID,
  type Action,
  type CommitDetails,
  type CommitRow,
  type FileChange,
  type FileChecks,
  type Lock,
  type LogEntry,
  type Progress,
  type RepoSnapshot,
  type Visibility,
} from "./api";
import { involvesUntrackedFiles, isLocalChangesError } from "./lib/errors";
import { ancestors, countMissing } from "./lib/graph";
import { useLfsLocks } from "./lib/locks";
import { describeNews, findNews, remoteTips } from "./lib/news";
import { notifySystem } from "./lib/notify";
import { useUpdates } from "./lib/updates";
import { baseName, folderOf, joinPath, relativeTo } from "./lib/paths";
import { copyText } from "./lib/clipboard";
import { setNativeMenu, type NativeMenu } from "./lib/nativeMenu";
import { loadPlace, savePlace } from "./lib/place";
import { isMac } from "./lib/platform";
import { forgetRepo, loadRecent, noteBranch, pinRepo, rememberRepo } from "./lib/recent";
import { stashIndexOf, type RefEntry } from "./lib/refs";
import { NO_VISIBILITY, readVisibility, useRepoSetting } from "./lib/repoPrefs";
import { findMatches } from "./lib/search";
import { readSetting, useStoredState } from "./lib/settings";
import { plural } from "./lib/format";
import { newPullRequestUrl, openInBrowser, siteName, webRemote } from "./lib/weblinks";
import {
  canResetTo,
  checkoutFor,
  commitMenu,
  deleteAnyway,
  dropMenu,
  pillForEntry,
  pillMenu,
  selectionMenu,
  splitRemoteBranch,
  type MenuContext,
  type OpenDialog,
} from "./menus";
import { ActivityPanel } from "./components/ActivityPanel";
import { ProfilePictures } from "./components/Avatar";
import { CloneDialog } from "./components/CloneDialog";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { CommitDetailsPanel, type DetailsAction } from "./components/CommitDetails";
import { CommitList, DEFAULT_COLUMNS, type ColumnOptions, type ColumnWidths, type SelectHow } from "./components/CommitList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { ForcePushDialog } from "./components/ForcePushDialog";
import {
  ActivityIcon,
  BellIcon,
  BranchIcon,
  BroomIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloneIcon,
  CloseIcon,
  CloudIcon,
  ColumnsIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FetchIcon,
  FileHistoryIcon,
  FolderIcon,
  GearIcon,
  HistoryIcon,
  IgnoreIcon,
  KeyboardIcon,
  LockIcon,
  MergeIcon,
  NewRepoIcon,
  PlusIcon,
  PullIcon,
  PullRequestIcon,
  PushIcon,
  RebaseIcon,
  RecoverIcon,
  RefreshIcon,
  ResetIcon,
  SearchIcon,
  SidebarIcon,
  StashIcon,
  TagIcon,
  TrashIcon,
  UnlockIcon,
  UserIcon,
  ViewIcon,
} from "./components/Icons";
import { InteractiveRebaseDialog } from "./components/InteractiveRebaseDialog";
import { MenuBar, type AppMenu } from "./components/MenuBar";
import { MultiSelectPanel } from "./components/MultiSelectPanel";
import { NewBranchDialog } from "./components/NewBranchDialog";
import { OperationBar } from "./components/OperationBar";
import { ProgressStrip } from "./components/ProgressStrip";
import { PruneDialog } from "./components/PruneDialog";
import { RestoreDialog } from "./components/RestoreDialog";
import { NameList, SettingsDialog, type SettingsSection } from "./components/SettingsDialog";
import { LfsStorageSummary, PruneLfsDialog } from "./components/LfsCleanup";
import { UpdateDialog } from "./components/UpdateDialog";
import { DEFAULT_PROTECTED, ProtectedActionDialog } from "./components/Safety";
import { DeleteBranchDialog, DeleteRemoteBranchDialog } from "./components/DeleteBranchDialogs";
import { RenameBranchDialog } from "./components/RenameBranchDialog";
import { ResetDialog } from "./components/ResetDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Sidebar } from "./components/Sidebar";
import { StashDialog } from "./components/StashDialog";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type Tab } from "./components/TabBar";
import { TagDialog } from "./components/TagDialog";
import { Toast, type ToastMessage } from "./components/Toast";
import { Toolbar, type RemoteAction } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { conflictSides, EMPTY_DRAFT, lfsPattern, WorktreeDetailsPanel, type CommitDraft } from "./components/WorktreeDetails";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;
type Running = RemoteAction | "other" | null;
/** What's highlighted: a branch's (or commit's) history, an author's commits, or the commits that changed a file or folder. */
type Focus =
  | { kind: "history"; name: string; commitId: string }
  | { kind: "author"; name: string; email: string }
  | { kind: "path"; path: string; folder: boolean; ids: string[]; names: string[]; truncated: boolean };

/** Don't refresh on window focus more often than this, in milliseconds. */
const FOCUS_REFRESH_INTERVAL = 2000;
/** How often to fetch in the background, in minutes, to choose from. */
const FETCH_MINUTES = [1, 2, 5, 10, 15, 30];
/** The first background fetch after opening a repository. */
const FIRST_AUTO_FETCH_DELAY = 5000;
/** Fetches, pulls and pushes that finish faster than this don't show a progress bar. */
const PROGRESS_DELAY = 300;
const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** How many git commands the activity log keeps. */
const ACTIVITY_SIZE = 300;
/** Actions that can be retried after stashing when uncommitted changes are in the way. */
const RETRYABLE = new Set<Action["kind"]>([
  "pull",
  "checkoutBranch",
  "checkoutRemoteBranch",
  "checkoutCommit",
  "createBranch",
  "merge",
  "rebase",
  "cherryPick",
  "revert",
  "cherryPickMany",
  "revertMany",
  "interactiveRebase",
]);
const RUNNING_LABELS: Record<RemoteAction, string> = { fetch: "Fetching", pull: "Pulling", push: "Pushing" };

/** A command for the menu bar, the menus and the command palette. */
interface AppCommand {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A keyboard shortcut, like "CmdOrCtrl+K". */
  keys?: string;
  enabled?: boolean;
  /** For on/off settings. */
  checked?: boolean;
  danger?: boolean;
  run: () => void;
}
type MenuEntry = AppCommand | "-";

/** "CmdOrCtrl+Shift+L" as it's written on this platform: "⇧⌘L" or "Ctrl+Shift+L". */
function shortcutLabel(keys: string): string {
  const parts = keys.split("+").filter(Boolean);
  const key = keys.endsWith("++") ? "+" : (parts.pop() ?? "");
  const shown = key === "=" ? "+" : key;
  if (isMac) {
    const symbols: Record<string, string> = { CmdOrCtrl: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
    const order = ["Ctrl", "Alt", "Shift", "CmdOrCtrl"];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((part) => symbols[part] ?? part).join("") + shown;
  }
  return [...parts.map((part) => (part === "CmdOrCtrl" ? "Ctrl" : part)), shown].join("+");
}

function setWindowTitle(title: string) {
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

function applyZoom(level: number) {
  getCurrentWebview()
    .setZoom(level)
    .catch(() => {});
}

const unique = (names: string[]) => [...new Set(names)];
const sameAuthor = (commit: CommitRow, name: string, email: string) =>
  email ? commit.authorEmail.toLowerCase() === email.toLowerCase() : commit.authorName === name;

export default function App() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** When several commits are selected: all of them, in the order they were added. */
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ message: string; retry?: Action } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
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
  const [activity, setActivity] = useState<LogEntry[]>([]);
  /** Log entries up to this id were cleared. */
  const [activityCleared, setActivityCleared] = useState(0);
  /** A folder is being dragged over the window. */
  const [droppingFolder, setDroppingFolder] = useState(false);

  // Remembered between launches.
  const [tabs, setTabs] = useStoredState<Tab[]>("tabs.list", []);
  const [, setActiveTab] = useStoredState<string | null>("tabs.active", null);
  const [sidebarOpen, setSidebarOpen] = useStoredState("sidebar.open", true);
  const [sidebarWidth, setSidebarWidth] = useStoredState("sidebar.width", 220);
  const [detailsWidth, setDetailsWidth] = useStoredState("details.width", 380);
  const [columnWidths, setColumnWidths] = useStoredState<ColumnWidths>("columns", { refs: null, graph: null });
  const [columnOptions, setColumnOptions] = useStoredState<ColumnOptions>("columns.shown", DEFAULT_COLUMNS);
  const [daySeparators, setDaySeparators] = useStoredState("list.daySeparators", true);
  const [dense, setDense] = useStoredState("rows.compact", false);
  const [zoom, setZoom] = useStoredState("zoom", 1);
  const [autoFetch, setAutoFetch] = useStoredState("fetch.auto", true);
  const [reopenTabs, setReopenTabs] = useStoredState("reopenLast", true);
  const [firstParentOnly, setFirstParentOnly] = useStoredState("history.firstParent", false);
  const [profilePictures, setProfilePictures] = useStoredState("avatars.pictures", false);
  const [previews, setPreviews] = useStoredState("previews", true);
  const [activityOpen, setActivityOpen] = useStoredState("activity.open", false);
  const [fetchMinutes, setFetchMinutes] = useStoredState("fetch.minutes", 5);
  /** New commits found by a background fetch: not mentioned, a message in the window, or a system notification too. */
  const [newCommitNotices, setNewCommitNotices] = useStoredState<"off" | "app" | "system">("notify.newCommits", "app");
  const [autoUpdate, setAutoUpdate] = useStoredState("updates.auto", true);
  /** Warn about files at least this big (in MB) that aren't in Git LFS. */
  const [largeFileMB, setLargeFileMB] = useStoredState("files.largeMB", 10);
  /** Lock lockable files as soon as you change them. */
  const [autoLock, setAutoLock] = useStoredState("locks.auto", false);
  const updates = useUpdates(autoUpdate);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  /** What undoing `action` would take, given where HEAD is now. */
  const undoFor = (action: Action, before: RepoSnapshot): Action | null => {
    const back: Action | null = before.headBranch
      ? { kind: "checkoutBranch", name: before.headBranch }
      : before.headCommit
        ? { kind: "checkoutCommit", id: before.headCommit }
        : null;
    switch (action.kind) {
      case "checkoutBranch":
      case "checkoutRemoteBranch":
      case "checkoutCommit":
        return back;
      case "resetHard":
      case "merge":
      case "rebase":
      case "cherryPick":
      case "revert":
      case "cherryPickMany":
      case "revertMany":
      case "interactiveRebase":
        return before.headCommit ? { kind: "resetHard", id: before.headCommit } : null;
      case "commit":
        return before.headCommit ? { kind: "resetSoft", id: before.headCommit } : null;
      case "deleteBranches":
        // Branches that weren't deleted are skipped when restoring.
        return { kind: "restoreBranches", branches: action.branches };
      case "resolveConflicts":
        return { kind: "recreateConflicts", paths: action.paths };
      case "ignorePaths":
        return { kind: "unignorePaths", patterns: action.patterns };
      case "stashAndRetry": {
        // Undo the same way: put the changes aside, undo, and put them back.
        const inner = undoFor(action.action, before);
        return inner && inner.kind !== "resetSoft"
          ? { kind: "stashAndRetry", action: inner, includeUntracked: action.includeUntracked }
          : null;
      }
      default:
        return null;
    }
  };

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
      if (failure === "Cancelled.") {
        setToast({ text: "Cancelled" });
        return false;
      }
      if (failure) {
        const retry: Action | undefined =
          RETRYABLE.has(action.kind) && isLocalChangesError(failure)
            ? { kind: "stashAndRetry", action, includeUntracked: involvesUntrackedFiles(failure) }
            : undefined;
        setError({ message: failure, retry });
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
    // undoFor only reads its arguments.
    [snapshot, load, protectedHead, lfs.refresh],
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
      const list = commits ?? [];
      const selectable = (commitId: string) => byId.get(commitId)?.kind !== "worktree";
      if (!id) {
        setSelectedId(null);
        setSelection(null);
        return;
      }
      const anchor = selectionAnchor.current;
      if (how.extend && anchor && anchor !== id && selectable(id) && selectable(anchor) && indexById.has(anchor)) {
        const [from, to] = [indexById.get(anchor)!, indexById.get(id)!].sort((a, b) => a - b);
        const range = list.slice(from, to + 1).filter((commit) => commit.kind !== "worktree").map((commit) => commit.id);
        setSelection(range.length > 1 ? range : null);
        setSelectedId(id);
        return;
      }
      if (how.toggle && selectable(id)) {
        const base = selection ?? (selectedId && selectable(selectedId) ? [selectedId] : []);
        const next = base.includes(id) ? base.filter((other) => other !== id) : [...base, id];
        setSelection(next.length > 1 ? next : null);
        setSelectedId(next.includes(id) ? id : (next[next.length - 1] ?? null));
        selectionAnchor.current = id;
        return;
      }
      selectionAnchor.current = id;
      setSelection(null);
      setSelectedId(id);
    },
    [commits, byId, indexById, selectedId, selection],
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
    if (!snapshot || matches.length === 0) return;
    const from = selectedIndex ?? -1;
    const next =
      step > 0
        ? (matches.find((index) => index > from) ?? matches[0])
        : ([...matches].reverse().find((index) => index < from) ?? matches[matches.length - 1]);
    select(snapshot.commits[next].id);
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
    if (!snapshot || pathMatches.length === 0) return;
    const from = selectedIndex ?? -1;
    const next =
      step > 0
        ? (pathMatches.find((index) => index > from) ?? pathMatches[0])
        : ([...pathMatches].reverse().find((index) => index < from) ?? pathMatches[pathMatches.length - 1]);
    select(snapshot.commits[next].id);
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

  // The latest state, for keyboard shortcuts, timers and window events that outlive a render.
  const latest = useRef({ snapshot, dialog, running, refresh, autoFetch, tabs, focus, selection, refreshLocks: lfs.refresh });
  latest.current = { snapshot, dialog, running, refresh, autoFetch, tabs, focus, selection, refreshLocks: lfs.refresh };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      const { tabs, snapshot, focus, selection } = latest.current;
      if (mod && key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (mod && key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (mod && key === "o" && !event.shiftKey) {
        event.preventDefault();
        pick();
      } else if (mod && key === "t" && !event.shiftKey) {
        event.preventDefault();
        newTab();
      } else if (mod && key === "w") {
        event.preventDefault();
        if (snapshot) closeTab(snapshot.path);
        else if (startTab) closeStartTab();
      } else if (mod && /^[1-9]$/.test(key)) {
        event.preventDefault();
        const tab = tabs[Number(key) - 1];
        if (tab) switchTab(tab.path);
      } else if (event.ctrlKey && event.key === "Tab" && tabs.length > 1 && snapshot) {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.path === snapshot.path);
        const next = tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length];
        switchTab(next.path);
      } else if ((mod && key === "r") || event.key === "F5") {
        event.preventDefault();
        refresh();
      } else if (mod && key === "f") {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (mod && key === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (mod && event.shiftKey && key === "l") {
        event.preventDefault();
        setActivityOpen((open) => !open);
      } else if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        zoomBy(1);
      } else if (mod && key === "-") {
        event.preventDefault();
        zoomBy(-1);
      } else if (mod && key === "0") {
        event.preventDefault();
        zoomBy(0);
      } else if (event.key === "?" && !typing) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key === "Escape" && !typing) {
        // Stop highlighting first, then drop a multiple selection, then close the details.
        if (focus) setFocus(null);
        else if (selection) setSelection(null);
        else setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pick, refresh, zoomBy, setSidebarOpen, setActivityOpen, closeTab, switchTab, newTab, startTab, closeStartTab]);

  // Reopen your tabs (or the last repository) on launch.
  useEffect(() => {
    if (!readSetting("reopenLast", true)) return;
    const active = readSetting<string | null>("tabs.active", null);
    const open = readSetting<Tab[]>("tabs.list", []);
    const path = active ?? open[0]?.path ?? loadRecent()[0]?.path;
    if (path) load(path, "open");
  }, [load]);

  // The activity log: what's already been run, then each new command as it happens.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    activityLog()
      .then((entries) => !disposed && setActivity(entries))
      .catch(() => {});
    onActivity((entry) => setActivity((current) => [...current.slice(1 - ACTIVITY_SIZE), entry]))
      .then((unlisten) => (disposed ? unlisten() : (stop = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  // A folder dropped onto the window opens it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === "enter" || payload.type === "over") setDroppingFolder(true);
        else if (payload.type === "leave") setDroppingFolder(false);
        else if (payload.type === "drop") {
          setDroppingFolder(false);
          const path = payload.paths[0];
          if (path && !latest.current.dialog) load(path, "open");
        }
      })
      .then((unlisten) => (disposed ? unlisten() : (stop = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [load]);

  // Pick up changes made elsewhere (a commit in the terminal, an edit in the editor)
  // when coming back to the window.
  useEffect(() => {
    const onFocus = () => {
      const { snapshot, dialog, running, refresh } = latest.current;
      if (!snapshot || dialog || running || blockFocusRefresh.current) return;
      if (Date.now() - lastLoad.current < FOCUS_REFRESH_INTERVAL) return;
      refresh();
      latest.current.refreshLocks();
    };
    const stopQuietly = (stop: () => void) => {
      try {
        stop();
      } catch {
        // Already gone.
      }
    };
    // The DOM event covers most cases; the window event also catches the app being
    // activated while the web page itself already had focus.
    window.addEventListener("focus", onFocus);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => focused && onFocus())
      .then((stop) => (disposed ? stopQuietly(stop) : (unlisten = stop)))
      .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      if (unlisten) stopQuietly(unlisten);
    };
  }, []);

  // Fetch in the background every few minutes, so the pull and push counts stay current.
  const repoPath = snapshot?.path ?? null;
  const canFetch = Boolean(snapshot && !snapshot.bare && snapshot.remotes.length > 0);
  // With system notifications, keep fetching while the window is minimized, so news still arrives.
  const fetchWhileHidden = newCommitNotices === "system";
  useEffect(() => {
    if (!repoPath || !canFetch || !autoFetch) return;
    let stopped = false;
    const fetchNow = async () => {
      const { snapshot, dialog, running } = latest.current;
      if (stopped || !snapshot || snapshot.path !== repoPath || dialog || running) return;
      if (document.hidden && !fetchWhileHidden) return;
      const before = remoteTips(snapshot);
      const known = new Set(snapshot.commits.map((commit) => commit.id));
      try {
        await runAction(repoPath, { kind: "fetch", background: true });
        if (stopped) return;
        pendingNews.current = { path: repoPath, before, known };
        if (!latest.current.dialog && !latest.current.running) latest.current.refresh();
        latest.current.refreshLocks();
      } catch {
        // Usually missing credentials or no network. Fetching by hand shows the reason;
        // don't try again in the background until then.
        stopped = true;
      }
    };
    const first = setTimeout(fetchNow, FIRST_AUTO_FETCH_DELAY);
    const timer = setInterval(fetchNow, Math.max(1, fetchMinutes) * 60 * 1000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [repoPath, canFetch, autoFetch, fetchMinutes, fetchWhileHidden]);

  // After a background fetch: tell you about new commits on your branch's upstream or on main.
  const pendingNews = useRef<{ path: string; before: Map<string, string>; known: Set<string> } | null>(null);
  useEffect(() => {
    const pending = pendingNews.current;
    if (!snapshot || !pending || pending.path !== snapshot.path) return;
    pendingNews.current = null;
    if (newCommitNotices === "off") return;
    const news = findNews(pending.before, pending.known, snapshot);
    if (news.length === 0) return;
    // Your own branch's news first.
    news.sort((a, b) => Number(b.branch === snapshot.upstream?.name) - Number(a.branch === snapshot.upstream?.name));
    const top = news[0];
    const pullable = top.branch === snapshot.upstream?.name && !snapshot.operation;
    setToast({
      text: describeNews(top) + (news.length > 1 ? `, and more on ${news.length - 1} other ${news.length === 2 ? "branch" : "branches"}` : ""),
      icon: <BellIcon size={14} />,
      action: pullable
        ? { label: "Pull", onClick: () => act({ kind: "pull" }, "pull") }
        : { label: "Show", onClick: () => select(top.tip) },
    });
    if (newCommitNotices === "system" && !document.hasFocus()) {
      for (const item of news) notifySystem(snapshot.name, describeNews(item));
    }
    // Only the snapshot matters: the rest is read as it is when the snapshot arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Changed files: which are big and not in Git LFS, and which are lockable.
  const [checks, setChecks] = useState<FileChecks | null>(null);
  const changedFiles = useMemo(
    () =>
      snapshot?.worktree
        ? [...snapshot.worktree.staged, ...snapshot.worktree.unstaged]
            .filter((file) => file.status !== "deleted" && file.status !== "conflicted")
            .map((file) => file.path)
        : [],
    [snapshot],
  );
  const changedSignature = changedFiles.join("\n");
  useEffect(() => {
    if (!repoPath || changedFiles.length === 0) {
      setChecks(null);
      return;
    }
    let live = true;
    fileChecks(repoPath, changedFiles, Math.max(1, largeFileMB) * 1_000_000)
      .then((found) => live && setChecks(found))
      .catch(() => live && setChecks(null));
    return () => {
      live = false;
    };
    // The signature stands for the list of files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, changedSignature, largeFileMB]);

  // With "lock when I change them" on: lock lockable files you've changed that nobody holds.
  const autoLocked = useRef(new Set<string>());
  useEffect(() => {
    if (!autoLock || !snapshot || !lfs.locks || running || !checks) return;
    const toLock = checks.lockable.filter((path) => !lfs.byPath.has(path) && !autoLocked.current.has(`${snapshot.path}\n${path}`));
    if (toLock.length === 0) return;
    // Try each file once per session, even if locking fails.
    for (const path of toLock) autoLocked.current.add(`${snapshot.path}\n${path}`);
    act({ kind: "lockFiles", paths: toLock });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLock, checks, lfs.locks]);

  // The "only this branch" setting changed: reload.
  const firstParentLoaded = snapshot?.firstParent;
  useEffect(() => {
    if (firstParentLoaded !== undefined && firstParentLoaded !== firstParentOnly) latest.current.refresh();
  }, [firstParentOnly, firstParentLoaded]);

  // How far the checked-out branch is ahead of / behind its upstream, among loaded commits.
  const headHistory = useMemo(() => ancestors(snapshot?.headCommit, byId), [snapshot, byId]);
  const { ahead, behind } = useMemo(() => {
    if (!snapshot?.upstream?.commit || !snapshot.headCommit) return { ahead: 0, behind: 0 };
    const remote = ancestors(snapshot.upstream.commit, byId);
    return { ahead: countMissing(headHistory, remote), behind: countMissing(remote, headHistory) };
  }, [snapshot, byId, headHistory]);

  // The same for every local branch that tracks a remote branch, for the sidebar.
  const aheadBehind = useMemo(() => {
    const result = new Map<string, { ahead: number; behind: number }>();
    if (!snapshot) return result;
    const remoteTips = new Map<string, string>();
    const branches: { name: string; id: string; upstream: string }[] = [];
    for (const commit of snapshot.commits) {
      for (const ref of commit.refs) {
        if (ref.kind === "remote") remoteTips.set(ref.name, commit.id);
        if (ref.kind === "branch" && ref.upstream) branches.push({ name: ref.name, id: commit.id, upstream: ref.upstream });
      }
    }
    for (const branch of branches) {
      const upstreamId = remoteTips.get(branch.upstream);
      if (!upstreamId) continue;
      const local = ancestors(branch.id, byId);
      const remote = ancestors(upstreamId, byId);
      result.set(branch.name, { ahead: countMissing(local, remote), behind: countMissing(remote, local) });
    }
    return result;
  }, [snapshot, byId]);

  // Local branch names anywhere in the history, to know which remote branches can be checked out.
  const localBranches = useMemo(
    () =>
      new Set([
        ...(snapshot?.commits ?? []).flatMap((commit) =>
          commit.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name),
        ),
        ...(snapshot?.hiddenRefs ?? []).filter((ref) => ref.kind === "branch").map((ref) => ref.name),
      ]),
    [snapshot],
  );

  const activityHere = activity.filter((entry) => entry.id > activityCleared);
  const lastHere = [...activityHere].reverse().find((entry) => entry.folder === snapshot?.path && !entry.background);
  const activityFailed = Boolean(lastHere && !lastHere.success);

  const showMenu = (x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items });
  const menuUnder = (anchor: HTMLElement, items: MenuItem[], width = 240) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({ x: Math.max(4, Math.min(rect.left, rect.right - width)), y: rect.bottom + 4, items });
  };

  // Commands that work with or without an open repository.
  const fileCommands: AppCommand[] = [
    { id: "open", label: "Open Repository…", icon: <FolderIcon />, keys: "CmdOrCtrl+O", run: pick },
    { id: "clone", label: "Clone Repository…", icon: <CloneIcon />, run: () => setDialog({ kind: "clone" }) },
    { id: "init", label: "New Repository…", icon: <NewRepoIcon />, run: createRepository },
  ];
  const settingsCommand: AppCommand = { id: "settings", label: "Settings…", icon: <GearIcon />, keys: "CmdOrCtrl+,", run: () => setSettingsOpen(true) };
  const helpCommands: AppCommand[] = [
    { id: "palette", label: "Command Palette", icon: <SearchIcon />, keys: "CmdOrCtrl+K", run: () => setPaletteOpen(true) },
    { id: "shortcuts", label: "Keyboard Shortcuts", icon: <KeyboardIcon />, run: () => setShortcutsOpen(true) },
  ];
  const zoomCommands: AppCommand[] = [
    { id: "zoom-in", label: "Zoom In", keys: "CmdOrCtrl+=", run: () => zoomBy(1) },
    { id: "zoom-out", label: "Zoom Out", keys: "CmdOrCtrl+-", run: () => zoomBy(-1) },
    { id: "zoom-reset", label: `Actual Size (now ${Math.round(zoom * 100)}%)`, keys: "CmdOrCtrl+0", run: () => zoomBy(0) },
  ];
  const settingCommands: AppCommand[] = [
    { id: "previews", label: "Previews on Hover", checked: previews, run: () => setPreviews(!previews) },
    { id: "pictures", label: "Profile Pictures (Gravatar, GitHub)", checked: profilePictures, run: () => setProfilePictures(!profilePictures) },
    { id: "auto-fetch", label: `Fetch Every ${fetchMinutes === 1 ? "Minute" : `${fetchMinutes} Minutes`}`, checked: autoFetch, run: () => setAutoFetch(!autoFetch) },
    { id: "reopen", label: "Reopen Tabs on Launch", checked: reopenTabs, run: () => setReopenTabs(!reopenTabs) },
  ];

  /** The menu bar: on macOS the system's own, elsewhere one in the tab bar. */
  const appMenus = (): { label: string; entries: MenuEntry[] }[] => {
    if (!snapshot) {
      return [
        { label: "File", entries: [...fileCommands, ...(isMac ? [] : ["-" as const, settingsCommand])] },
        { label: "View", entries: [...settingCommands, "-", ...zoomCommands] },
        { label: "Help", entries: helpCommands },
      ];
    }
    const hasRemotes = snapshot.remotes.length > 0 && !snapshot.bare;
    const canChange = !snapshot.bare && running === null;
    const remote = webRemote(snapshot);
    const prUrl = remote && snapshot.headBranch && snapshot.upstream ? newPullRequestUrl(remote, splitRemoteBranch(snapshot.upstream.name, snapshot.remotes).branch) : null;
    const head = snapshot.headCommit ? byId.get(snapshot.headCommit) : undefined;
    return [
      {
        label: "File",
        entries: [
          { id: "new-tab", label: "New Tab", keys: "CmdOrCtrl+T", icon: <PlusIcon />, run: newTab },
          ...fileCommands,
          "-",
          { id: "close-tab", label: "Close Tab", keys: "CmdOrCtrl+W", icon: <CloseIcon />, run: () => closeTab(snapshot.path) },
          ...(isMac ? [] : ["-" as const, settingsCommand]),
        ],
      },
      {
        label: "View",
        entries: [
          { id: "search", label: "Search Commits", keys: "CmdOrCtrl+F", icon: <SearchIcon />, run: () => searchInput.current?.focus() },
          helpCommands[0],
          "-",
          { id: "sidebar", label: "Branches Sidebar", keys: "CmdOrCtrl+B", checked: sidebarOpen, run: () => setSidebarOpen(!sidebarOpen) },
          { id: "activity", label: "Activity", keys: "CmdOrCtrl+Shift+L", checked: activityOpen, run: () => setActivityOpen(!activityOpen) },
          "-",
          { id: "first-parent", label: `Only ${snapshot.headBranch ?? "HEAD"}'s Own History`, checked: firstParentOnly, run: () => setFirstParentOnly(!firstParentOnly) },
          { id: "show-all", label: "Show All Branches", enabled: hiddenCount > 0, run: showAllBranches },
          { id: "mine", label: "Highlight My Commits", checked: highlightingMine, enabled: Boolean(user), run: highlightMine },
          "-",
          { id: "day-separators", label: "Day Separators", checked: daySeparators, run: () => setDaySeparators(!daySeparators) },
          { id: "dense", label: "Compact Rows", checked: dense, run: () => setDense(!dense) },
          ...settingCommands.slice(0, 2),
          "-",
          ...zoomCommands,
          "-",
          { id: "reset-layout", label: "Reset Column and Panel Sizes", run: resetLayout },
        ],
      },
      {
        label: "Repository",
        entries: [
          { id: "refresh", label: "Refresh", keys: "CmdOrCtrl+R", icon: <RefreshIcon />, run: refresh },
          { id: "fetch", label: "Fetch", icon: <FetchIcon />, enabled: hasRemotes && canChange, run: () => act({ kind: "fetch" }, "fetch") },
          { id: "pull", label: "Pull", icon: <PullIcon />, enabled: hasRemotes && canChange && Boolean(snapshot.upstream), run: () => act({ kind: "pull" }, "pull") },
          { id: "push", label: "Push", icon: <PushIcon />, enabled: hasRemotes && canChange && Boolean(snapshot.headBranch), run: () => act({ kind: "push", force: false }, "push") },
          { id: "force-push", label: "Force Push…", icon: <PushIcon />, danger: true, enabled: hasRemotes && canChange && Boolean(snapshot.headBranch), run: () => setDialog({ kind: "forcePush" }) },
          "-",
          { id: "commit", label: "Commit…", icon: <PlusIcon />, enabled: Boolean(snapshot.worktree) && canChange, run: () => select(WORKTREE_ID) },
          { id: "stash", label: "Stash Changes…", icon: <StashIcon />, enabled: Boolean(snapshot.worktree) && canChange, run: () => setDialog({ kind: "stash" }) },
          "-",
          { id: "new-branch", label: "New Branch…", icon: <BranchIcon />, enabled: Boolean(head) && canChange, run: () => head && setDialog({ kind: "newBranch", target: head }) },
          { id: "new-tag", label: "New Tag…", icon: <TagIcon />, enabled: Boolean(head) && canChange, run: () => head && setDialog({ kind: "tag", target: head }) },
          { id: "prune", label: "Prune Branches…", icon: <BroomIcon />, enabled: canChange, run: () => setDialog({ kind: "prune" }) },
          { id: "restore", label: "Restore Branch…", icon: <HistoryIcon />, enabled: canChange, run: () => setDialog({ kind: "restore" }) },
          "-",
          { id: "file-history", label: "File History…", icon: <FileHistoryIcon />, run: () => pickHistory(false) },
          { id: "folder-history", label: "Folder History…", icon: <FolderIcon />, run: () => pickHistory(true) },
          ...(lfs.locks ? [{ id: "lock-files", label: "Lock Files…", icon: <LockIcon />, enabled: canChange, run: pickFilesToLock }] : []),
          ...(lfs.locks || checks?.usesLfs
            ? [{ id: "prune-lfs", label: "Clean Up Git LFS Files…", icon: <BroomIcon />, enabled: canChange, run: () => setDialog({ kind: "pruneLfs" }) }]
            : []),
          { id: "recover", label: "Recover Commits…", icon: <RecoverIcon />, run: () => setDialog({ kind: "recover" }) },
          "-",
          ...(remote
            ? [
                { id: "open-web", label: `Open on ${siteName(remote)}`, icon: <ExternalLinkIcon />, run: () => openInBrowser(remote.url) },
                ...(prUrl
                  ? [{ id: "pull-request", label: remote.host === "gitlab" ? "Create Merge Request…" : "Create Pull Request…", icon: <PullRequestIcon />, run: () => openInBrowser(prUrl) }]
                  : []),
              ]
            : []),
          { id: "reveal", label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, run: reveal },
          "-",
          settingCommands[2],
        ],
      },
      { label: "Help", entries: [...helpCommands, "-", settingCommands[3]] },
    ];
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

  const menuItems = (entries: MenuEntry[]): MenuItem[] => {
    const items: MenuItem[] = [];
    let separated = false;
    for (const entry of entries) {
      if (entry === "-") {
        separated = items.length > 0;
        continue;
      }
      items.push({
        label: entry.label,
        icon: entry.icon,
        checked: entry.checked,
        danger: entry.danger,
        disabled: entry.enabled === false,
        shortcut: entry.keys ? shortcutLabel(entry.keys) : undefined,
        separated,
        onSelect: entry.run,
      });
      separated = false;
    }
    return items;
  };

  // On macOS, the commands go in the system menu bar (rebuilt when they change).
  const menus = appMenus();
  const commandRuns = useRef(new Map<string, () => void>());
  commandRuns.current = new Map(
    menus.flatMap((m) => m.entries).flatMap((entry) => (entry === "-" ? [] : [[entry.id, entry.run] as const])),
  );
  commandRuns.current.set("settings", settingsCommand.run);
  const nativeMenus: NativeMenu[] = [
    { label: "Tributary", items: [{ system: "About" }, { system: "Separator" }, { id: "settings", label: "Settings…", accelerator: "CmdOrCtrl+," }, { system: "Separator" }, { system: "Services" }, { system: "Separator" }, { system: "Hide" }, { system: "HideOthers" }, { system: "ShowAll" }, { system: "Separator" }, { system: "Quit" }] },
    ...menus.flatMap((m, index): NativeMenu[] => {
      const items: NativeMenu["items"] = [];
      let separated = false;
      for (const entry of m.entries) {
        if (entry === "-") {
          separated = items.length > 0;
          continue;
        }
        items.push({ id: entry.id, label: entry.label, accelerator: entry.keys, enabled: entry.enabled ?? true, checked: entry.checked, separated });
        separated = false;
      }
      const menu = { label: m.label, items };
      // Edit (for text fields) after File, and Window before Help, as on every Mac app.
      if (index === 0) {
        return [menu, { label: "Edit", items: [{ system: "Undo" }, { system: "Redo" }, { system: "Separator" }, { system: "Cut" }, { system: "Copy" }, { system: "Paste" }, { system: "SelectAll" }] }];
      }
      if (m.label === "Help") return [{ label: "Window", items: [{ system: "Minimize" }, { system: "Maximize" }, { system: "Fullscreen" }] }, menu];
      return [menu];
    }),
  ];
  const nativeSignature = isMac ? JSON.stringify(nativeMenus) : "";
  useEffect(() => {
    if (!isMac) return;
    setNativeMenu(JSON.parse(nativeSignature), (id) => commandRuns.current.get(id)?.()).catch(() => {});
  }, [nativeSignature]);

  const menuBar = isMac ? undefined : (
    <MenuBar menus={menus.map((m): AppMenu => ({ label: m.label, items: menuItems(m.entries) }))} onOpen={(m, anchor) => menuUnder(anchor, m.items, 280)} />
  );

  /** Everything in the Settings window. */
  const settingsSections = (): SettingsSection[] => {
    const sections: SettingsSection[] = [
      {
        title: "General",
        rows: [
          { kind: "toggle", label: "Reopen tabs on launch", value: reopenTabs, set: setReopenTabs },
          {
            kind: "toggle",
            label: "Check for updates automatically",
            hint: "New versions come from Tributary's GitHub releases.",
            value: autoUpdate,
            set: setAutoUpdate,
          },
          {
            kind: "custom",
            label: version ? `Version ${version}` : "Version",
            hint: updates.status ?? undefined,
            content: updates.available ? (
              <button className="outline-button" onClick={() => setUpdateOpen(true)}>
                <DownloadIcon size={14} />
                <span className="button-label">Install {updates.available.version}</span>
              </button>
            ) : (
              <button className="outline-button" onClick={updates.check} disabled={updates.checking}>
                <span className="button-label">{updates.checking ? "Checking…" : "Check now"}</span>
              </button>
            ),
          },
        ],
      },
      {
        title: "Fetching",
        rows: [
          {
            kind: "toggle",
            label: "Fetch in the background",
            hint: "Keeps the pull and push counts current.",
            value: autoFetch,
            set: setAutoFetch,
          },
          {
            kind: "select",
            label: "How often",
            value: String(fetchMinutes),
            options: FETCH_MINUTES.map((minutes) => ({ value: String(minutes), label: minutes === 1 ? "Every minute" : `Every ${minutes} minutes` })),
            set: (value) => setFetchMinutes(Number(value)),
            disabled: !autoFetch,
          },
          {
            kind: "select",
            label: "New commits",
            hint: "When a background fetch finds new commits on main, or on the branch yours tracks.",
            value: newCommitNotices,
            options: [
              { value: "off", label: "Don't tell me" },
              { value: "app", label: "Show a message in Tributary" },
              { value: "system", label: "Also notify me when Tributary is in the background" },
            ],
            set: (value) => setNewCommitNotices(value as "off" | "app" | "system"),
            disabled: !autoFetch,
          },
        ],
      },
      {
        title: "Large files and Git LFS",
        rows: [
          {
            kind: "select",
            label: "Warn about big files outside Git LFS",
            hint: "Committed into git itself, they stay in every clone forever.",
            value: String(largeFileMB),
            options: [1, 5, 10, 25, 50, 100].map((mb) => ({ value: String(mb), label: `Bigger than ${mb} MB` })),
            set: (value) => setLargeFileMB(Number(value)),
          },
          {
            kind: "toggle",
            label: "Lock files when I change them",
            hint: "Lockable files (like .uasset), as soon as you change one that nobody has locked.",
            value: autoLock,
            set: setAutoLock,
          },
        ],
      },
      {
        title: "Commit list",
        rows: [
          { kind: "toggle", label: "Compact rows", value: dense, set: setDense },
          { kind: "toggle", label: "Day separators", value: daySeparators, set: setDaySeparators },
          { kind: "toggle", label: "Previews on hover", hint: "A commit's details when you rest the pointer on it.", value: previews, set: setPreviews },
          {
            kind: "toggle",
            label: "Profile pictures",
            hint: "From Gravatar and GitHub, looked up by email address.",
            value: profilePictures,
            set: setProfilePictures,
          },
          {
            kind: "custom",
            label: "Columns",
            content: (
              <span className="settings-checks">
                {(["author", "date", "sha"] as const).map((column) => (
                  <label key={column} className="checkbox">
                    <input
                      type="checkbox"
                      checked={columnOptions[column]}
                      onChange={() => setColumnOptions({ ...columnOptions, [column]: !columnOptions[column] })}
                    />
                    {column === "sha" ? "SHA" : column[0].toUpperCase() + column.slice(1)}
                  </label>
                ))}
              </span>
            ),
          },
          {
            kind: "select",
            label: "Dates",
            value: columnOptions.dateFormat,
            options: [
              { value: "relative", label: "Relative (“3 hours ago”)" },
              { value: "exact", label: "Exact dates and times" },
            ],
            set: (value) => setColumnOptions({ ...columnOptions, dateFormat: value as ColumnOptions["dateFormat"] }),
            disabled: !columnOptions.date,
          },
          {
            kind: "select",
            label: "Which date",
            value: columnOptions.dateKind,
            options: [
              { value: "authored", label: "When it was written" },
              { value: "committed", label: "When it was committed" },
            ],
            set: (value) => setColumnOptions({ ...columnOptions, dateKind: value as ColumnOptions["dateKind"] }),
            disabled: !columnOptions.date,
          },
          {
            kind: "select",
            label: "Zoom",
            value: String(zoom),
            options: ZOOM_LEVELS.map((level) => ({ value: String(level), label: `${Math.round(level * 100)}%` })),
            set: (value) => setZoom(Number(value)),
          },
        ],
      },
    ];
    if (snapshot) {
      sections.push({
        title: `This repository: ${snapshot.name}`,
        rows: [
          {
            kind: "custom",
            label: "Protected branches",
            hint: "Can't be deleted; rebasing, hard resetting or force pushing them needs their name typed.",
            content: <NameList names={protectedBranches} onChange={setProtectedBranches} placeholder="Add a branch" />,
          },
          {
            kind: "custom",
            label: "Git LFS files on this computer",
            hint: "Copies of every version you've downloaded. Cleaning up keeps what you still need.",
            content: (
              <LfsStorageSummary
                repoPath={snapshot.path}
                onCleanUp={() => {
                  setSettingsOpen(false);
                  setDialog({ kind: "pruneLfs" });
                }}
              />
            ),
          },
        ],
      });
    }
    return sections;
  };
  const settingsDialog = settingsOpen && <SettingsDialog sections={settingsSections()} onClose={() => setSettingsOpen(false)} />;
  const updateDialog = updateOpen && updates.available && <UpdateDialog update={updates.available} onClose={() => setUpdateOpen(false)} />;
  const updatePill = updates.available && (
    <button className="update-pill" onClick={() => setUpdateOpen(true)} title={`Tributary ${updates.available.version} is available`}>
      <DownloadIcon size={13} />
      Update
    </button>
  );

  const withProfilePictures = (children: React.ReactNode) => (
    <ProfilePictures.Provider value={profilePictures}>{children}</ProfilePictures.Provider>
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
            commands={[...fileCommands, settingsCommand, ...helpCommands].map((c) => ({ id: c.id, label: c.label, icon: c.icon, shortcut: c.keys && shortcutLabel(c.keys), run: c.run }))}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
        {settingsDialog}
        {updateDialog}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
        {dropOverlay}
        {toast && <Toast toast={toast} onDone={hideToast} />}
      </div>,
    );
  }

  const branchLabel = snapshot.headBranch ?? "HEAD";
  const canChange = !snapshot.bare && running === null;

  /** The commits after `commit` on the checked-out branch (newest first), or why they can't be rewritten. */
  const rewritable = (commit: CommitRow): CommitRow[] | string => {
    if (!snapshot.headBranch) return "check out a branch first";
    if (commit.id === snapshot.headCommit) return `${branchLabel} has nothing after this commit`;
    if (!headHistory.has(commit.id)) return `not part of ${branchLabel}`;
    const before = ancestors(commit.id, byId);
    const after = snapshot.commits.filter((c) => headHistory.has(c.id) && !before.has(c.id));
    if (after.some((c) => c.parents.length > 1)) return "the commits after it include merges";
    return after;
  };

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
    rewritable,
    openUrl: openInBrowser,
  };
  const commitById = (id: string) => byId.get(id);
  const conflictedPaths = (snapshot.worktree?.unstaged ?? []).filter((file) => file.status === "conflicted").map((file) => file.path);
  const conflicts = conflictedPaths.length;

  /** Lock, unlock or force-unlock a file. */
  const lockItems = (path: string, lock: Lock | undefined, separated: boolean): MenuItem[] => {
    if (!lock) {
      return [{ label: "Lock file", icon: <LockIcon />, separated, disabled: !canChange, onSelect: () => act({ kind: "lockFiles", paths: [path] }) }];
    }
    if (lock.mine) {
      return [
        { label: "Unlock file", icon: <UnlockIcon />, separated, disabled: !canChange, onSelect: () => act({ kind: "unlockFiles", locks: [{ id: lock.id, path: lock.path }] }) },
      ];
    }
    return [
      { label: `Locked by ${lock.owner || "someone else"}`, icon: <LockIcon />, separated, disabled: true, onSelect: () => {} },
      { label: "Force unlock…", icon: <UnlockIcon />, danger: true, disabled: !canChange, onSelect: () => setDialog({ kind: "forceUnlock", lock }) },
    ];
  };
  const revealFile = (path: string) =>
    revealItemInDir(joinPath(snapshot.path, path)).catch(() => setToast({ text: `${baseName(path)} isn't in the working tree` }));

  /** Right-click on a file in a commit or in the uncommitted changes. */
  const fileMenu = (file: FileChange, x: number, y: number, where: "worktree" | "commit") => {
    const folder = file.path.endsWith("/");
    const path = file.path.replace(/\/+$/, "");
    const dir = folderOf(path);
    const items: MenuItem[] = [];
    if (where === "worktree" && file.status === "conflicted") {
      const sides = conflictSides(snapshot);
      items.push(
        { label: `Keep mine (${sides.mine})`, icon: <CheckIcon />, disabled: !canChange, onSelect: () => act({ kind: "resolveConflicts", paths: [path], keep: "mine" }) },
        { label: `Take theirs (${sides.theirs})`, icon: <MergeIcon />, disabled: !canChange, onSelect: () => act({ kind: "resolveConflicts", paths: [path], keep: "theirs" }) },
      );
    }
    items.push({
      label: folder ? "Show this folder's history" : "Show this file's history",
      icon: <FileHistoryIcon />,
      separated: items.length > 0,
      onSelect: () => showHistory(folder ? `${path}/` : path),
    });
    if (dir) items.push({ label: `Show the history of ${dir}/`, icon: <FolderIcon />, onSelect: () => showHistory(`${dir}/`) });
    if (lfs.locks && !folder) items.push(...lockItems(path, lfs.byPath.get(path), true));
    if (where === "worktree" && file.status !== "conflicted") {
      const paths = file.oldPath ? [file.oldPath, path] : [path];
      const big = checks?.large.some((large) => large.path === file.path);
      if (big) {
        const pattern = lfsPattern(file.path);
        const staged = snapshot.worktree?.staged.some((staged) => staged.path === file.path);
        items.push({
          label: `Track ${pattern} with Git LFS`,
          icon: <CloudIcon />,
          separated: true,
          disabled: !canChange,
          onSelect: () => act({ kind: "trackWithLfs", patterns: [pattern], paths: staged ? [file.path] : [] }),
        });
      }
      if (file.status === "untracked") {
        const name = baseName(path);
        const pattern = lfsPattern(path);
        items.push({
          label: folder ? `Ignore the folder ${name}/` : `Ignore ${name}`,
          icon: <IgnoreIcon />,
          separated: !big,
          disabled: !canChange,
          onSelect: () => act({ kind: "ignorePaths", patterns: [folder ? `/${path}/` : `/${path}`] }),
        });
        if (!folder && pattern !== path) {
          items.push({ label: `Ignore all ${pattern} files`, icon: <IgnoreIcon />, disabled: !canChange, onSelect: () => act({ kind: "ignorePaths", patterns: [pattern] }) });
        }
        if (dir) {
          items.push({ label: `Ignore the folder ${dir}/`, icon: <IgnoreIcon />, disabled: !canChange, onSelect: () => act({ kind: "ignorePaths", patterns: [`/${dir}/`] }) });
        }
      }
      items.push(
        {
          label: "Stash this file…",
          icon: <StashIcon />,
          separated: true,
          disabled: !canChange,
          onSelect: () => setDialog({ kind: "stash", paths }),
        },
        {
          label: folder ? "Delete this folder" : file.status === "untracked" ? "Delete this file" : "Discard changes",
          icon: <TrashIcon />,
          danger: true,
          disabled: !canChange,
          onSelect: () => act({ kind: "discardFiles", paths }),
        },
      );
    }
    items.push({ label: "Copy path", icon: <CopyIcon />, separated: true, onSelect: () => copyText(path) });
    if (where === "worktree" && file.status !== "deleted") {
      items.push({ label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: () => revealFile(path) });
    }
    showMenu(x, y, items);
  };
  /** A locked file in the sidebar. */
  const lockMenu = (lock: Lock, x: number, y: number) =>
    showMenu(x, y, [
      { label: "Show this file's history", icon: <FileHistoryIcon />, onSelect: () => showHistory(lock.path) },
      ...lockItems(lock.path, lock, true),
      { label: "Copy path", icon: <CopyIcon />, separated: true, onSelect: () => copyText(lock.path) },
      { label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: () => revealFile(lock.path) },
    ]);

  const pushMenu = (anchor: HTMLElement) =>
    menuUnder(anchor, [
      { label: "Push", icon: <PushIcon />, onSelect: () => act({ kind: "push", force: false }, "push") },
      {
        label: "Force push…",
        icon: <PushIcon />,
        danger: true,
        separated: true,
        onSelect: () => setDialog({ kind: "forcePush" }),
      },
    ]);

  const viewMenu = (anchor: HTMLElement) => {
    const view = menus.find((m) => m.label === "View")!;
    menuUnder(anchor, menuItems(view.entries.filter((entry) => entry === "-" || !["search", "palette"].includes(entry.id))), 320);
  };

  const headerMenu = (x: number, y: number) => {
    const toggle = (key: "author" | "date" | "sha") => setColumnOptions({ ...columnOptions, [key]: !columnOptions[key] });
    showMenu(x, y, [
      { label: "Author", icon: <ColumnsIcon />, checked: columnOptions.author, onSelect: () => toggle("author") },
      { label: "Date", icon: <ColumnsIcon />, checked: columnOptions.date, onSelect: () => toggle("date") },
      { label: "SHA", icon: <ColumnsIcon />, checked: columnOptions.sha, onSelect: () => toggle("sha") },
      {
        label: "Relative dates (“3 hours ago”)",
        separated: true,
        checked: columnOptions.dateFormat === "relative",
        disabled: !columnOptions.date,
        onSelect: () => setColumnOptions({ ...columnOptions, dateFormat: "relative" }),
      },
      {
        label: "Exact dates and times",
        checked: columnOptions.dateFormat === "exact",
        disabled: !columnOptions.date,
        onSelect: () => setColumnOptions({ ...columnOptions, dateFormat: "exact" }),
      },
      {
        label: "When it was written (author date)",
        separated: true,
        checked: columnOptions.dateKind === "authored",
        disabled: !columnOptions.date,
        onSelect: () => setColumnOptions({ ...columnOptions, dateKind: "authored" }),
      },
      {
        label: "When it was committed (commit date)",
        checked: columnOptions.dateKind === "committed",
        disabled: !columnOptions.date,
        onSelect: () => setColumnOptions({ ...columnOptions, dateKind: "committed" }),
      },
      { label: "Day separators", separated: true, checked: daySeparators, onSelect: () => setDaySeparators(!daySeparators) },
    ]);
  };

  const remoteActions: Record<RemoteAction, Action> = {
    fetch: { kind: "fetch" },
    pull: { kind: "pull" },
    push: { kind: "push", force: false },
  };

  const detailsActions = (commit: CommitRow): DetailsAction[] => {
    if (commit.kind === "stash") {
      const index = stashIndexOf(commit);
      if (index === null || !canChange) return [];
      return [
        { label: "Apply", icon: <StashIcon size={14} />, onClick: () => act({ kind: "stashApply", index, id: commit.id }) },
        { label: "Pop", icon: <StashIcon size={14} />, onClick: () => act({ kind: "stashPop", index, id: commit.id }) },
        {
          label: "Drop…",
          icon: <TrashIcon size={14} />,
          danger: true,
          onClick: () => setDialog({ kind: "dropStash", index, id: commit.id, label: `stash@{${index}}` }),
        },
      ];
    }
    return canChange && canResetTo(snapshot, commit)
      ? [
          {
            label: `Hard reset ${branchLabel} to this commit…`,
            icon: <ResetIcon size={14} />,
            danger: true,
            onClick: () => setDialog({ kind: "reset", target: commit }),
          },
        ]
      : [];
  };

  // Everything the command palette can do: the menu bar's commands, plus one for each branch and tab.
  const commands = (): Command[] => {
    const list: Command[] = [];
    const seen = new Set<string>();
    const add = (command: Command, enabled = true) => {
      if (!enabled || seen.has(command.id)) return;
      seen.add(command.id);
      list.push(command);
    };
    for (const m of menus) {
      for (const entry of m.entries) {
        if (entry === "-" || entry.enabled === false) continue;
        const label = entry.checked === undefined ? entry.label : `${entry.checked ? "Turn off" : "Turn on"}: ${entry.label}`;
        add({ id: entry.id, label, icon: entry.icon, group: m.label === "Repository" ? "Repository" : m.label === "View" ? "View" : undefined, shortcut: entry.keys && shortcutLabel(entry.keys), run: entry.run });
      }
    }
    for (const tab of tabs) {
      if (tab.path !== snapshot.path) add({ id: `tab:${tab.path}`, label: `Switch to ${tab.name}`, group: "Tab", run: () => switchTab(tab.path) });
    }
    if (snapshot.worktree && canChange) {
      add({ id: "stage-all", label: "Stage all changes", group: "Changes", run: () => act({ kind: "stageAll" }, "other", { quiet: true }) });
      add({ id: "unstage-all", label: "Unstage all changes", group: "Changes", run: () => act({ kind: "unstageAll" }, "other", { quiet: true }) });
    }
    if (snapshot.operation && snapshot.operation.kind !== "other" && canChange) {
      add({ id: "continue", label: `Continue the ${snapshot.operation.kind}`, group: "In progress", run: () => act({ kind: "continueOperation" }) });
      add({ id: "abort", label: `Abort the ${snapshot.operation.kind}`, group: "In progress", run: () => act({ kind: "abortOperation" }) });
    }
    for (const commit of snapshot.commits) {
      for (const ref of commit.refs) {
        if (ref.kind === "branch" && !ref.current && canChange) {
          add({ id: `checkout:${ref.name}`, label: `Check out ${ref.name}`, icon: <BranchIcon />, group: "Branch", run: () => act({ kind: "checkoutBranch", name: ref.name }) });
        }
        if (ref.kind === "remote" && canChange) {
          const { branch } = splitRemoteBranch(ref.name, snapshot.remotes);
          if (!localBranches.has(branch)) {
            add({ id: `track:${ref.name}`, label: `Check out ${branch} (tracking ${ref.name})`, icon: <CloudIcon />, group: "Branch", run: () => act({ kind: "checkoutRemoteBranch", name: ref.name }) });
          }
        }
        if ((ref.kind === "branch" || ref.kind === "remote" || ref.kind === "tag") && !ref.current) {
          if (canChange && snapshot.headBranch && !snapshot.operation) {
            add({ id: `merge:${ref.name}`, label: `Merge ${ref.name} into ${branchLabel}`, icon: <MergeIcon />, group: "Branch", run: () => act({ kind: "merge", target: ref.name }) });
            add({ id: `rebase:${ref.name}`, label: `Rebase ${branchLabel} onto ${ref.name}`, icon: <RebaseIcon />, group: "Branch", run: () => act({ kind: "rebase", onto: ref.name }) });
          }
          add({ id: `focus:${ref.name}`, label: `Highlight ${ref.name}'s history`, icon: <EyeIcon />, group: "View", run: () => setFocus({ kind: "history", name: ref.name, commitId: commit.id }) });
          const name = fullRefName(ref);
          if (name) add({ id: `hide:${name}`, label: `Hide ${ref.name}`, icon: <EyeOffIcon />, group: "View", run: () => setHidden([name], true) });
        }
      }
    }
    for (const ref of snapshot.hiddenRefs) {
      const name = fullRefName(ref);
      if (name) add({ id: `show:${name}`, label: `Show ${ref.name}`, icon: <EyeIcon />, group: "View", run: () => setHidden([name], false) });
    }
    add({ id: "settings", label: "Settings…", icon: <GearIcon />, shortcut: shortcutLabel("CmdOrCtrl+,"), run: () => setSettingsOpen(true) });
    if (focus) add({ id: "unfocus", label: "Stop highlighting", icon: <EyeIcon />, group: "View", run: () => setFocus(null) });
    add({ id: "activity", label: activityOpen ? "Hide activity" : "Show activity", icon: <ActivityIcon />, group: "View", run: () => setActivityOpen(!activityOpen) });
    add({ id: "mine", label: "Highlight my commits", icon: <UserIcon />, group: "View", run: highlightMine }, Boolean(user));
    add({ id: "sidebar", label: sidebarOpen ? "Hide branches sidebar" : "Show branches sidebar", icon: <SidebarIcon />, group: "View", run: () => setSidebarOpen(!sidebarOpen) });
    add({ id: "dense", label: dense ? "Normal rows" : "Compact rows", icon: <ViewIcon />, group: "View", run: () => setDense(!dense) });
    return list;
  };

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
      />
      <Toolbar
        snapshot={snapshot}
        refreshing={busy !== null}
        running={running === "other" ? null : running}
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
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {(focus || snapshot.firstParent || soloing) && (
        <div className="view-banner" role="status">
          {focus?.kind === "path" ? <FileHistoryIcon size={14} /> : <EyeIcon size={14} />}
          {focus?.kind === "path" ? (
            <span>
              Highlighting the {plural(focus.ids.length, "commit")}
              {focus.truncated ? "+" : ""} that changed{" "}
              <strong title={focus.path}>
                {baseName(focus.path)}
                {focus.folder ? "/" : ""}
              </strong>
              {focus.ids.length > pathMatches.length && ` (${(focus.ids.length - pathMatches.length).toLocaleString()} not loaded)`}.
            </span>
          ) : focus?.kind === "history" ? (
            <span>
              Highlighting <strong>{focus.name}</strong>'s history.
            </span>
          ) : focus?.kind === "author" ? (
            <span>
              Highlighting <strong>{highlightingMine ? "your" : `${focus.name || focus.email}'s`}</strong> commits ({focusedCount}{" "}
              loaded).
            </span>
          ) : snapshot.firstParent ? (
            <span>
              Showing only <strong>{branchLabel}</strong>'s own history.
            </span>
          ) : (
            <span>
              Showing only{" "}
              <strong>
                {visibility.solo
                  .map((name) => name.replace(/^refs\/(heads|remotes|tags)\//, ""))
                  .slice(0, 4)
                  .join(", ")}
                {visibility.solo.length > 4 ? ` and ${visibility.solo.length - 4} more` : ""}
              </strong>{" "}
              (and {branchLabel}).
            </span>
          )}
          {focus?.kind === "path" && pathMatches.length > 0 && (
            <span className="banner-steps">
              <button className="icon-button" onClick={() => stepHistory(-1)} title="Newer change" aria-label="Newer change">
                <ChevronUpIcon size={13} />
              </button>
              <span className="banner-step-count">
                {selectedIndex !== undefined && pathMatches.includes(selectedIndex)
                  ? `${pathMatches.indexOf(selectedIndex) + 1} of ${pathMatches.length}`
                  : plural(pathMatches.length, "change")}
              </span>
              <button className="icon-button" onClick={() => stepHistory(1)} title="Older change" aria-label="Older change">
                <ChevronDownIcon size={13} />
              </button>
            </span>
          )}
          <button
            className="link-button"
            onClick={() => (focus ? setFocus(null) : snapshot.firstParent ? setFirstParentOnly(false) : showAllBranches())}
          >
            {focus ? "Show everything (Esc)" : "Show all branches"}
          </button>
        </div>
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
          onClear={() => setActivityCleared(activity[activity.length - 1]?.id ?? 0)}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {paletteOpen && <CommandPalette commands={commands()} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {settingsDialog}
      {updateDialog}
      {cloneDialog}
      {dialog?.kind === "reset" && (
        <ResetDialog
          snapshot={snapshot}
          target={dialog.target}
          protectedName={dialog.target.id === snapshot.headCommit ? null : protectedHead}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            const before = snapshot.headCommit;
            if (dialog.target.id !== before) select(dialog.target.id);
            finishDialog(message, before && dialog.target.id !== before ? { kind: "resetHard", id: before } : undefined);
          }}
        />
      )}
      {dialog?.kind === "newBranch" && (
        <NewBranchDialog
          repoPath={snapshot.path}
          target={dialog.target}
          canCheckout={!snapshot.bare}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        />
      )}
      {dialog?.kind === "tag" && (
        <TagDialog
          repoPath={snapshot.path}
          target={dialog.target}
          remote={snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? null)}
          onCancel={() => setDialog(null)}
          onDone={(message, name) => finishDialog(message, { kind: "deleteTag", name })}
        />
      )}
      {dialog?.kind === "interactiveRebase" && (
        <InteractiveRebaseDialog
          branch={branchLabel}
          onto={dialog.onto}
          commits={dialog.commits}
          loadDetails={loadDetails}
          onCancel={() => setDialog(null)}
          onStart={(steps) => {
            setDialog(null);
            act({ kind: "interactiveRebase", onto: dialog.onto.id, steps });
          }}
        />
      )}
      {dialog?.kind === "prune" && (
        <PruneDialog
          repoPath={snapshot.path}
          fetchFirst={snapshot.remotes.length > 0}
          pinned={pins}
          protectedNames={protectedBranches}
          onCancel={() => setDialog(null)}
          onDelete={(branches) => {
            setDialog(null);
            act({ kind: "deleteBranches", branches });
          }}
        />
      )}
      {dialog?.kind === "restore" && (
        <RestoreDialog
          repoPath={snapshot.path}
          onCancel={() => setDialog(null)}
          onRestore={(backup) => {
            setDialog(null);
            act({ kind: "restoreBackup", reference: backup.reference }, "other", { quiet: false });
          }}
        />
      )}
      {dialog?.kind === "protectedAction" && (
        <ProtectedActionDialog
          branch={dialog.branch}
          title={`Rewrite ${dialog.branch}?`}
          explanation={`${dialog.action.kind === "interactiveRebase" ? "This interactive rebase" : "Rebasing"} rewrites ${dialog.branch}'s history: its commits get new ids, so anyone who already has them will have to reconcile. Tributary keeps a backup of where it was.`}
          confirmLabel={dialog.action.kind === "interactiveRebase" ? "Start rebase" : `Rebase ${dialog.branch}`}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            act(dialog.action, "other", { confirmed: true });
          }}
        />
      )}
      {dialog?.kind === "forcePush" && (
        <ForcePushDialog
          snapshot={snapshot}
          protectedName={protectedHead}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        />
      )}
      {dialog?.kind === "stash" && snapshot.worktree && (
        <StashDialog
          repoPath={snapshot.path}
          status={snapshot.worktree}
          paths={dialog.paths}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameBranchDialog
          repoPath={snapshot.path}
          branch={dialog.branch}
          onCancel={() => setDialog(null)}
          onDone={(message, newName) =>
            finishDialog(message, { kind: "renameBranch", name: newName, newName: dialog.branch })
          }
        />
      )}
      {dialog?.kind === "deleteBranch" && (
        <DeleteBranchDialog
          repoPath={snapshot.path}
          branch={dialog.branch}
          retryFor={deleteAnyway(dialog.branch)}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            // Undo puts it back as it was, tracking the same remote branch.
            const label = byId.get(dialog.commitId)?.refs.find((ref) => ref.kind === "branch" && ref.name === dialog.branch);
            const upstream = label?.upstream ? splitRemoteBranch(label.upstream, snapshot.remotes) : null;
            finishDialog(message, {
              kind: "restoreBranches",
              branches: [
                {
                  name: dialog.branch,
                  id: dialog.commitId,
                  remote: upstream?.remote ?? null,
                  merge: upstream ? `refs/heads/${upstream.branch}` : null,
                },
              ],
            });
          }}
        />
      )}
      {dialog?.kind === "deleteRemoteBranch" && (
        <DeleteRemoteBranchDialog
          repoPath={snapshot.path}
          name={dialog.name}
          remote={splitRemoteBranch(dialog.name, snapshot.remotes).remote}
          branch={splitRemoteBranch(dialog.name, snapshot.remotes).branch}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            const commit = snapshot.commits.find((c) => c.refs.some((ref) => ref.kind === "remote" && ref.name === dialog.name));
            finishDialog(message, commit ? { kind: "restoreRemoteBranch", name: dialog.name, id: commit.id } : undefined);
          }}
        />
      )}
      {dialog?.kind === "deleteTag" && (
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Delete tag ${dialog.name}?`}
          confirmLabel="Delete tag"
          busyLabel="Deleting…"
          danger
          action={{ kind: "deleteTag", name: dialog.name }}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message, { kind: "restoreTag", name: dialog.name, id: dialog.restoreId })}
        >
          <p>The tag is removed from this repository. Copies of it on remotes are kept.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "deleteRemoteTag" && (
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Delete ${dialog.name} from ${dialog.remote}?`}
          confirmLabel="Delete from remote"
          busyLabel="Deleting…"
          danger
          action={{ kind: "deleteRemoteTag", name: dialog.name, remote: dialog.remote }}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        >
          <p>
            The tag will be removed from <strong>{dialog.remote}</strong>, for everyone who uses it. The tag in this
            repository is kept.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "forceUnlock" && (
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Unlock ${baseName(dialog.lock.path)}?`}
          confirmLabel="Force unlock"
          busyLabel="Unlocking…"
          danger
          action={{ kind: "unlockFiles", locks: [{ id: dialog.lock.id, path: dialog.lock.path }], force: true }}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            finishDialog(message);
            lfs.refresh(true);
          }}
        >
          <p>
            <strong>{dialog.lock.owner || "Someone else"}</strong> locked <strong>{dialog.lock.path}</strong>. If they're still
            working on it, their changes and yours will clash, and one of you will lose work. Check with them first.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "pruneLfs" && (
        <PruneLfsDialog repoPath={snapshot.path} onCancel={() => setDialog(null)} onDone={(message) => finishDialog(message)} />
      )}
      {dialog?.kind === "dropStash" && (
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Drop ${dialog.label}?`}
          confirmLabel="Drop stash"
          busyLabel="Dropping…"
          danger
          action={{ kind: "stashDrop", index: dialog.index, id: dialog.id }}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        >
          <p>The changes saved in this stash will be gone.</p>
        </ConfirmDialog>
      )}
      {dropOverlay}
      {toast && <Toast toast={toast} onDone={hideToast} />}
    </div>,
  );
}
