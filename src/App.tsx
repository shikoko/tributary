import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openRepository, PAGE_SIZE, type CommitDetails, type RepoSnapshot } from "./api";
import { forgetRepo, loadRecent, rememberRepo } from "./lib/recent";
import { CommitDetailsPanel } from "./components/CommitDetails";
import { CommitList } from "./components/CommitList";
import { CloseIcon } from "./components/Icons";
import { Toolbar } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";

type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;

function setWindowTitle(title: string) {
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

export default function App() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const detailsCache = useRef(new Map<string, CommitDetails>());

  const load = useCallback(async (path: string, mode: "open" | "refresh" | "more", limit = PAGE_SIZE) => {
    setBusy(mode === "open" ? { kind: "open", path } : { kind: mode });
    setError(null);
    try {
      const next = await openRepository(path, limit);
      if (mode === "open") detailsCache.current = new Map();
      const loaded = (id: string | null | undefined) => (id && next.commits.some((c) => c.id === id) ? id : null);
      setSnapshot(next);
      setSelectedId((current) =>
        mode !== "open" && loaded(current)
          ? current
          : (loaded(next.headCommit) ?? next.commits[0]?.id ?? null),
      );
      setRecent(rememberRepo(next.path, next.name));
      setWindowTitle(`${next.name} — Tributary`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const pick = useCallback(async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: "Open a git repository" });
      if (typeof path === "string") await load(path, "open");
    } catch (e) {
      setError(String(e));
    }
  }, [load]);

  const refresh = useCallback(() => {
    if (snapshot) load(snapshot.path, "refresh", Math.max(PAGE_SIZE, snapshot.commits.length));
  }, [snapshot, load]);

  const close = useCallback(() => {
    setSnapshot(null);
    setSelectedId(null);
    setError(null);
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
          onLoadMore={() => load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
          loadingMore={busy?.kind === "more"}
        />
        {selected && (
          <CommitDetailsPanel
            repoPath={snapshot.path}
            commit={selected}
            cache={detailsCache.current}
            hasCommit={(id) => indexById.has(id)}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  );
}
