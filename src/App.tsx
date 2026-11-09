import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { forgetAvatars, openInApp, WORKTREE_ID, type Action, type PullRequest } from "./api";
import { useOpenApps } from "./lib/apps";
import { useLfsLocks } from "./lib/locks";
import { isPatchFile } from "./lib/patches";
import { usePullRequestNews } from "./app/usePullRequestNews";
import { useSpeedOffer } from "./app/useSpeedOffer";
import { makeLookup, PullRequestsContext, requestNumber, usePullRequests } from "./lib/pullRequests";
import { BisectMarksContext, bisectMarks } from "./lib/bisect";
import { CiStatesContext, useCiStates } from "./lib/ciStates";
import { useUpdates } from "./lib/updates";
import type { OpenDialog } from "./menus";
import { ProfilePictures } from "./components/Avatar";
import { DownloadIcon } from "./components/Icons";
import { TabBar } from "./components/TabBar";
import type { ToastMessage } from "./components/Toast";
import { menuItems, shortcutLabel } from "./app/appCommand";
import { appMenus, helpCommandsFor, settingsCommand, startCommands, type MenuBarContext } from "./app/appMenus";
import { AppOverlays } from "./app/AppOverlays";
import { FOCUS_REFRESH_INTERVAL, type Running } from "./app/constants";
import { chooseFilesToLock } from "./app/lockPicker";
import { paletteCommands } from "./app/paletteCommands";
import { RepositoryView } from "./app/RepositoryView";
import { StartView } from "./app/StartView";
import { useActions } from "./app/useActions";
import { useBackgroundFetch } from "./app/useBackgroundFetch";
import { useBranchCounts } from "./app/useBranchCounts";
import { useChangedElsewhere } from "./app/useChangedElsewhere";
import { useSubmodules } from "./app/useSubmodules";
import { tabMenuItems } from "./app/tabMenu";
import { useCommitDetails } from "./app/useCommitDetails";
import { useDraft } from "./app/useDraft";
import { useAutoLock, useFileChecks } from "./app/useFileChecks";
import { useHighlight } from "./app/useHighlight";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { useLfsHealth } from "./app/useLfsHealth";
import { useLockRelease } from "./app/useLockRelease";
import { useContextMenu, useMenuBar } from "./app/useMenus";
import { useNativeMenu } from "./app/useNativeMenu";
import { useOverlays } from "./app/useOverlays";
import { usePlace } from "./app/usePlace";
import { usePreferences } from "./app/usePreferences";
import { useTaskbarProgress } from "./app/useTaskbarProgress";
import { overallPercent } from "./lib/progress";
import { ThemeContext, useAppearance } from "./app/useAppearance";
import { BranchSyncContext } from "./lib/branchSync";
import { useRepository } from "./app/useRepository";
import { useRepositorySettings } from "./app/useRepositorySettings";
import { useSearch } from "./app/useSearch";
import { useSelection } from "./app/useSelection";
import { useTabs } from "./app/useTabs";
import { useActivityLog, useFolderDrop, useRepositoryWatch, useWindowFocus } from "./app/useWindowEvents";
import { useWorktrees } from "./app/useWorktrees";
import { useZoom } from "./app/window";
import { DEFAULT_COLUMNS } from "./components/CommitList";

/**
 * Tributary's window: the tabs, the open repository (or the start screen), and what opens
 * over them. The state lives in hooks (src/app/use*.ts), the screens in components; this
 * connects them.
 */
