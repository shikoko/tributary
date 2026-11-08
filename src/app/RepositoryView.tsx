import { useEffect, useMemo, useRef, useState } from "react";
import { usePresence } from "../lib/usePresence";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fullRefName, PAGE_SIZE, WORKTREE_ID, type Action, type CommitRow, type DiffSource, type FileChange, type FileChecks, type Lock, type Overlap, type RepoSnapshot, type Worktree } from "../api";
import { commitTargets, findTarget, highlightedFirst, worktreeTargets, type DiffTarget, type ShownDiff } from "../lib/diffTargets";
import { withCoAuthor } from "../lib/commitMessage";
import { rewritable } from "../lib/graph";
import type { LfsLocks } from "../lib/locks";
import { baseName, joinPath } from "../lib/paths";
import type { RefEntry } from "../lib/refs";
import { openInBrowser } from "../lib/weblinks";
import { checkoutFor, commitMenu, dropMenu, pillForEntry, pillMenu, selectionMenu, type MenuContext, type OpenDialog } from "../menus";
import { ActivityPanel } from "../components/ActivityPanel";
import { CommitList } from "../components/CommitList";
import { ElsewherePanel } from "../components/ElsewherePanel";
import { RepoSettingsDialog } from "../components/RepoSettingsDialog";
import { DiffView } from "../components/diff/DiffView";
import type { MenuItem } from "../components/ContextMenu";
import { EyeIcon, PlusIcon } from "../components/Icons";
import { MessageTools } from "../components/MessageTools";
import { ResizeHandle } from "../components/ResizeHandle";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import type { ToastMessage } from "../components/Toast";
import { Toolbar, type RemoteAction } from "../components/Toolbar";
import { RUNNING_LABELS } from "./constants";
import { DetailsPane } from "./DetailsPane";
import { RepositoryDialogs } from "./Dialogs";
import { fileMenuItems, lockMenuItems, type FileMenuContext } from "./fileMenus";
import { columnMenuItems, detailsActionsFor, pushMenuItems, submoduleMenuItems, worktreeMenuItems, type SubmoduleMenuContext, type WorktreeMenuContext } from "./listMenus";
import { RepositoryBanners } from "./RepositoryBanners";
import { DIFF_SECTION } from "./settingsSections";
import type { Actions } from "./useActions";
import type { BranchCounts } from "./useBranchCounts";
import type { CommitDetailsCache } from "./useCommitDetails";
import type { Draft } from "./useDraft";
import type { Highlight } from "./useHighlight";
import type { LfsHealthState } from "./useLfsHealth";
import type { LockRelease } from "./useLockRelease";
import type { ContextMenuState } from "./useMenus";
import type { Preferences } from "./usePreferences";
import type { Repository } from "./useRepository";
import type { RepositorySettings } from "./useRepositorySettings";
import type { Search } from "./useSearch";
import type { Submodules } from "./useSubmodules";
import type { Selection } from "./useSelection";
import type { ActivityLog } from "./useWindowEvents";

const REMOTE_ACTIONS: Record<RemoteAction, Action> = {
  fetch: { kind: "fetch" },
  pull: { kind: "pull" },
  push: { kind: "push", force: false },
};

interface Props {
  snapshot: RepoSnapshot;
  repo: Repository;
  selection: Selection;
  search: Search;
  highlight: Highlight;
  actions: Actions;
  settings: RepositorySettings;
  preferences: Preferences;
  counts: BranchCounts;
  lfs: LfsLocks;
  lfsHealth: LfsHealthState;
  lockRelease: LockRelease;
  /** Files you're changing that other branches also changed. */
  overlaps: Overlap[];
  submodules: Submodules;
  checks: FileChecks | null;
  worktrees: Worktree[];
  details: CommitDetailsCache;
  draft: Draft;
  activity: ActivityLog;
  place: { initialScroll: number; onScroll: (top: number) => void };
  dialog: OpenDialog;
  openDialog: (dialog: OpenDialog) => void;
  menu: ContextMenuState;
  /** The View menu's commands, for the toolbar's view button. */
  viewMenu: MenuItem[];
  /** Open a repository (another working tree, say) in its tab. */
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  /** Choose files to lock with Git LFS. */
  lockFiles: () => void;
  /** Open Settings, at a section (like "Diff and merge"). */
  openSettings: (section?: string) => void;
  notify: (toast: ToastMessage) => void;
}

