import { useRef, useState, useMemo } from "react";
import { usePresence } from "../lib/usePresence";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { fullRefName, PAGE_SIZE, type Action, type CommitRow, type DiffSource, type FileChange, type FileChecks, type Lock, type Overlap, type PullRequest, type RepoSnapshot, type Worktree } from "../api";
import { isShown } from "../lib/diffTargets";
import { withCoAuthor } from "../lib/commitMessage";
import type { LfsLocks } from "../lib/locks";
import type { RefEntry } from "../lib/refs";
import { checkoutFor, commitMenu, dropMenu, pillForEntry, pillMenu, selectionMenu, type OpenDialog } from "../menus";
import { ActivityPanel } from "../components/ActivityPanel";
import { CommitList } from "../components/CommitList";
import { ElsewherePanel } from "../components/ElsewherePanel";
import { RepoSettingsDialog } from "../components/RepoSettingsDialog";
import { ComparePanel } from "../components/ComparePanel";
import { useFileViews } from "./useFileViews";
import { ListOverlays, type RewriteShown } from "./ListOverlays";
import { useStacks } from "./useStacks";
import { useRepositoryMenus } from "./useRepositoryMenus";
import type { MenuItem } from "../components/ContextMenu";
import { BranchIcon, EyeIcon, PlusIcon, StashIcon, TagIcon } from "../components/Icons";
import { MessageTools } from "../components/MessageTools";
import { ResizeHandle } from "../components/ResizeHandle";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import type { ToastMessage } from "../components/Toast";
import { Toolbar, type RemoteAction } from "../components/Toolbar";
import { RUNNING_LABELS } from "./constants";
import { DetailsPane } from "./DetailsPane";
import { RepositoryDialogs } from "./Dialogs";
import { fileMenuItems, lockMenuItems } from "./fileMenus";
import { columnMenuItems, detailsActionsFor, pushMenuItems, submoduleMenuItems, worktreeMenuItems } from "./listMenus";
import { RepositoryBanners } from "./RepositoryBanners";
import { effectiveTracker, IssueTrackerContext, type TrackerSetting } from "../lib/issues";
import { useRepoSetting } from "../lib/repoPrefs";
import { webRemote } from "../lib/weblinks";
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
  /** The team activity view (from the View menu). */
  teamOpen: boolean;
  onCloseTeam: () => void;
  /** A pull request shown over the commit list. */
  request: PullRequest | null;
  onShowRequest: (pr: PullRequest) => void;
  onCloseRequest: () => void;
  /** A pull request was opened from the app. */
  onRequestCreated: (pr: PullRequest) => void;
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
  // The repository's issue tracker: the one chosen in its settings, or its remote's issues.
  const [trackerSetting] = useRepoSetting<TrackerSetting>("issueTracker", snapshot.path, null);
  const issueTracker = useMemo(
    () => ({ repoPath: snapshot.path, tracker: effectiveTracker(trackerSetting, snapshot), remote: webRemote(snapshot) }),
    // The remotes are what matters of the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackerSetting, snapshot.path, snapshot.webRemotes, snapshot.upstream?.name],
  );

  /** Branches built on other unmerged branches. */
  const stacks = useStacks(snapshot);
  /** A branch whose rewrite is shown over the list (what changed when it was force-pushed). */
  const [rewrite, setRewrite] = useState<RewriteShown | null>(null);
  const shownIn = useRef(snapshot.path);
  if (shownIn.current !== snapshot.path) {
    shownIn.current = snapshot.path;
    if (rewrite) setRewrite(null);
  }

  // A file's changes, who changed each line, and two commits compared.
  const views = useFileViews({
    snapshot,
    selection,
    details: props.details,
    highlight,
    byId,
    closeOthers: () => {
      if (props.teamOpen) props.onCloseTeam();
      if (props.request) props.onCloseRequest();
      setRewrite(null);
    },
  });
  const { comparing, compared, showChanges, showBlame, shownDiff } = views;

  // What the commit, branch, file and list menus need.
  const { ctx, fileMenuContext, worktreeContext, submoduleContext } = useRepositoryMenus({
    snapshot,
    canChange,
    counts,
    act,
    openDialog,
    showRequest: props.onShowRequest,
    showRewrite: setRewrite,
    stacks,
    highlight,
    settings,
    byId,
    worktrees: props.worktrees,
    openTab: props.openTab,
    compare: comparing.compare,
    setError: repo.setError,
    lfs,
    checks: props.checks,
    notify: props.notify,
    showChanges,
    showBlame,
    updateSubmodules: props.submodules.update,
  });
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
        repoPath={snapshot.path}
        commits={snapshot.commits}
        hiddenRefs={snapshot.hiddenRefs}
        visibility={settings.visibility}
        pins={settings.pins}
        selectedId={selection.selectedId}
        width={sidebarWidth}
        aheadBehind={counts.aheadBehind}
        stacks={stacks}
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
        onManageRemotes={snapshot.bare ? null : () => openDialog({ kind: "repoSettings", section: "Remotes" })}
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
  const detailsOpen = Boolean(comparing.request || selection.selected || selection.multi);
  const detailsPanel = usePresence(
    detailsOpen,
    comparing.request ? (
      <ComparePanel
        comparing={comparing}
        onOpenFile={(file) => compared && showChanges(file, { kind: "range", from: compared.base, to: compared.to.id })}
        isShown={(path) => Boolean(compared && isShown(shownDiff && { source: shownDiff.source, path: shownDiff.file.path }, { kind: "range", from: compared.base, to: compared.to.id }, path))}
        onSelect={(id) => (byId.has(id) ? select(id) : notLoaded())}
        hasCommit={(id) => byId.has(id)}
      />
    ) : detailsOpen ? (
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
        onCompare={comparing.compare}
      />
    ) : null,
  );

  return (
    <IssueTrackerContext.Provider value={issueTracker}>
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
        onSearchMode={search.setMode}
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
            onMorePills={(pills, commit, x, y) =>
              menu.show(
                x,
                y,
                pills.map((pill) => ({
                  label: pill.name,
                  icon: pill.kind === "tag" ? <TagIcon /> : pill.kind === "stash" ? <StashIcon /> : <BranchIcon />,
                  onSelect: () => menu.show(x, y, pillMenu(ctx, pill, commit)),
                })),
              )
            }
            onPillFocus={(pill, commit) => highlight.highlightHistory(pill.name, commit.id)}
            onDropRef={(revision, _commit, x, y) => {
              if (revision !== snapshot.headBranch) menu.show(x, y, dropMenu(ctx, revision));
            }}
            onLoadMore={() => repo.load(snapshot.path, "more", snapshot.commits.length + PAGE_SIZE)}
            loadingMore={repo.busy?.kind === "more"}
          />
          <ListOverlays
            snapshot={snapshot}
            views={views}
            highlight={highlight}
            run={run}
            hasCommit={(id) => byId.has(id)}
            select={select}
            notLoaded={notLoaded}
            openSettings={props.openSettings}
            locks={lfs.locks?.locks ?? null}
            overlaps={props.overlaps}
            teamOpen={props.teamOpen}
            onCloseTeam={props.onCloseTeam}
            request={props.request}
            onCloseRequest={props.onCloseRequest}
            notify={(text) => props.notify({ text })}
            rewrite={rewrite}
            onShowRewrite={setRewrite}
            onCloseRewrite={() => setRewrite(null)}
          />
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
          automaticTracker={effectiveTracker(null, snapshot)}
          protectedBranches={settings.protectedBranches}
          setProtectedBranches={settings.setProtectedBranches}
          run={(action) => act(action)}
          onCleanUpLfs={() => openDialog({ kind: "pruneLfs" })}
          onClose={() => openDialog(null)}
          section={props.dialog.section}
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
        notify={(text) => props.notify({ text })}
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
        push={() => act({ kind: "push", force: false }, "push")}
        onRequestCreated={props.onRequestCreated}
        signIn={() => {
          openDialog(null);
          props.openSettings("Accounts");
        }}
      />
    </IssueTrackerContext.Provider>
  );
}