export default function App() {
  const preferences = usePreferences();
  const { tabs, setTabs, setActiveTab, firstParentOnly } = preferences;
  const updates = useUpdates(preferences.autoUpdate);
  const theme = useAppearance(preferences.appearance);
  const overlays = useOverlays();
  const openSettings = (section?: string) => {
    setSettingsSection(section);
    overlays.show("settings");
  };
  const menu = useContextMenu();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string) => setToast({ text }), []);
  // Stable, so the message's timer doesn't start over when the app re-renders.
  const hideToast = useCallback(() => setToast(null), []);
  /** The repository dialog that's open (the clone dialog shows on the start screen too). */
  const [dialog, setDialog] = useState<OpenDialog>(null);
  /** The team activity view, over the commit list. */
  const [teamOpen, setTeamOpen] = useState(false);
  const closeTeam = useCallback(() => setTeamOpen(false), []);
  /** A pull request shown over the commit list. */
  const [shownRequest, setShownRequest] = useState<PullRequest | null>(null);
  const closeRequest = useCallback(() => setShownRequest(null), []);
  const showRequest = useCallback((pr: PullRequest) => {
    setTeamOpen(false);
    setShownRequest(pr);
  }, []);
  /** The Settings section to open at (like "Diff and merge"), or the first. */
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);

  // The open repository. Opening one starts fresh, back where you were in it.
  const repo = useRepository({
    setTabs,
    setActiveTab,
    firstParentOnly,
    events: {
      shown: (next, mode) => selection.keep(next, mode),
      opened: (next, place) => {
        details.reset();
        search.clear();
        highlight.clear();
        draft.restore(next.path);
        location.restore(place);
        if (place?.selectedId && next.commits.some((commit) => commit.id === place.selectedId)) selection.setSelectedId(place.selectedId);
      },
      closed: () => {
        selection.clear();
        search.clear();
        highlight.clear();
      },
      notify,
    },
  });
  const { snapshot } = repo;
  const repoPath = snapshot?.path ?? null;
  const selection = useSelection(snapshot?.commits);
  const location = usePlace(snapshot, selection.selectedId);
  const tabbing = useTabs({ tabs, setTabs, snapshot, load: repo.load, close: repo.close, rememberPlace: location.rememberPlace });
  // A tab's "Repository Settings…": once that tab's repository is open.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  useEffect(() => {
    if (settingsFor && snapshot?.path === settingsFor) {
      setSettingsFor(null);
      setDialog({ kind: "repoSettings" });
    }
  }, [settingsFor, snapshot?.path]);
  const tabMenu = (path: string, x: number, y: number) =>
    menu.show(
      x,
      y,
      tabMenuItems({
        path,
        count: tabs.length,
        settings: () => {
          setSettingsFor(path);
          tabbing.switchTab(path);
        },
        reveal: () => revealItemInDir(path).catch((e) => repo.setError({ message: String(e) })),
        close: () => tabbing.closeTab(path),
        closeOthers: () => tabbing.closeOthers(path),
      }),
    );
  const search = useSearch(snapshot?.commits, selection.select, selection.selectedIndex, snapshot?.path ?? null);
  const highlight = useHighlight({
    repoPath,
    commits: snapshot?.commits,
    byId: selection.byId,
    indexById: selection.indexById,
    selectedIndex: selection.selectedIndex,
    select: selection.select,
    user: snapshot?.user ?? null,
    notify,
    whilePicking: repo.whilePicking,
  });
  const draft = useDraft(repoPath);
  const details = useCommitDetails(repoPath, snapshot?.commits);
  const settings = useRepositorySettings(snapshot, repo.refresh);
  const counts = useBranchCounts(snapshot, selection.byId);

  // Around the repository: Git LFS, GitHub, other working trees, changed files.
  const lfs = useLfsLocks(repoPath);
  const lfsHealth = useLfsHealth(snapshot);
  const worktrees = useWorktrees(snapshot);
  const overlaps = useChangedElsewhere(snapshot);
  const prs = usePullRequests(repoPath, Boolean(snapshot?.webRemotes.some((remote) => remote.host === "github" || remote.host === "gitlab")));
  const marks = useMemo(() => bisectMarks(snapshot?.bisect), [snapshot?.bisect]);
  const prLookup = useMemo(() => makeLookup(prs.list, showRequest), [prs.list, showRequest]);
  const localBranches = useMemo(
    () => new Set((snapshot?.commits ?? []).flatMap((commit) => commit.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name))),
    [snapshot?.commits],
  );
  // Profile pictures turned off: forget the ones kept on this computer.
  const picturesOn = preferences.profilePictures;
  const picturesWereOn = useRef(picturesOn);
  useEffect(() => {
    if (picturesWereOn.current && !picturesOn) forgetAvatars().catch(() => {});
    picturesWereOn.current = picturesOn;
  }, [picturesOn]);
  // A big repository without git's speed-ups: offered once.
  useSpeedOffer(snapshot, setToast, () => setDialog({ kind: "repoSettings", section: "Speed" }));
  usePullRequestNews({
    repoPath,
    repoName: snapshot?.name ?? "",
    list: prs.list,
    localBranches,
    notices: preferences.requestNotices,
    notify: setToast,
    open: showRequest,
  });
  // Another repository: its own pull requests.
  useEffect(() => setShownRequest(null), [repoPath]);
  const checks = useFileChecks(snapshot, preferences.largeFileMB);

  const actions = useActions({
    snapshot,
    load: repo.load,
    protectedHead: settings.protectedHead,
    openDialog: setDialog,
    setError: repo.setError,
    notify: setToast,
    blockFocusRefresh: repo.blockFocusRefresh,
    showChanges: () => selection.setSelectedId(WORKTREE_ID),
    after: (action: Action, kind: Running, outcome) => {
      // Locks change when you lock or unlock, and may have changed on the server; a push
      // can open the way for a pull request, and a fetch can bring new ones.
      if (action.kind === "lockFiles" || action.kind === "unlockFiles") lfs.refresh(true);
      else if (kind && kind !== "other" && kind !== "checkout") lfs.refresh();
      if (kind && kind !== "other" && kind !== "checkout") prs.refresh(true);
      if (action.kind === "push" && outcome?.pushedFiles) lockRelease.pushedFiles(outcome.pushedFiles);
      submodules.ran(action);
    },
  });
  const { act, running } = actions;
  useTaskbarProgress(actions.progress);
  const lockRelease = useLockRelease({ snapshot, locks: lfs.locks ? lfs.byPath : null, mode: preferences.releaseLocks, act });
  const submodules = useSubmodules({ snapshot, mode: preferences.submoduleUpdates, act });
  useAutoLock({
    enabled: preferences.autoLock,
    repoPath,
    checks,
    locks: lfs.locks ? lfs.byPath : null,
    busy: running !== null,
    lock: (paths) => act({ kind: "lockFiles", paths }),
  });
  const lockFiles = () =>
    repo.whilePicking(async () => {
      if (!repoPath) return;
      const { paths, outside } = await chooseFilesToLock(repoPath);
      if (outside > 0) repo.setError({ message: "Only files inside this repository can be locked." });
      if (paths.length > 0) await act({ kind: "lockFiles", paths });
    });

  // The latest state, for timers and window events that outlive a render.
  const latest = useRef({ snapshot, dialog, running, refresh: repo.refresh });
  latest.current = { snapshot, dialog, running, refresh: repo.refresh };
  const idle = () => !latest.current.dialog && !latest.current.running;
  const refreshAround = () => {
    lfs.refresh();
    prs.refresh();
  };

  // A folder dropped onto the window opens; a patch file is offered to apply. Coming back to
  // the window picks up changes made elsewhere (a commit in the terminal, an edit in the editor).
  const activity = useActivityLog();
  const dropping = useFolderDrop((path) => {
    if (latest.current.dialog) return;
    if (isPatchFile(path) && latest.current.snapshot && !latest.current.snapshot.bare) setDialog({ kind: "applyPatch", file: path });
    else repo.load(path, "open");
  });
  useWindowFocus(() => {
    if (!latest.current.snapshot || !idle() || repo.blockFocusRefresh.current) return;
    if (Date.now() - repo.lastLoad.current < FOCUS_REFRESH_INTERVAL) return;
    latest.current.refresh();
    refreshAround();
  });
  // Changes made outside the app show at once (while nothing of the app's own is running:
  // its own actions reload when they finish).
  useRepositoryWatch(repoPath ?? null, () => {
    if (!latest.current.snapshot || !idle() || repo.blockFocusRefresh.current) return;
    latest.current.refresh();
  });
  const tabNews = useBackgroundFetch({
    snapshot,
    tabs,
    enabled: preferences.autoFetch,
    minutes: preferences.fetchMinutes,
    notices: preferences.newCommitNotices,
    isBusy: () => !idle(),
    afterFetch: () => {
      if (idle()) latest.current.refresh();
      refreshAround();
    },
    notify: setToast,
    pull: () => act({ kind: "pull" }, "pull"),
    show: (id) => selection.select(id),
    switchTab: tabbing.switchTab,
  });
  // The "only this branch" setting changed: reload.
  const firstParentLoaded = snapshot?.firstParent;
  useEffect(() => {
    if (firstParentLoaded !== undefined && firstParentLoaded !== firstParentOnly) latest.current.refresh();
  }, [firstParentOnly, firstParentLoaded]);
  const zoomBy = useZoom(preferences.zoom, preferences.setZoom);

  // Each recent commit's CI, for the dots in the list.
  const ciStates = useCiStates(snapshot);
  // The editor and terminal "Open in …" uses.
  const openApps = useOpenApps();
  // The menus: in the macOS menu bar, or in the tab bar elsewhere.
  const menuBarContext: MenuBarContext = {
    snapshot,
    running: running !== null,
    head: snapshot?.headCommit ? selection.byId.get(snapshot.headCommit) : undefined,
    preferences,
    hiddenCount: settings.hiddenCount,
    highlightingMine: highlight.highlightingMine,
    teamOpen,
    usesLocks: Boolean(lfs.locks),
    usesLfs: Boolean(checks?.usesLfs),
    lfsPointers: lfsHealth.health?.pointers ?? 0,
    openApps,
    do: {
      open: repo.pick,
      clone: () => setDialog({ kind: "clone" }),
      create: repo.create,
      settings: () => openSettings(),
      palette: () => overlays.show("palette"),
      shortcuts: () => overlays.show("shortcuts"),
      zoom: zoomBy,
      newTab: tabbing.newTab,
      closeTab: tabbing.closeTab,
      search: search.focus,
      showAllBranches: settings.showAllBranches,
      highlightMine: highlight.highlightMine,
      team: () => setTeamOpen((open) => !open),
      resetLayout: () => {
        preferences.setColumnWidths({ refs: null, graph: null });
        preferences.setColumnOptions(DEFAULT_COLUMNS);
        preferences.setSidebarWidth(220);
        preferences.setDetailsWidth(380);
      },
      refresh: repo.refresh,
      act: (action, kind) => act(action, kind ?? "other"),
      dialog: setDialog,
      select: selection.select,
      history: highlight.pickHistory,
      lockFiles,
      reveal: () => repoPath && revealItemInDir(repoPath).catch((e) => repo.setError({ message: String(e) })),
      openIn: (app) => repoPath && openInApp(app.id, repoPath).catch((e) => repo.setError({ message: String(e) })),
      diagnostics: () => overlays.show("diagnostics"),
    },
  };
  const menus = appMenus(menuBarContext);
  useNativeMenu(menus, { settings: () => openSettings() });
  const menuBar = useMenuBar(menus, menu.setMenu);
  const view = menus.find((m) => m.label === "View");
  const viewMenu = view ? menuItems(view.entries.filter((entry) => entry === "-" || !["search", "palette"].includes(entry.id))) : [];

  useKeyboardShortcuts({
    togglePalette: () => overlays.toggle("palette"),
    openSettings: () => openSettings(),
    open: repo.pick,
    newTab: tabbing.newTab,
    closeTab: tabbing.closeCurrent,
    showTab: (index) => tabs[index] && tabbing.switchTab(tabs[index].path),
    cycleTab: tabbing.cycle,
    refresh: repo.refresh,
    focusSearch: search.focus,
    toggleSidebar: () => preferences.setSidebarOpen((open) => !open),
    toggleActivity: () => preferences.setActivityOpen((open) => !open),
    toggleTeam: () => setTeamOpen((open) => !open),
    zoom: zoomBy,
    showShortcuts: () => overlays.show("shortcuts"),
    openMenuBar: menuBar.openFirst,
    // Stop highlighting first, then drop a multiple selection, then close the details.
    escape: () => (highlight.focus ? highlight.clear() : selection.clearStep()),
  });

  /** The command palette: everything, with a repository open; otherwise opening one. */
  const commands = () =>
    (snapshot
      ? paletteCommands({
          menus,
          snapshot,
          tabs,
          canChange: !snapshot.bare && running === null,
          localBranches: counts.localBranches,
          branchLabel: snapshot.headBranch ?? "HEAD",
          focused: highlight.focus !== null,
          preferences,
          run: (action, options) => act(action, "other", options),
          switchTab: tabbing.switchTab,
          setFocus: highlight.setFocus,
          setHidden: settings.setHidden,
          openSettings: () => openSettings(),
          highlightMine: highlight.highlightMine,
        })
      : [...startCommands(menuBarContext), settingsCommand(menuBarContext), ...helpCommandsFor(menuBarContext)].map((c) => ({
          id: c.id,
          label: c.label,
          icon: c.icon,
          shortcut: c.keys && shortcutLabel(c.keys),
          run: c.run,
        })));

  const showTabBar = Boolean(snapshot) || tabs.length > 0 || menuBar.element !== undefined;
  return (
    <ThemeContext.Provider value={theme}>
    <BranchSyncContext.Provider value={counts.aheadBehind}>
    <BisectMarksContext.Provider value={marks}>
    <CiStatesContext.Provider value={ciStates}>
    <ProfilePictures.Provider value={preferences.profilePictures ? repoPath : null}>
      <PullRequestsContext.Provider value={prs.list.length > 0 ? prLookup : null}>
        <div className="app">
          {showTabBar && (
            <TabBar
              tabs={tabs}
              activePath={repoPath}
              startTab={!snapshot && tabbing.startTab}
              onSelect={tabbing.switchTab}
              onClose={tabbing.closeTab}
              onCloseStart={tabbing.closeStartTab}
              onNew={tabbing.newTab}
              onContextMenu={tabMenu}
              menuBar={menuBar.element}
              extra={
                updates.available && (
                  <button className="update-pill" onClick={() => overlays.show("update")} title={`Tributary ${updates.available.version} is available`}>
                    <DownloadIcon size={13} />
                    Update
                  </button>
                )
              }
              news={tabNews}
              busy={
                actions.runningPath && actions.progress?.visible
                  ? { path: actions.runningPath, label: actions.progress.label, percent: overallPercent(actions.progress.value) }
                  : undefined
              }
            />
          )}
          {snapshot ? (
            <RepositoryView
              snapshot={snapshot}
              repo={repo}
              selection={selection}
              search={search}
              highlight={highlight}
              actions={actions}
              settings={settings}
              preferences={preferences}
              counts={counts}
              lfs={lfs}
              lfsHealth={lfsHealth}
              overlaps={overlaps}
              submodules={submodules}
              lockRelease={lockRelease}
              checks={checks}
              worktrees={worktrees}
              details={details}
              draft={draft}
              activity={activity}
              place={location}
              dialog={dialog}
              openDialog={setDialog}
              menu={menu}
              viewMenu={viewMenu}
              openTab={tabbing.switchTab}
              closeTab={tabbing.closeTab}
              lockFiles={lockFiles}
              openSettings={openSettings}
              notify={setToast}
              teamOpen={teamOpen}
              onCloseTeam={closeTeam}
              onToggleTeam={() => setTeamOpen((open) => !open)}
              request={shownRequest}
              onShowRequest={showRequest}
              onCloseRequest={closeRequest}
              onRequestCreated={(pr) => {
                setDialog(null);
                prs.refresh(true);
                const what = pr.forge === "gitlab" ? "merge request" : "pull request";
                setToast({ text: `Opened ${what} ${requestNumber(pr)}`, action: { label: "Show", onClick: () => showRequest(pr) } });
              }}
            />
          ) : (
            <StartView repo={repo} tabBar={showTabBar} onClone={() => setDialog({ kind: "clone" })} />
          )}
          <AppOverlays
            overlays={overlays}
            menu={menu}
            commands={commands}
            preferences={preferences}
            updates={updates}
            repoPath={repoPath}
            settingsSection={settingsSection}
            cloning={dialog?.kind === "clone"}
            onCloneCancel={() => setDialog(null)}
            onCloned={(path) => {
              setDialog(null);
              location.rememberPlace();
              repo.load(path, "open");
            }}
            onSignedIn={() => prs.refresh(true)}
            toast={toast}
            notify={setToast}
            hideToast={hideToast}
            dropping={dropping}
          />
        </div>
      </PullRequestsContext.Provider>
    </ProfilePictures.Provider>
    </CiStatesContext.Provider>
    </BisectMarksContext.Provider>
    </BranchSyncContext.Provider>
    </ThemeContext.Provider>
  );
}