/** An open repository: the toolbar, the sidebar, the commit list and graph, the details, and the status bar. */
export function RepositoryView(props: Props) {
  const { snapshot, repo, selection, search, highlight, actions, settings, preferences, counts, lfs, menu, openDialog } = props;
  const { act, running } = actions;
  const { select, byId, selectedIds, selectedCommits } = selection;
  const { sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, detailsWidth, setDetailsWidth, activityOpen, setActivityOpen } = preferences;
  const canChange = !snapshot.bare && running === null;
  const run = (action: Action) => act(action);
  /** Sizes when a panel resize started. */
  const resizeStart = useRef({ sidebar: 0, details: 0 });

  // The diff view: a file's changes in the selected commit, or in your changes.
  const [diffAt, setDiffAt] = useState<(ShownDiff & { origin: string }) | null>(null);
  const origin = selection.selected && !selection.multi ? selection.selectedId : null;
  const commitFiles = diffAt && diffAt.origin !== WORKTREE_ID ? props.details.cache.current.get(diffAt.origin)?.files : undefined;
  const diffTargets: DiffTarget[] = useMemo(() => {
    if (!diffAt) return [];
    if (diffAt.origin === WORKTREE_ID) return worktreeTargets(snapshot.worktree);
    return commitTargets(diffAt.origin, highlightedFirst(commitFiles ?? [], highlight.isHistoryFile), byId.get(diffAt.origin)?.kind === "stash");
  }, [diffAt, snapshot.worktree, commitFiles, highlight.isHistoryFile, byId]);
  const diffIndex = diffAt && diffAt.origin === origin ? findTarget(diffTargets, diffAt.source, diffAt.path) : -1;
  const shownDiff = diffIndex >= 0 ? diffTargets[diffIndex] : null;
  // Another commit was selected, or the file isn't changed any more.
  useEffect(() => {
    if (diffAt && !shownDiff) setDiffAt(null);
  }, [diffAt, shownDiff]);
  const showChanges = (file: FileChange, source: DiffSource) => origin && setDiffAt({ origin, source, path: file.path });
  const stepDiff = (index: number) => {
    const target = diffTargets[index];
    if (target && diffAt) setDiffAt({ origin: diffAt.origin, source: target.source, path: target.file.path });
  };

  // What the commit, branch and selection menus need.
  const ctx: MenuContext = {
    snapshot,
    canChange,
    localBranches: counts.localBranches,
    run,
    open: openDialog,
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
    openUrl: openInBrowser,
    worktrees: props.worktrees,
    openWorktree: props.openTab,
  };
  const fileMenuContext: FileMenuContext = {
    snapshot,
    canChange,
    run,
    openDialog,
    showHistory: (file) => highlight.showHistory(file).catch((e) => repo.setError({ message: String(e) })),
    locks: lfs.locks ? lfs.byPath : null,
    checks: props.checks,
    reveal: (path) => revealItemInDir(joinPath(snapshot.path, path)).catch(() => props.notify({ text: `${baseName(path)} isn't in the working tree` })),
    showChanges,
  };
  const worktreeContext: WorktreeMenuContext = {
    canChange,
    open: props.openTab,
    reveal: (path) => revealItemInDir(path).catch(() => props.notify({ text: `${path} isn't there any more` })),
    remove: (worktree) => openDialog({ kind: "removeWorktree", worktree }),
    prune: () => act({ kind: "pruneWorktrees" }),
  };
  const submoduleContext: SubmoduleMenuContext = {
    canChange,
    open: (submodule) => props.openTab(joinPath(snapshot.path, submodule.path)),
    update: props.submodules.update,
    stage: (path) => act({ kind: "stage", paths: [path] }),
    reveal: (submodule) => revealItemInDir(joinPath(snapshot.path, submodule.path)).catch(() => props.notify({ text: `${submodule.path} isn't there` })),
  };
  const fileMenu = (file: FileChange, x: number, y: number, source: DiffSource) => menu.show(x, y, fileMenuItems(fileMenuContext, file, source));
  const lockMenu = (lock: Lock, x: number, y: number) => menu.show(x, y, lockMenuItems(fileMenuContext, lock));
  const checkout = (entry: { pill: Parameters<typeof checkoutFor>[1]; commit: CommitRow | undefined }) => {
    const action = entry.commit && checkoutFor(ctx, entry.pill, entry.commit);
    if (action && canChange) act(action);
  };
  const sidebarMenu = (entry: RefEntry, x: number, y: number) => {
    const name = fullRefName(entry);
    const commit = byId.get(entry.commitId);
    if (entry.hidden || !commit) {
      // A hidden branch: its commit may not even be loaded.
      if (!name) return;
      menu.show(x, y, [
        { label: `Show ${entry.name}`, icon: <EyeIcon />, onSelect: () => settings.setHidden([name], false) },
        {
          label: settings.pins.includes(name) ? `Unpin ${entry.name}` : `Pin ${entry.name} in the sidebar`,
          icon: <PlusIcon />,
          onSelect: () => settings.togglePin(name),
        },
      ]);
      return;
    }
    menu.show(x, y, pillMenu(ctx, pillForEntry(entry), commit));
  };
  const panelResize = (panel: "sidebar" | "details") => ({
    onResizeStart: () => (resizeStart.current = { sidebar: sidebarWidth, details: detailsWidth }),
    onResize: (delta: number) =>
      panel === "sidebar"
        ? setSidebarWidth(Math.round(Math.min(480, Math.max(160, resizeStart.current.sidebar + delta))))
        : setDetailsWidth(Math.round(Math.min(720, Math.max(300, resizeStart.current.details - delta)))),
    onReset: () => (panel === "sidebar" ? setSidebarWidth(220) : setDetailsWidth(380)),
  });

  const myLocks = lfs.locks?.locks.filter((lock) => lock.mine) ?? [];
  const notLoaded = () => props.notify({ text: "That commit isn't loaded: load more commits, or fetch" });
  /** The status bar's "changed elsewhere": the branches, and your files on each. */
  const [elsewhereAt, setElsewhereAt] = useState<HTMLElement | null>(null);
  const showBranch = (branch: string) => {
    const tip = snapshot.commits.find((commit) => commit.refs.some((ref) => (ref.kind === "branch" || ref.kind === "remote") && ref.name === branch));
    if (!tip) return notLoaded();
    select(tip.id);
    highlight.highlightHistory(branch, tip.id);
  };
  const activityHere = props.activity.entries;
  const lastHere = [...activityHere].reverse().find((entry) => entry.folder === snapshot.path && !entry.background);
  const canFetch = !snapshot.bare && snapshot.remotes.length > 0;

  // The side panels slide open and closed (see usePresence).
  const sidebarPanel = usePresence(
    sidebarOpen,
    sidebarOpen ? (
      <Sidebar
        commits={snapshot.commits}
        hiddenRefs={snapshot.hiddenRefs}
        visibility={settings.visibility}
        pins={settings.pins}
        selectedId={selection.selectedId}
        width={sidebarWidth}
        aheadBehind={counts.aheadBehind}
        onSelect={(id) => byId.has(id) && select(id)}
        onActivate={(entry) => checkout({ pill: pillForEntry(entry), commit: byId.get(entry.commitId) })}
        onContextMenu={sidebarMenu}
        onFocus={(entry) => byId.has(entry.commitId) && highlight.highlightHistory(entry.name, entry.commitId)}
        onToggleVisible={(entry) => {
          const name = fullRefName(entry);
          if (!name) return;
          settings.setHidden([name], settings.soloing ? settings.visibility.solo.includes(name) : !entry.hidden);
        }}
        onShowAll={settings.showAllBranches}
        onPrune={canChange ? () => openDialog({ kind: "prune" }) : null}
        protectedBranches={settings.protectedBranches}
        locks={lfs.locks?.locks ?? null}
        locksError={lfs.locks?.error ?? null}
        onLockMenu={lockMenu}
        onLockFiles={canChange ? props.lockFiles : null}
        onReleaseMine={canChange && myLocks.length > 0 ? () => act({ kind: "unlockFiles", locks: myLocks.map(({ id, path }) => ({ id, path })), force: false }) : null}
        worktrees={props.worktrees}
        onOpenWorktree={(worktree) => !worktree.current && props.openTab(worktree.path)}
        onWorktreeMenu={(worktree, x, y) => menu.show(x, y, worktreeMenuItems(worktree, worktreeContext))}
        submodules={props.submodules.list}
        onOpenSubmodule={submoduleContext.open}
        onSubmoduleMenu={(submodule, x, y) => menu.show(x, y, submoduleMenuItems(submodule, submoduleContext))}
      />
    ) : null,
  );
  const detailsOpen = Boolean(selection.selected || selection.multi);
  const detailsPanel = usePresence(
    detailsOpen,
    detailsOpen ? (
      <DetailsPane
        snapshot={snapshot}
        selection={selection}
        actions={actions}
        canChange={canChange}
        draft={props.draft}
        details={props.details}
        checks={props.checks}
        locks={lfs.locks ? lfs.byPath : null}
        isHistoryFile={highlight.isHistoryFile}
        detailsActions={(commit) => detailsActionsFor(commit, snapshot, canChange, run, openDialog)}
        messageTools={
          <MessageTools
            commits={snapshot.commits}
            you={snapshot.user}
            onUseMessage={async (commit) => {
              const details = await props.details.load(commit.id).catch(() => null);
              props.draft.setDraft((current) => ({ ...current, summary: details?.summary ?? commit.summary, description: details?.body ?? "" }));
            }}
            onAddCoAuthor={(person) => props.draft.setDraft((current) => ({ ...current, description: withCoAuthor(current.description, person) }))}
            openMenu={menu.under}
          />
        }
        openDialog={openDialog}
        onFileMenu={fileMenu}
        onOpenFile={showChanges}
        shownDiff={shownDiff && { source: shownDiff.source, path: shownDiff.file.path }}
        overlaps={props.overlaps}
        onNotLoaded={notLoaded}
      />
    ) : null,
  );

  return (
    <>
      <Toolbar
        snapshot={snapshot}
        refreshing={repo.busy !== null}
        running={running === "fetch" || running === "pull" || running === "push" ? running : null}
        ahead={counts.ahead}
        behind={counts.behind}
        search={search.position}
        searchInput={search.input}
        onSearch={search.search}
        onSearchStep={search.step}
        onRemote={(action) => act(REMOTE_ACTIONS[action], action)}
        onPushMenu={(anchor) => menu.under(anchor, pushMenuItems(() => act({ kind: "push", force: false }, "push"), openDialog))}
        lastFetch={snapshot.lastFetched ? snapshot.lastFetched * 1000 : null}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onViewMenu={(anchor) => menu.under(anchor, props.viewMenu, 320)}
        onRefresh={repo.refresh}
        onPick={repo.pick}
        onSettings={() => openDialog({ kind: "repoSettings" })}
        onClose={() => props.closeTab(snapshot.path)}
      />
      <RepositoryBanners
        snapshot={snapshot}
        repo={repo}
        actions={actions}
        selection={selection}
        highlight={highlight}
        settings={settings}
        lfsHealth={props.lfsHealth}
        lockRelease={props.lockRelease}
        submodules={props.submodules}
        alwaysUpdateSubmodules={
          preferences.submoduleUpdates === "ask"
            ? () => {
                preferences.setSubmoduleUpdates("always");
                if (props.submodules.notice) props.submodules.update(props.submodules.notice.paths);
              }
            : null
        }
        alwaysReleaseLocks={() => {
          preferences.setReleaseLocks("always");
          props.lockRelease.release();
        }}
        showWholeHistory={() => preferences.setFirstParentOnly(false)}
        openWorktree={props.openTab}
      />
      <main className="workspace">
        {sidebarPanel.shown && (
          <>
            <div className={`sidebar-frame${sidebarPanel.closing ? " closing" : ""}`} style={{ width: sidebarWidth }}>
              {sidebarPanel.content}
            </div>
            <ResizeHandle className="panel-handle" {...panelResize("sidebar")} />
          </>
        )}
        <div className="center-pane">
          <CommitList
            key={snapshot.path}
            snapshot={snapshot}
            selectedId={selection.selectedId}
            selectedIds={selectedIds}
            onSelect={select}
            matchIds={search.matchIds}
            focusIds={highlight.focusIds}
            dense={preferences.dense}
            columnWidths={preferences.columnWidths}
            onColumnWidths={preferences.setColumnWidths}
            columnOptions={preferences.columnOptions}
            daySeparators={preferences.daySeparators}
            onHeaderContextMenu={(x, y) =>
              menu.show(x, y, columnMenuItems(preferences.columnOptions, preferences.setColumnOptions, preferences.daySeparators, preferences.setDaySeparators))
            }
            previews={preferences.previews}
            loadDetails={props.details.load}
            initialScrollTop={props.place.initialScroll}
            onScrollChange={props.place.onScroll}
            onContextMenu={(commit, x, y) =>
              menu.show(x, y, selection.multi && selectedIds?.has(commit.id) ? selectionMenu(ctx, selectedCommits) : commitMenu(ctx, commit))
            }
            onPillActivate={(pill, commit) => checkout({ pill, commit })}
            onPillContextMenu={(pill, commit, x, y) => menu.show(x, y, pillMenu(ctx, pill, commit))}
            onPillFocus={(pill, commit) => highlight.highlightHistory(pill.name, commit.id)}
            onDropRef={(revision, _commit, x, y) => {
              if (revision !== snapshot.headBranch) menu.show(x, y, dropMenu(ctx, revision));
            }}
            onLoadMore={() => repo.load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
            loadingMore={repo.busy?.kind === "more"}
          />
          {shownDiff && (
            <DiffView
              repoPath={snapshot.path}
              targets={diffTargets}
              index={diffIndex}
              onIndex={stepDiff}
              onClose={() => setDiffAt(null)}
              run={run}
              version={snapshot.worktree}
              onChooseTool={() => props.openSettings(DIFF_SECTION)}
            />
          )}
        </div>
        {detailsPanel.shown && (
          <>
            <ResizeHandle className="panel-handle" {...panelResize("details")} />
            <div className={`details-frame${detailsPanel.closing ? " closing" : ""}`} style={{ width: detailsWidth, ["--panel-width" as string]: `${detailsWidth}px` }}>
              {detailsPanel.content}
            </div>
          </>
        )}
      </main>
      {activityOpen && <ActivityPanel entries={activityHere} folder={snapshot.path} onClear={props.activity.clear} onClose={() => setActivityOpen(false)} />}
      <StatusBar
        snapshot={snapshot}
        ahead={counts.ahead}
        behind={counts.behind}
        running={running && running !== "other" ? RUNNING_LABELS[running] : running === "other" ? "Working" : null}
        hiddenCount={settings.hiddenCount}
        soloing={settings.soloing}
        onShowAll={settings.showAllBranches}
        onFetch={canFetch && canChange ? () => act({ kind: "fetch" }, "fetch") : null}
        activityOpen={activityOpen}
        activityFailed={Boolean(lastHere && !lastHere.success)}
        onToggleActivity={() => setActivityOpen(!activityOpen)}
        onReveal={() => revealItemInDir(snapshot.path).catch((e) => repo.setError({ message: String(e) }))}
        pruneHint={settings.pruneHint}
        onPrune={canChange ? () => openDialog({ kind: "prune" }) : null}
        onDismissPruneHint={settings.dismissPruneHint}
        elsewhere={props.overlaps.length > 0 ? { count: props.overlaps.length, assets: props.overlaps.some((overlap) => overlap.unmergeable) } : null}
        onElsewhere={(anchor) => setElsewhereAt(elsewhereAt ? null : anchor)}
      />
      {props.dialog?.kind === "repoSettings" && (
        <RepoSettingsDialog
          name={snapshot.name}
          path={snapshot.path}
          protectedBranches={settings.protectedBranches}
          setProtectedBranches={settings.setProtectedBranches}
          run={(action) => act(action)}
          onCleanUpLfs={() => openDialog({ kind: "pruneLfs" })}
          onClose={() => openDialog(null)}
        />
      )}
      {elsewhereAt && props.overlaps.length > 0 && (
        <ElsewherePanel
          overlaps={props.overlaps}
          anchor={elsewhereAt}
          onClose={() => setElsewhereAt(null)}
          onShowCommit={(id) => (byId.has(id) ? select(id) : notLoaded())}
          onShowBranch={showBranch}
        />
      )}
      <RepositoryDialogs
        dialog={props.dialog}
        snapshot={snapshot}
        byId={byId}
        branchLabel={snapshot.headBranch ?? "HEAD"}
        protectedHead={settings.protectedHead}
        protectedBranches={settings.protectedBranches}
        pins={settings.pins}
        loadDetails={props.details.load}
        run={act}
        select={select}
        open={openDialog}
        onClose={() => openDialog(null)}
        onFinish={(message, undo) => {
          openDialog(null);
          actions.finished(message, undo, repo.refresh);
        }}
        onLocksChanged={() => lfs.refresh(true)}
        worktrees={props.worktrees}
        localBranches={[...counts.localBranches]}
        openWorktree={props.openTab}
      />
    </>
  );
}
