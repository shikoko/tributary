import type { Action, CommitRow, RepoSnapshot } from "../api";
import { WORKTREE_ID } from "../api";
import {
  BranchIcon,
  BroomIcon,
  CloneIcon,
  CloseIcon,
  ExternalLinkIcon,
  FetchIcon,
  FileHistoryIcon,
  FolderIcon,
  GearIcon,
  HistoryIcon,
  KeyboardIcon,
  LockIcon,
  NewRepoIcon,
  PlusIcon,
  PullIcon,
  PullRequestIcon,
  PushIcon,
  RecoverIcon,
  RefreshIcon,
  SearchIcon,
  StashIcon,
  TagIcon,
} from "../components/Icons";
import type { NativeMenu } from "../lib/nativeMenu";
import { isMac } from "../lib/platform";
import { newPullRequestUrl, openInBrowser, siteName, webRemote } from "../lib/weblinks";
import { splitRemoteBranch, type OpenDialog } from "../menus";
import type { AppCommand, MenuEntry } from "./appCommand";
import type { RemoteAction } from "../components/Toolbar";
import type { Preferences } from "./usePreferences";

/** One menu of the menu bar. */
export interface AppMenuDefinition {
  label: string;
  entries: MenuEntry[];
}

/** What the menu bar needs from the app. */
export interface MenuBarContext {
  /** The open repository, if any. */
  snapshot: RepoSnapshot | null;
  /** Something is running, so the repository can't be changed now. */
  running: boolean;
  /** The checked-out commit, if it's loaded. */
  head: CommitRow | undefined;
  preferences: Preferences;
  /** Branches hidden from the graph (or, while soloing, shown). */
  hiddenCount: number;
  highlightingMine: boolean;
  /** Whether the repository uses Git LFS locking, and Git LFS at all. */
  usesLocks: boolean;
  usesLfs: boolean;
  do: {
    open: () => void;
    clone: () => void;
    create: () => void;
    settings: () => void;
    palette: () => void;
    shortcuts: () => void;
    zoom: (step: 1 | -1 | 0) => void;
    newTab: () => void;
    closeTab: (path: string) => void;
    search: () => void;
    showAllBranches: () => void;
    highlightMine: () => void;
    resetLayout: () => void;
    refresh: () => void;
    act: (action: Action, kind?: RemoteAction) => void;
    dialog: (dialog: OpenDialog) => void;
    select: (id: string) => void;
    history: (directory: boolean) => void;
    lockFiles: () => void;
    reveal: () => void;
  };
}

/** The Settings… command: in the app menu on macOS, at the end of the File menu elsewhere. */
export function settingsCommand(ctx: MenuBarContext): AppCommand {
  return { id: "settings", label: "Settings…", icon: <GearIcon />, keys: "CmdOrCtrl+,", run: ctx.do.settings };
}

/** Open, clone or create a repository: there with or without one open. */
export function startCommands(ctx: MenuBarContext): AppCommand[] {
  return [
    { id: "open", label: "Open Repository…", icon: <FolderIcon />, keys: "CmdOrCtrl+O", run: ctx.do.open },
    { id: "clone", label: "Clone Repository…", icon: <CloneIcon />, run: ctx.do.clone },
    { id: "init", label: "New Repository…", icon: <NewRepoIcon />, run: ctx.do.create },
  ];
}

/** The command palette and the list of keyboard shortcuts. */
export function helpCommandsFor(ctx: MenuBarContext): AppCommand[] {
  return [
    { id: "palette", label: "Command Palette", icon: <SearchIcon />, keys: "CmdOrCtrl+K", run: ctx.do.palette },
    { id: "shortcuts", label: "Keyboard Shortcuts", icon: <KeyboardIcon />, run: ctx.do.shortcuts },
  ];
}

