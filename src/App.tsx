import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  openRepository,
  PAGE_SIZE,
  runAction,
  type Action,
  type CommitDetails,
  type CommitRow,
  type RepoSnapshot,
} from "./api";
import { involvesUntrackedFiles, isLocalChangesError } from "./lib/errors";
import { ancestors, countMissing } from "./lib/graph";
import { modKey } from "./lib/platform";
import { forgetRepo, loadRecent, rememberRepo } from "./lib/recent";
import { stashIndexOf } from "./lib/refs";
import { findMatches } from "./lib/search";
import { readSetting, useStoredState } from "./lib/settings";
import {
  canResetTo,
  checkoutFor,
  commitMenu,
  deleteAnyway,
  pillForEntry,
  pillMenu,
  splitRemoteBranch,
  type MenuContext,
  type OpenDialog,
} from "./menus";
import { CommitDetailsPanel, type DetailsAction } from "./components/CommitDetails";
import { CommitList, type ColumnWidths } from "./components/CommitList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { ForcePushDialog } from "./components/ForcePushDialog";
import { CloseIcon, FolderIcon, PushIcon, ResetIcon, StashIcon, TrashIcon } from "./components/Icons";
import { NewBranchDialog } from "./components/NewBranchDialog";
import { RenameBranchDialog } from "./components/RenameBranchDialog";
import { ResetDialog } from "./components/ResetDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { Sidebar } from "./components/Sidebar";
import { StashDialog } from "./components/StashDialog";
import { Toast, type ToastMessage } from "./components/Toast";
import { Toolbar, type RemoteAction } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { EMPTY_DRAFT, WorktreeDetailsPanel, type CommitDraft } from "./components/WorktreeDetails";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;
type Running = RemoteAction | "other" | null;

/** Don't refresh on window focus more often than this, in milliseconds. */
const FOCUS_REFRESH_INTERVAL = 2000;
/** How often to fetch in the background. */
const AUTO_FETCH_INTERVAL = 5 * 60 * 1000;
/** The first background fetch after opening a repository. */
const FIRST_AUTO_FETCH_DELAY = 5000;
const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** Actions that can be retried after stashing when uncommitted changes are in the way. */
const RETRYABLE = new Set<Action["kind"]>(["pull", "checkoutBranch", "checkoutRemoteBranch", "checkoutCommit", "createBranch"]);

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

