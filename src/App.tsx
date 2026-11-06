import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  openRepository,
  PAGE_SIZE,
  type CommitDetails,
  type CommitRow,
  type RepoSnapshot,
} from "./api";
import { forgetRepo, loadRecent, rememberRepo } from "./lib/recent";
import { copyText } from "./lib/clipboard";
import { CommitDetailsPanel } from "./components/CommitDetails";
import { CommitList } from "./components/CommitList";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { CloseIcon } from "./components/Icons";
import { ResetDialog } from "./components/ResetDialog";
import { Toolbar } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { WorktreeDetailsPanel } from "./components/WorktreeDetails";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;

/** Don't refresh on window focus more often than this, in milliseconds. */
const FOCUS_REFRESH_INTERVAL = 2000;

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
  const [recent, setRecent] = useState(loadRecent);
  const [menu, setMenu] = useState<{ commit: CommitRow; x: number; y: number } | null>(null);
  const [resetTarget, setResetTarget] = useState<CommitRow | null>(null);
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
    blockFocusRefresh.current = false;
    setWindowTitle("Tributary");
  }, []);

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
    if (!snapshot || resetTarget || blockFocusRefresh.current) return;
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

  const indexById = useMemo(
    () => new Map((snapshot?.commits ?? []).map((commit, index) => [commit.id, index])),
    [snapshot],
  );
  const selectedIndex = selectedId ? indexById.get(selectedId) : undefined;
  const selected = selectedIndex !== undefined ? snapshot?.commits[selectedIndex] : undefined;

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
  const menuItems = (commit: CommitRow): MenuItem[] => [
    {
      label: `Hard reset ${branchLabel} to this commit…`,
      danger: true,
      disabled: !canResetTo(snapshot, commit),
      onSelect: () => setResetTarget(commit),
    },
    { label: "Copy SHA", onSelect: () => copyText(commit.id) },
  ];

  return (
    <div className="app">
      <Toolbar
        snapshot={snapshot}
        refreshing={busy !== null}
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
          onContextMenu={(commit, x, y) => commit.kind === "commit" && setMenu({ commit, x, y })}
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
            resetLabel={canResetTo(snapshot, selected) ? `Hard reset ${branchLabel} to this commit…` : undefined}
            onReset={() => setResetTarget(selected)}
          />
        )}
      </main>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.commit)} onClose={() => setMenu(null)} />
      )}
      {resetTarget && (
        <ResetDialog
          snapshot={snapshot}
          target={resetTarget}
          onCancel={() => setResetTarget(null)}
          onDone={() => {
            setResetTarget(null);
            setSelectedId(resetTarget.id);
            refresh();
          }}
        />
      )}
    </div>
  );
}