/** File, View, Repository and Help, with every command and its shortcut. */
export function appMenus(ctx: MenuBarContext): AppMenuDefinition[] {
  const { snapshot, preferences } = ctx;
  const { previews, setPreviews, profilePictures, setProfilePictures, fetchMinutes, autoFetch, setAutoFetch } = preferences;
  const { reopenTabs, setReopenTabs, zoom, sidebarOpen, setSidebarOpen, activityOpen, setActivityOpen } = preferences;
  const { firstParentOnly, setFirstParentOnly, daySeparators, setDaySeparators, dense, setDense } = preferences;
  const run = ctx.do;
  const fileCommands = startCommands(ctx);
  const settings = settingsCommand(ctx);
  const helpCommands = helpCommandsFor(ctx);
  const zoomCommands: AppCommand[] = [
    { id: "zoom-in", label: "Zoom In", keys: "CmdOrCtrl+=", run: () => run.zoom(1) },
    { id: "zoom-out", label: "Zoom Out", keys: "CmdOrCtrl+-", run: () => run.zoom(-1) },
    { id: "zoom-reset", label: `Actual Size (now ${Math.round(zoom * 100)}%)`, keys: "CmdOrCtrl+0", run: () => run.zoom(0) },
  ];
  const settingCommands: AppCommand[] = [
    { id: "previews", label: "Previews on Hover", checked: previews, run: () => setPreviews(!previews) },
    { id: "pictures", label: "Profile Pictures (Gravatar, GitHub)", checked: profilePictures, run: () => setProfilePictures(!profilePictures) },
    { id: "auto-fetch", label: `Fetch Every ${fetchMinutes === 1 ? "Minute" : `${fetchMinutes} Minutes`}`, checked: autoFetch, run: () => setAutoFetch(!autoFetch) },
    { id: "reopen", label: "Reopen Tabs on Launch", checked: reopenTabs, run: () => setReopenTabs(!reopenTabs) },
  ];

  /** The menu bar: on macOS the system's own, elsewhere one in the tab bar. */
  const menus = (): AppMenuDefinition[] => {
    if (!snapshot) {
      return [
        { label: "File", entries: [...fileCommands, ...(isMac ? [] : ["-" as const, settings])] },
        { label: "View", entries: [...settingCommands, "-", ...zoomCommands] },
        { label: "Help", entries: helpCommands },
      ];
    }
    const hasRemotes = snapshot.remotes.length > 0 && !snapshot.bare;
    const canChange = !snapshot.bare && !ctx.running;
    const remote = webRemote(snapshot);
    const prUrl = remote && snapshot.headBranch && snapshot.upstream ? newPullRequestUrl(remote, splitRemoteBranch(snapshot.upstream.name, snapshot.remotes).branch) : null;
    const head = ctx.head;
    return [
      {
        label: "File",
        entries: [
          { id: "new-tab", label: "New Tab", keys: "CmdOrCtrl+T", icon: <PlusIcon />, run: run.newTab },
          ...fileCommands,
          "-",
          { id: "close-tab", label: "Close Tab", keys: "CmdOrCtrl+W", icon: <CloseIcon />, run: () => run.closeTab(snapshot.path) },
          ...(isMac ? [] : ["-" as const, settings]),
        ],
      },
      {
        label: "View",
        entries: [
          { id: "search", label: "Search Commits", keys: "CmdOrCtrl+F", icon: <SearchIcon />, run: run.search },
          helpCommands[0],
          "-",
          { id: "sidebar", label: "Branches Sidebar", keys: "CmdOrCtrl+B", checked: sidebarOpen, run: () => setSidebarOpen(!sidebarOpen) },
          { id: "activity", label: "Activity", keys: "CmdOrCtrl+Shift+L", checked: activityOpen, run: () => setActivityOpen(!activityOpen) },
          "-",
          { id: "first-parent", label: `Only ${snapshot.headBranch ?? "HEAD"}'s Own History`, checked: firstParentOnly, run: () => setFirstParentOnly(!firstParentOnly) },
          { id: "show-all", label: "Show All Branches", enabled: ctx.hiddenCount > 0, run: run.showAllBranches },
          { id: "mine", label: "Highlight My Commits", checked: ctx.highlightingMine, enabled: Boolean(snapshot.user), run: run.highlightMine },
          "-",
          { id: "day-separators", label: "Day Separators", checked: daySeparators, run: () => setDaySeparators(!daySeparators) },
          { id: "dense", label: "Compact Rows", checked: dense, run: () => setDense(!dense) },
          ...settingCommands.slice(0, 2),
          "-",
          ...zoomCommands,
          "-",
          { id: "reset-layout", label: "Reset Column and Panel Sizes", run: run.resetLayout },
        ],
      },
      {
        label: "Repository",
        entries: [
          { id: "refresh", label: "Refresh", keys: "CmdOrCtrl+R", icon: <RefreshIcon />, run: run.refresh },
          { id: "fetch", label: "Fetch", icon: <FetchIcon />, enabled: hasRemotes && canChange, run: () => run.act({ kind: "fetch" }, "fetch") },
          { id: "pull", label: "Pull", icon: <PullIcon />, enabled: hasRemotes && canChange && Boolean(snapshot.upstream), run: () => run.act({ kind: "pull" }, "pull") },
          { id: "push", label: "Push", icon: <PushIcon />, enabled: hasRemotes && canChange && Boolean(snapshot.headBranch), run: () => run.act({ kind: "push", force: false }, "push") },
          { id: "force-push", label: "Force Push…", icon: <PushIcon />, danger: true, enabled: hasRemotes && canChange && Boolean(snapshot.headBranch), run: () => run.dialog({ kind: "forcePush" }) },
          "-",
          { id: "commit", label: "Commit…", icon: <PlusIcon />, enabled: Boolean(snapshot.worktree) && canChange, run: () => run.select(WORKTREE_ID) },
          { id: "stash", label: "Stash Changes…", icon: <StashIcon />, enabled: Boolean(snapshot.worktree) && canChange, run: () => run.dialog({ kind: "stash" }) },
          "-",
          { id: "new-branch", label: "New Branch…", icon: <BranchIcon />, enabled: Boolean(head) && canChange, run: () => head && run.dialog({ kind: "newBranch", target: head }) },
          { id: "new-tag", label: "New Tag…", icon: <TagIcon />, enabled: Boolean(head) && canChange, run: () => head && run.dialog({ kind: "tag", target: head }) },
          { id: "prune", label: "Prune Branches…", icon: <BroomIcon />, enabled: canChange, run: () => run.dialog({ kind: "prune" }) },
          { id: "restore", label: "Restore Branch…", icon: <HistoryIcon />, enabled: canChange, run: () => run.dialog({ kind: "restore" }) },
          "-",
          { id: "file-history", label: "File History…", icon: <FileHistoryIcon />, run: () => run.history(false) },
          { id: "folder-history", label: "Folder History…", icon: <FolderIcon />, run: () => run.history(true) },
          ...(ctx.usesLocks ? [{ id: "lock-files", label: "Lock Files…", icon: <LockIcon />, enabled: canChange, run: run.lockFiles }] : []),
          ...(ctx.usesLocks || ctx.usesLfs
            ? [{ id: "prune-lfs", label: "Clean Up Git LFS Files…", icon: <BroomIcon />, enabled: canChange, run: () => run.dialog({ kind: "pruneLfs" }) }]
            : []),
          { id: "recover", label: "Recover Commits…", icon: <RecoverIcon />, run: () => run.dialog({ kind: "recover" }) },
          "-",
          ...(remote
            ? [
                { id: "open-web", label: `Open on ${siteName(remote)}`, icon: <ExternalLinkIcon />, run: () => openInBrowser(remote.url) },
                ...(prUrl
                  ? [{ id: "pull-request", label: remote.host === "gitlab" ? "Create Merge Request…" : "Create Pull Request…", icon: <PullRequestIcon />, run: () => openInBrowser(prUrl) }]
                  : []),
              ]
            : []),
          { id: "reveal", label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, run: run.reveal },
          "-",
          settingCommands[2],
        ],
      },
      { label: "Help", entries: [...helpCommands, "-", settingCommands[3]] },
    ];
  };
  return menus();
}

/** The menus as macOS shows them: the app menu first, Edit after File and Window before Help. */
export function nativeMenusFor(menus: AppMenuDefinition[]): NativeMenu[] {
  return [
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
      if (index === 0) {
        return [menu, { label: "Edit", items: [{ system: "Undo" }, { system: "Redo" }, { system: "Separator" }, { system: "Cut" }, { system: "Copy" }, { system: "Paste" }, { system: "SelectAll" }] }];
      }
      if (m.label === "Help") return [{ label: "Window", items: [{ system: "Minimize" }, { system: "Maximize" }, { system: "Fullscreen" }] }, menu];
      return [menu];
    }),
  ];
}
