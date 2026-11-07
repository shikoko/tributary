import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  activityLog,
  cancelAction,
  commitDetails,
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
  type LogEntry,
  type Progress,
  type RepoSnapshot,
  type Visibility,
} from "./api";
import { involvesUntrackedFiles, isLocalChangesError } from "./lib/errors";
import { ancestors, countMissing } from "./lib/graph";
import { setNativeMenu, type NativeMenu } from "./lib/nativeMenu";
import { loadPlace, savePlace } from "./lib/place";
import { isMac, modKey } from "./lib/platform";
import { forgetRepo, loadRecent, noteBranch, pinRepo, rememberRepo } from "./lib/recent";
import { stashIndexOf, type RefEntry } from "./lib/refs";
import { NO_VISIBILITY, readVisibility, useRepoSetting } from "./lib/repoPrefs";
import { findMatches } from "./lib/search";
import { readSetting, useStoredState } from "./lib/settings";
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
  BranchIcon,
  CloneIcon,
  CloseIcon,
  CloudIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FetchIcon,
  FolderIcon,
  KeyboardIcon,
  MergeIcon,
  NewRepoIcon,
  PlusIcon,
  PullIcon,
  PullRequestIcon,
  PushIcon,
  RebaseIcon,
  RefreshIcon,
  ResetIcon,
  SearchIcon,
  SidebarIcon,
  StashIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  ViewIcon,
} from "./components/Icons";
import { InteractiveRebaseDialog } from "./components/InteractiveRebaseDialog";
import { MenuBar, type AppMenu } from "./components/MenuBar";
import { MultiSelectPanel } from "./components/MultiSelectPanel";
import { NewBranchDialog } from "./components/NewBranchDialog";
import { OperationBar } from "./components/OperationBar";
import { ProgressStrip } from "./components/ProgressStrip";
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
import { EMPTY_DRAFT, WorktreeDetailsPanel, type CommitDraft } from "./components/WorktreeDetails";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;
type Running = RemoteAction | "other" | null;
/** What's highlighted: a branch's (or commit's) history, or an author's commits. */
type Focus = { kind: "history"; name: string; commitId: string } | { kind: "author"; name: string; email: string };