export default function App() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ message: string; retry?: Action } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [running, setRunning] = useState<Running>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<CommitDraft>(EMPTY_DRAFT);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  // Remembered between launches.
  const [sidebarOpen, setSidebarOpen] = useStoredState("sidebar.open", true);
  const [sidebarWidth, setSidebarWidth] = useStoredState("sidebar.width", 220);
  const [detailsWidth, setDetailsWidth] = useStoredState("details.width", 380);
  const [columnWidths, setColumnWidths] = useStoredState<ColumnWidths>("columns", { refs: null, graph: null });
  const [dense, setDense] = useStoredState("rows.compact", false);
  const [zoom, setZoom] = useStoredState("zoom", 1);
  const [autoFetch, setAutoFetch] = useStoredState("fetch.auto", true);
  const [reopenLast, setReopenLast] = useStoredState("reopenLast", true);

  const searchInput = useRef<HTMLInputElement>(null);
  const detailsCache = useRef(new Map<string, CommitDetails>());
  /** Increases with every load, so answers to older loads can be ignored. */
  const loadCount = useRef(0);
  const lastLoad = useRef(0);
  /** True while something is loading or the folder picker is open; focus refreshes wait. */
  const blockFocusRefresh = useRef(false);
  /** Sizes when a panel resize started. */
  const resizeStart = useRef({ sidebar: 0, details: 0 });

  const load = useCallback(async (path: string, mode: "open" | "refresh" | "more", limit = PAGE_SIZE) => {
    const request = ++loadCount.current;
    blockFocusRefresh.current = true;
    setBusy(mode === "open" ? { kind: "open", path } : { kind: mode });
    setError(null);
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
    };

    try {
      if (mode === "open") {
        // When opening, show the graph first: reading uncommitted changes can take a
        // while in big working trees, so they follow in a second load.
        const next = await openRepository(path, limit, false);
        if (!current()) return;
        detailsCache.current = new Map();
        setQuery("");
        setDraft(EMPTY_DRAFT);
        setLastFetch(null);
        show(next);
        setRecent(rememberRepo(next.path, next.name));
        setWindowTitle(`${next.name} — Tributary`);
        setBusy(null);
        const full = await openRepository(path, limit, true).catch(() => null);
        if (current() && full?.worktree) setSnapshot(full);
      } else {
        // The graph is already on screen, so load everything at once to avoid flicker.
        const next = await openRepository(path, limit, true);
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
  }, []);

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

  const refresh = useCallback(() => {
    if (snapshot) load(snapshot.path, "refresh", reloadLimit);
  }, [snapshot, load, reloadLimit]);

  const close = useCallback(() => {
    loadCount.current++;
    setSnapshot(null);
    setSelectedId(null);
    setError(null);
    setBusy(null);
    setQuery("");
    blockFocusRefresh.current = false;
    setWindowTitle("Tributary");
  }, []);

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
        return before.headCommit ? { kind: "resetHard", id: before.headCommit } : null;
      case "commit":
        return before.headCommit ? { kind: "resetSoft", id: before.headCommit } : null;
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
      let message: string | null = null;
      let failure: string | null = null;
      try {
        message = await runAction(before.path, action);
      } catch (e) {
        failure = String(e);
      }
      setRunning(null);
      // Reload even after a failure (a pull with conflicts still changes things), and
      // only then show the result, since reloading clears old errors.
      await load(before.path, "refresh", Math.max(PAGE_SIZE, before.commits.length));
      if (failure) {
        const retry: Action | undefined =
          RETRYABLE.has(action.kind) && isLocalChangesError(failure)
            ? { kind: "stashAndRetry", action, includeUntracked: involvesUntrackedFiles(failure) }
            : undefined;
        setError({ message: failure, retry });
        return false;
      }
      if (action.kind === "fetch") setLastFetch(Date.now());
      if (!options.quiet && message) {
        const undo = undoFor(action, before);
        setToast({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo) } : undefined });
      }
      return true;
    },
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

  // Search: matching commits are highlighted, and Enter / Shift+Enter move between them.
  const matches = useMemo(() => (snapshot ? findMatches(snapshot.commits, query) : []), [snapshot, query]);
  const matchIds = useMemo(
    () => (query.trim() && snapshot ? new Set(matches.map((index) => snapshot.commits[index].id)) : null),
    [matches, query, snapshot],
  );
  const indexById = useMemo(
    () => new Map((snapshot?.commits ?? []).map((commit, index) => [commit.id, index])),
    [snapshot],
  );
  const selectedIndex = selectedId ? indexById.get(selectedId) : undefined;
  const selected = selectedIndex !== undefined ? snapshot?.commits[selectedIndex] : undefined;

  const search = (text: string) => {
    setQuery(text);
    // Jump to the first match as you type.
    const first = snapshot ? findMatches(snapshot.commits, text)[0] : undefined;
    if (snapshot && first !== undefined) setSelectedId(snapshot.commits[first].id);
  };
  const stepSearch = (step: 1 | -1) => {
    if (!snapshot || matches.length === 0) return;
    const from = selectedIndex ?? -1;
    const next =
      step > 0
        ? (matches.find((index) => index > from) ?? matches[0])
        : ([...matches].reverse().find((index) => index < from) ?? matches[matches.length - 1]);
    setSelectedId(snapshot.commits[next].id);
  };

  const zoomBy = useCallback(
    (step: 1 | -1 | 0) =>
      setZoom((current) => {
        if (step === 0) return 1;
        const index = ZOOM_LEVELS.findIndex((level) => level >= current - 0.001);
        const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (index < 0 ? 4 : index) + step))];
        return next;
      }),
    [setZoom],
  );
  useEffect(() => applyZoom(zoom), [zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "o") {
        event.preventDefault();
        pick();
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
      } else if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        zoomBy(1);
      } else if (mod && key === "-") {
        event.preventDefault();
        zoomBy(-1);
      } else if (mod && key === "0") {
        event.preventDefault();
        zoomBy(0);
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pick, refresh, zoomBy, setSidebarOpen]);

  // Reopen the last repository on launch.
  useEffect(() => {
    if (!readSetting("reopenLast", true)) return;
    const last = loadRecent()[0];
    if (last) load(last.path, "open");
  }, [load]);

  // The latest state, for timers and window events that outlive a render.
  const latest = useRef({ snapshot, dialog, running, refresh, autoFetch });
  latest.current = { snapshot, dialog, running, refresh, autoFetch };

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
        setLastFetch(Date.now());
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

  // How far the checked-out branch is ahead of / behind its upstream, among loaded commits.
  const { ahead, behind } = useMemo(() => {
    if (!snapshot?.upstream?.commit || !snapshot.headCommit) return { ahead: 0, behind: 0 };
    const byId = new Map(snapshot.commits.map((commit) => [commit.id, commit]));
    const local = ancestors(snapshot.headCommit, byId);
    const remote = ancestors(snapshot.upstream.commit, byId);
    return { ahead: countMissing(local, remote), behind: countMissing(remote, local) };
  }, [snapshot]);

  // Local branch names anywhere in the history, to know which remote branches can be checked out.
  const localBranches = useMemo(
    () =>
      new Set(
        (snapshot?.commits ?? []).flatMap((commit) =>
          commit.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name),
        ),
      ),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <Welcome
        recent={recent}
        opening={busy?.kind === "open" ? busy.path : null}
        error={error?.message ?? null}
        onPick={pick}
        onOpen={(path) => load(path, "open")}
        onForget={(path) => setRecent(forgetRepo(path))}
      />
    );
  }

  const branchLabel = snapshot.headBranch ?? "HEAD";
  const canChange = !snapshot.bare && running === null;
  const ctx: MenuContext = {
    snapshot,
    canChange,
    localBranches,
    run: (action) => act(action),
    open: setDialog,
  };
  const commitById = (id: string) => {
    const index = indexById.get(id);
    return index === undefined ? undefined : snapshot.commits[index];
  };
  const showMenu = (x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items });
  const menuUnder = (anchor: HTMLElement, items: MenuItem[], width = 240) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({ x: Math.max(4, Math.min(rect.left, rect.right - width)), y: rect.bottom + 4, items });
  };

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

  const repoMenu = (anchor: HTMLElement) => {
    const others = recent.filter((repo) => repo.path !== snapshot.path).slice(0, 8);
    menuUnder(
      anchor,
      [
        ...others.map((repo) => ({
          label: repo.name,
          // The end of the path tells repositories with the same name apart.
          shortcut: repo.path.length > 36 ? `…${repo.path.slice(-35)}` : repo.path,
          onSelect: () => load(repo.path, "open"),
        })),
        {
          label: "Open another repository…",
          icon: <FolderIcon />,
          shortcut: `${modKey}O`,
          separated: others.length > 0,
          onSelect: pick,
        },
        { label: "Close repository", icon: <CloseIcon />, onSelect: close },
      ],
      320,
    );
  };

  const viewMenu = (anchor: HTMLElement) =>
    menuUnder(
      anchor,
      [
        { label: "Show branches", checked: sidebarOpen, shortcut: `${modKey}B`, onSelect: () => setSidebarOpen(!sidebarOpen) },
        { label: "Compact rows", checked: dense, onSelect: () => setDense(!dense) },
        {
          label: "Fetch every 5 minutes",
          checked: autoFetch,
          separated: true,
          onSelect: () => setAutoFetch(!autoFetch),
        },
        { label: "Reopen this repository on launch", checked: reopenLast, onSelect: () => setReopenLast(!reopenLast) },
        { label: "Zoom in", shortcut: `${modKey}+`, separated: true, onSelect: () => zoomBy(1) },
        { label: "Zoom out", shortcut: `${modKey}−`, onSelect: () => zoomBy(-1) },
        { label: `Actual size (now ${Math.round(zoom * 100)}%)`, shortcut: `${modKey}0`, onSelect: () => zoomBy(0) },
        {
          label: "Reset column and panel sizes",
          separated: true,
          onSelect: () => {
            setColumnWidths({ refs: null, graph: null });
            setSidebarWidth(220);
            setDetailsWidth(380);
          },
        },
      ],
      280,
    );

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

  const head = snapshot.headCommit ? commitById(snapshot.headCommit) : undefined;
  const panelResize = (panel: "sidebar" | "details") => ({
    onResizeStart: () => (resizeStart.current = { sidebar: sidebarWidth, details: detailsWidth }),
    onResize: (delta: number) =>
      panel === "sidebar"
        ? setSidebarWidth(Math.round(Math.min(480, Math.max(160, resizeStart.current.sidebar + delta))))
        : setDetailsWidth(Math.round(Math.min(720, Math.max(300, resizeStart.current.details - delta)))),
    onReset: () => (panel === "sidebar" ? setSidebarWidth(220) : setDetailsWidth(380)),
  });

  return (
    <div className="app">
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
        lastFetch={lastFetch}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onRepoMenu={repoMenu}
        onViewMenu={viewMenu}
        onRefresh={refresh}
        onPick={pick}
        onClose={close}
      />
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
      <main className="workspace">
        {sidebarOpen && (
          <>
            <Sidebar
              commits={snapshot.commits}
              selectedId={selectedId}
              width={sidebarWidth}
              onSelect={setSelectedId}
              onActivate={(entry) => {
                const commit = commitById(entry.commitId);
                const checkout = commit && checkoutFor(ctx, pillForEntry(entry), commit);
                if (checkout && canChange) act(checkout);
              }}
              onContextMenu={(entry, x, y) => {
                const commit = commitById(entry.commitId);
                if (commit) showMenu(x, y, pillMenu(ctx, pillForEntry(entry), commit));
              }}
            />
            <ResizeHandle className="panel-handle" {...panelResize("sidebar")} />
          </>
        )}
        <CommitList
          key={snapshot.path}
          snapshot={snapshot}
          selectedId={selectedId}
          onSelect={setSelectedId}
          matchIds={matchIds}
          dense={dense}
          columnWidths={columnWidths}
          onColumnWidths={setColumnWidths}
          onContextMenu={(commit, x, y) => showMenu(x, y, commitMenu(ctx, commit))}
          onPillActivate={(pill, commit) => {
            const checkout = checkoutFor(ctx, pill, commit);
            if (checkout && canChange) act(checkout);
          }}
          onPillContextMenu={(pill, commit, x, y) => showMenu(x, y, pillMenu(ctx, pill, commit))}
          onLoadMore={() => load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
          loadingMore={busy?.kind === "more"}
        />
        {selected && (
          <>
            <ResizeHandle className="panel-handle" {...panelResize("details")} />
            <div className="details-frame" style={{ width: detailsWidth }}>
              {selected.kind === "worktree" ? (
                <WorktreeDetailsPanel
                  snapshot={snapshot}
                  run={(action, options) => act(action, "other", options)}
                  busy={running !== null}
                  draft={draft}
                  onDraft={setDraft}
                  onStash={() => setDialog({ kind: "stash" })}
                  onDiscard={() => head && setDialog({ kind: "reset", target: head })}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <CommitDetailsPanel
                  repoPath={snapshot.path}
                  commit={selected}
                  cache={detailsCache.current}
                  hasCommit={(id) => indexById.has(id)}
                  onSelect={setSelectedId}
                  onClose={() => setSelectedId(null)}
                  actions={detailsActions(selected)}
                />
              )}
            </div>
          </>
        )}
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === "reset" && (
        <ResetDialog
          snapshot={snapshot}
          target={dialog.target}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            const before = snapshot.headCommit;
            if (dialog.target.id !== before) setSelectedId(dialog.target.id);
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
      {toast && <Toast toast={toast} onDone={hideToast} />}
    </div>
  );
}

