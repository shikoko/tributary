import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { copyText } from "./lib/clipboard";
import { ancestors, countMissing } from "./lib/graph";
import { forgetRepo, loadRecent, rememberRepo } from "./lib/recent";
import { findMatches } from "./lib/search";
import { CommitDetailsPanel } from "./components/CommitDetails";
import { CommitList } from "./components/CommitList";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { ForcePushDialog } from "./components/ForcePushDialog";
import {
  BranchIcon,
  BranchPlusIcon,
  CloseIcon,
  CloudIcon,
  CommitIcon,
  CopyIcon,
  PushIcon,
  ResetIcon,
} from "./components/Icons";
import { NewBranchDialog } from "./components/NewBranchDialog";
import { ResetDialog } from "./components/ResetDialog";
import { Toast } from "./components/Toast";
import { Toolbar, type RemoteAction } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { WorktreeDetailsPanel } from "./components/WorktreeDetails";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;

type OpenDialog =
  | { kind: "reset"; target: CommitRow }
  | { kind: "newBranch"; target: CommitRow }
  | { kind: "forcePush" }
  | null;

/** Don't refresh on window focus more often than this, in milliseconds. */
const FOCUS_REFRESH_INTERVAL = 2000;
/** At most this many "Check out …" entries in a commit's menu. */
const MAX_CHECKOUT_ITEMS = 6;