/** Don't refresh on window focus more often than this, in milliseconds. */
const FOCUS_REFRESH_INTERVAL = 2000;
/** How often to fetch in the background. */
const AUTO_FETCH_INTERVAL = 5 * 60 * 1000;
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
  // Remembered for each repository.
  const [visibility, setVisibility] = useRepoSetting<Visibility>("visibility", snapshot?.path ?? null, NO_VISIBILITY);
  const [pins, setPins] = useRepoSetting<string[]>("pins", snapshot?.path ?? null, []);

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
    async (action: Action, kind: Running = "other", options: { quiet?: boolean } = {}): Promise<boolean> => {
      if (!snapshot) return false;
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
      let failure: string | null = null;
      try {
        ({ message, pullRequest } = await runActionFor(before.path, action));
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
      if (pullRequest) {
        const url = pullRequest;
        setToast({ text: message ?? "Pushed", action: { label: "Create pull request", onClick: () => openInBrowser(url) } });
      } else if (!options.quiet && message) {
        const undo = undoFor(action, before);
        setToast({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo) } : undefined });
      }
      return true;
    },
    // undoFor only reads its arguments.
    [snapshot, load],
  );

  /** A dialog finished its action: reload and show what happened, with an optional undo. */
  const finishDialog = useCallback(
    (message: string, undo?: Action) => {
      setDialog(null);
      setToast({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo) } : undefined });
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
  const latest = useRef({ snapshot, dialog, running, refresh, autoFetch, tabs, focus, selection });
  latest.current = { snapshot, dialog, running, refresh, autoFetch, tabs, focus, selection };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      const { tabs, snapshot, focus, selection } = latest.current;
      if (mod && key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (mod && (key === "o" || key === "t") && !event.shiftKey) {
        event.preventDefault();
        pick();
      } else if (mod && key === "w") {
        event.preventDefault();
        if (snapshot) closeTab(snapshot.path);
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
  }, [pick, refresh, zoomBy, setSidebarOpen, setActivityOpen, closeTab, switchTab]);

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
  useEffect(() => {
    if (!repoPath || !canFetch || !autoFetch) return;
    let stopped = false;
    const fetchNow = async () => {
      const { snapshot, dialog, running } = latest.current;
      if (stopped || !snapshot || snapshot.path !== repoPath || dialog || running || document.hidden) return;
      try {
        await runAction(repoPath, { kind: "fetch", background: true });
        if (stopped) return;
        if (!latest.current.dialog && !latest.current.running) latest.current.refresh();
      } catch {
        // Usually missing credentials or no network. Fetching by hand shows the reason;
        // don't try again in the background until then.
        stopped = true;
      }
    };
    const first = setTimeout(fetchNow, FIRST_AUTO_FETCH_DELAY);
    const timer = setInterval(fetchNow, AUTO_FETCH_INTERVAL);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [repoPath, canFetch, autoFetch]);

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

  const newTabMenu = (anchor: HTMLElement) => {
    const others = recent.filter((repo) => !tabs.some((tab) => tab.path === repo.path)).slice(0, 8);
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        ...others.map((repo) => ({
          label: repo.name,
          // The end of the path tells repositories with the same name apart.
          shortcut: repo.path.length > 36 ? `…${repo.path.slice(-35)}` : repo.path,
          onSelect: () => {
            rememberPlace();
            load(repo.path, "open");
          },
        })),
        { label: "Open repository…", icon: <FolderIcon />, shortcut: `${modKey}T`, separated: others.length > 0, onSelect: pick },
        { label: "Clone repository…", icon: <CloneIcon />, onSelect: () => setDialog({ kind: "clone" }) },
        { label: "New repository…", icon: <NewRepoIcon />, onSelect: createRepository },
      ],
    });
  };

  // Commands that work with or without an open repository.
  const fileCommands: AppCommand[] = [
    { id: "open", label: "Open Repository…", icon: <FolderIcon />, keys: "CmdOrCtrl+O", run: pick },
    { id: "clone", label: "Clone Repository…", icon: <CloneIcon />, run: () => setDialog({ kind: "clone" }) },
    { id: "init", label: "New Repository…", icon: <NewRepoIcon />, run: createRepository },
  ];
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
    { id: "auto-fetch", label: "Fetch Every 5 Minutes", checked: autoFetch, run: () => setAutoFetch(!autoFetch) },
    { id: "reopen", label: "Reopen Tabs on Launch", checked: reopenTabs, run: () => setReopenTabs(!reopenTabs) },
  ];

  /** The menu bar: on macOS the system's own, elsewhere one in the tab bar. */
  const appMenus = (): { label: string; entries: MenuEntry[] }[] => {
    if (!snapshot) {
      return [
        { label: "File", entries: fileCommands },
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
          { id: "new-tab", label: "New Tab…", keys: "CmdOrCtrl+T", icon: <PlusIcon />, run: pick },
          ...fileCommands,
          "-",
          { id: "close-tab", label: "Close Tab", keys: "CmdOrCtrl+W", icon: <CloseIcon />, run: () => closeTab(snapshot.path) },
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
  const nativeMenus: NativeMenu[] = [
    { label: "Tributary", items: [{ system: "About" }, { system: "Separator" }, { system: "Services" }, { system: "Separator" }, { system: "Hide" }, { system: "HideOthers" }, { system: "ShowAll" }, { system: "Separator" }, { system: "Quit" }] },
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
          <TabBar tabs={tabs} activePath={null} onSelect={(path) => load(path, "open")} onClose={closeTab} onNew={newTabMenu} menuBar={menuBar} />
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
            commands={[...fileCommands, ...helpCommands].map((c) => ({ id: c.id, label: c.label, icon: c.icon, shortcut: c.keys && shortcutLabel(c.keys), run: c.run }))}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
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
    rewritable,
    openUrl: openInBrowser,
  };
  const commitById = (id: string) => byId.get(id);
  const conflicts = (snapshot.worktree?.unstaged ?? []).filter((file) => file.status === "conflicted").length;

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
      <TabBar tabs={tabs} activePath={snapshot.path} onSelect={switchTab} onClose={closeTab} onNew={newTabMenu} menuBar={menuBar} />
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
          <EyeIcon size={14} />
          {focus?.kind === "history" ? (
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
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {paletteOpen && <CommandPalette commands={commands()} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {cloneDialog}
      {dialog?.kind === "reset" && (
        <ResetDialog
          snapshot={snapshot}
          target={dialog.target}
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
      {dialog?.kind === "forcePush" && (
        <ForcePushDialog snapshot={snapshot} onCancel={() => setDialog(null)} onDone={(message) => finishDialog(message)} />
      )}
      {dialog?.kind === "stash" && snapshot.worktree && (
        <StashDialog
          repoPath={snapshot.path}
          status={snapshot.worktree}
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
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Delete ${dialog.branch}?`}
          confirmLabel="Delete branch"
          busyLabel="Deleting…"
          danger
          action={{ kind: "deleteBranch", name: dialog.branch, force: false }}
          retryFor={deleteAnyway(dialog.branch)}
          onCancel={() => setDialog(null)}
          onDone={(message) =>
            finishDialog(message, { kind: "createBranch", name: dialog.branch, id: dialog.commitId, checkout: false })
          }
        >
          <p>
            The branch label goes away. If its commits aren't on any other branch, git will ask you to confirm
            again.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "deleteRemoteBranch" && (
        <ConfirmDialog
          repoPath={snapshot.path}
          title={`Delete ${splitRemoteBranch(dialog.name, snapshot.remotes).branch} from ${splitRemoteBranch(dialog.name, snapshot.remotes).remote}?`}
          confirmLabel="Delete from remote"
          busyLabel="Deleting…"
          danger
          action={{ kind: "deleteRemoteBranch", name: dialog.name }}
          onCancel={() => setDialog(null)}
          onDone={(message) => finishDialog(message)}
        >
          <p>
            <strong>{dialog.name}</strong> will be removed from the remote, for everyone who uses it. Local branches
            are kept.
          </p>
        </ConfirmDialog>
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