function setWindowTitle(title: string) {
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

/** Whether the checked-out branch can be hard reset to `commit`. */
function canResetTo(snapshot: RepoSnapshot, commit: CommitRow): boolean {
  if (snapshot.bare || commit.kind !== "commit") return false;
  // Resetting to the current commit only makes sense when there are changes to discard.
  return commit.id !== snapshot.headCommit || snapshot.worktree !== null;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  /** The git action that is running, if any. */
  const [running, setRunning] = useState<RemoteAction | "other" | null>(null);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const detailsCache = useRef(new Map<string, CommitDetails>());
  /** Increases with every load, so answers to older loads can be ignored. */
  const loadCount = useRef(0);
  const lastLoad = useRef(0);
  /** True while something is loading or the folder picker is open; focus refreshes wait. */
  const blockFocusRefresh = useRef(false);

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
      if (current()) setError(String(e));
    } finally {
      if (current()) {
        setBusy(null);
        blockFocusRefresh.current = false;
        lastLoad.current = Date.now();
      }
    }
  }, []);

  const pick = useCallback(async () => {
    blockFocusRefresh.current = true;
    try {
      const path = await open({ directory: true, multiple: false, title: "Open a git repository" });
      if (typeof path === "string") {
        await load(path, "open");
        return;
      }
    } catch (e) {
      setError(String(e));
    }
    blockFocusRefresh.current = false;
  }, [load]);

  const refresh = useCallback(() => {
    if (snapshot) load(snapshot.path, "refresh", Math.max(PAGE_SIZE, snapshot.commits.length));
  }, [snapshot, load]);

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

  /** Run a git action, reload, then show what happened. */
  const act = useCallback(
    async (action: Action, kind: RemoteAction | "other") => {
      if (!snapshot) return;
      setRunning(kind);
      setError(null);
      blockFocusRefresh.current = true;
      let message: string | null = null;
      let failure: string | null = null;
      try {
        message = await runAction(snapshot.path, action);
      } catch (e) {
        failure = String(e);
      }
      setRunning(null);
      // Reload even after a failure (a pull with conflicts still changes things), and
      // only then show the result, since reloading clears old errors.
      await load(snapshot.path, "refresh", Math.max(PAGE_SIZE, snapshot.commits.length));
      if (failure) setError(failure);
      else setToast(message);
    },
    [snapshot, load],
  );

  /** A dialog finished its action: show what happened and reload. */
  const finishDialog = useCallback(
    (message: string) => {
      setDialog(null);
      setToast(message);
      refresh();
    },
    [refresh],
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
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pick, refresh]);

  // Pick up changes made elsewhere (a commit in the terminal, an edit in the editor)
  // when coming back to the window.
  const onWindowFocus = useRef(() => {});
  onWindowFocus.current = () => {
    if (!snapshot || dialog || running || blockFocusRefresh.current) return;
    if (Date.now() - lastLoad.current < FOCUS_REFRESH_INTERVAL) return;
    refresh();
  };
  useEffect(() => {
    const onFocus = () => onWindowFocus.current();
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
        error={error}
        onPick={pick}
        onOpen={(path) => load(path, "open")}
        onForget={(path) => setRecent(forgetRepo(path))}
      />
    );
  }

  const branchLabel = snapshot.headBranch ?? "HEAD";
  const canChange = !snapshot.bare && running === null;

  const commitMenu = (commit: CommitRow): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Copy SHA", icon: <CopyIcon />, onSelect: () => copyText(commit.id) }];
    if (commit.kind !== "commit") return items;

    const checkouts: MenuItem[] = [];
    for (const ref of commit.refs) {
      if (ref.kind === "branch" && !ref.current) {
        checkouts.push({
          label: `Check out ${ref.name}`,
          icon: <BranchIcon />,
          disabled: !canChange,
          onSelect: () => act({ kind: "checkoutBranch", name: ref.name }, "other"),
        });
      } else if (ref.kind === "remote") {
        const local = ref.name.slice(ref.name.indexOf("/") + 1);
        if (localBranches.has(local)) continue;
        checkouts.push({
          label: `Check out ${local} (tracking ${ref.name})`,
          icon: <CloudIcon />,
          disabled: !canChange,
          onSelect: () => act({ kind: "checkoutRemoteBranch", name: ref.name }, "other"),
        });
      }
    }
    const hasLocalBranch = commit.refs.some((ref) => ref.kind === "branch");
    if (!hasLocalBranch && commit.id !== snapshot.headCommit) {
      checkouts.push({
        label: "Check out this commit (detached)",
        icon: <CommitIcon />,
        disabled: !canChange,
        onSelect: () => act({ kind: "checkoutCommit", id: commit.id }, "other"),
      });
    }

    items.push(...checkouts.slice(0, MAX_CHECKOUT_ITEMS).map((item, i) => ({ ...item, separated: i === 0 })));
    items.push(
      {
        label: "New branch here…",
        icon: <BranchPlusIcon />,
        separated: checkouts.length === 0,
        disabled: !canChange,
        onSelect: () => setDialog({ kind: "newBranch", target: commit }),
      },
      {
        label: `Hard reset ${branchLabel} to this commit…`,
        icon: <ResetIcon />,
        danger: true,
        separated: true,
        disabled: !canChange || !canResetTo(snapshot, commit),
        onSelect: () => setDialog({ kind: "reset", target: commit }),
      },
    );
    return items;
  };

  const pushMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: rect.right - 220,
      y: rect.bottom + 4,
      items: [
        { label: "Push", icon: <PushIcon />, onSelect: () => act({ kind: "push", force: false }, "push") },
        {
          label: "Force push…",
          icon: <PushIcon />,
          danger: true,
          separated: true,
          onSelect: () => setDialog({ kind: "forcePush" }),
        },
      ],
    });
  };

  const remoteActions: Record<RemoteAction, Action> = {
    fetch: { kind: "fetch" },
    pull: { kind: "pull" },
    push: { kind: "push", force: false },
  };

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
        onRefresh={refresh}
        onPick={pick}
        onClose={close}
      />
      {error && (
        <div className="error-banner inline" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      <main className="workspace">
        <CommitList
          key={snapshot.path}
          snapshot={snapshot}
          selectedId={selectedId}
          onSelect={setSelectedId}
          matchIds={matchIds}
          onContextMenu={(commit, x, y) => setMenu({ x, y, items: commitMenu(commit) })}
          onLoadMore={() => load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
          loadingMore={busy?.kind === "more"}
        />
        {selected?.kind === "worktree" && snapshot.worktree && (
          <WorktreeDetailsPanel
            status={snapshot.worktree}
            headBranch={snapshot.headBranch}
            onClose={() => setSelectedId(null)}
          />
        )}
        {selected && selected.kind !== "worktree" && (
          <CommitDetailsPanel
            repoPath={snapshot.path}
            commit={selected}
            cache={detailsCache.current}
            hasCommit={(id) => indexById.has(id)}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
            resetLabel={
              canChange && canResetTo(snapshot, selected) ? `Hard reset ${branchLabel} to this commit…` : undefined
            }
            onReset={() => setDialog({ kind: "reset", target: selected })}
          />
        )}
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === "reset" && (
        <ResetDialog
          snapshot={snapshot}
          target={dialog.target}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setSelectedId(dialog.target.id);
            finishDialog(message);
          }}
        />
      )}
      {dialog?.kind === "newBranch" && (
        <NewBranchDialog
          repoPath={snapshot.path}
          target={dialog.target}
          canCheckout={!snapshot.bare}
          onCancel={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
      {dialog?.kind === "forcePush" && (
        <ForcePushDialog snapshot={snapshot} onCancel={() => setDialog(null)} onDone={finishDialog} />
      )}
      {toast && <Toast message={toast} onDone={hideToast} />}
    </div>
  );
}
