import { fullRefName, type Action, type RepoSnapshot } from "../api";
import type { Command } from "../components/CommandPalette";
import {
  ActivityIcon,
  BranchIcon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  GearIcon,
  MergeIcon,
  RebaseIcon,
  SidebarIcon,
  UserIcon,
  ViewIcon,
} from "../components/Icons";
import { splitRemoteBranch } from "../menus";
import { commandsIn, shortcutLabel } from "./appCommand";
import type { AppMenuDefinition } from "./appMenus";
import type { Focus } from "./constants";
import type { Preferences } from "./usePreferences";

/** What the command palette needs from the app. */
export interface PaletteContext {
  menus: AppMenuDefinition[];
  snapshot: RepoSnapshot;
  tabs: { path: string; name: string }[];
  canChange: boolean;
  /** Local branch names, to know which remote branches can be checked out. */
  localBranches: Set<string>;
  /** The checked-out branch, or "HEAD". */
  branchLabel: string;
  /** Something is highlighted. */
  focused: boolean;
  preferences: Preferences;
  run: (action: Action, options?: { quiet?: boolean }) => void;
  switchTab: (path: string) => void;
  setFocus: (focus: Focus | null) => void;
  setHidden: (names: string[], hidden: boolean) => void;
  openSettings: () => void;
  highlightMine: () => void;
}

/** Everything the command palette can do: the menu bar's commands, plus one for each branch and tab. */
export function paletteCommands(ctx: PaletteContext): Command[] {
  const { menus, snapshot, tabs, canChange, localBranches, branchLabel, preferences } = ctx;
  const { activityOpen, setActivityOpen, sidebarOpen, setSidebarOpen, dense, setDense } = preferences;
  const run = (action: Action, _kind?: string, options?: { quiet?: boolean }) => ctx.run(action, options);
  const list: Command[] = [];
  const seen = new Set<string>();
  const add = (command: Command, enabled = true) => {
    if (!enabled || seen.has(command.id)) return;
    seen.add(command.id);
    list.push(command);
  };
  for (const m of menus) {
    for (const entry of commandsIn(m.entries)) {
      if (entry.enabled === false) continue;
      const label = entry.checked === undefined ? entry.label : `${entry.checked ? "Turn off" : "Turn on"}: ${entry.label}`;
      add({ id: entry.id, label, icon: entry.icon, group: m.label === "Repository" ? "Repository" : m.label === "View" ? "View" : undefined, shortcut: entry.keys && shortcutLabel(entry.keys), run: entry.run });
    }
  }
  for (const tab of tabs) {
    if (tab.path !== snapshot.path) add({ id: `tab:${tab.path}`, label: `Switch to ${tab.name}`, group: "Tab", run: () => ctx.switchTab(tab.path) });
  }
  if (snapshot.worktree && canChange) {
    add({ id: "stage-all", label: "Stage all changes", group: "Changes", run: () => run({ kind: "stageAll" }, "other", { quiet: true }) });
    add({ id: "unstage-all", label: "Unstage all changes", group: "Changes", run: () => run({ kind: "unstageAll" }, "other", { quiet: true }) });
  }
  if (snapshot.operation && snapshot.operation.kind !== "other" && canChange) {
    add({ id: "continue", label: `Continue the ${snapshot.operation.kind}`, group: "In progress", run: () => run({ kind: "continueOperation" }) });
    add({ id: "abort", label: `Abort the ${snapshot.operation.kind}`, group: "In progress", run: () => run({ kind: "abortOperation" }) });
  }
  for (const commit of snapshot.commits) {
    for (const ref of commit.refs) {
      if (ref.kind === "branch" && !ref.current && canChange) {
        add({ id: `checkout:${ref.name}`, label: `Check out ${ref.name}`, icon: <BranchIcon />, group: "Branch", run: () => run({ kind: "checkoutBranch", name: ref.name }) });
      }
      if (ref.kind === "remote" && canChange) {
        const { branch } = splitRemoteBranch(ref.name, snapshot.remotes);
        if (!localBranches.has(branch)) {
          add({ id: `track:${ref.name}`, label: `Check out ${branch} (tracking ${ref.name})`, icon: <CloudIcon />, group: "Branch", run: () => run({ kind: "checkoutRemoteBranch", name: ref.name }) });
        }
      }
      if ((ref.kind === "branch" || ref.kind === "remote" || ref.kind === "tag") && !ref.current) {
        if (canChange && snapshot.headBranch && !snapshot.operation) {
          add({ id: `merge:${ref.name}`, label: `Merge ${ref.name} into ${branchLabel}`, icon: <MergeIcon />, group: "Branch", run: () => run({ kind: "merge", target: ref.name }) });
          add({ id: `rebase:${ref.name}`, label: `Rebase ${branchLabel} onto ${ref.name}`, icon: <RebaseIcon />, group: "Branch", run: () => run({ kind: "rebase", onto: ref.name }) });
        }
        add({ id: `focus:${ref.name}`, label: `Highlight ${ref.name}'s history`, icon: <EyeIcon />, group: "View", run: () => ctx.setFocus({ kind: "history", name: ref.name, commitId: commit.id }) });
        const name = fullRefName(ref);
        if (name) add({ id: `hide:${name}`, label: `Hide ${ref.name}`, icon: <EyeOffIcon />, group: "View", run: () => ctx.setHidden([name], true) });
      }
    }
  }
  for (const ref of snapshot.hiddenRefs) {
    const name = fullRefName(ref);
    if (name) add({ id: `show:${name}`, label: `Show ${ref.name}`, icon: <EyeIcon />, group: "View", run: () => ctx.setHidden([name], false) });
  }
  add({ id: "settings", label: "Settings…", icon: <GearIcon />, shortcut: shortcutLabel("CmdOrCtrl+,"), run: ctx.openSettings });
  if (ctx.focused) add({ id: "unfocus", label: "Stop highlighting", icon: <EyeIcon />, group: "View", run: () => ctx.setFocus(null) });
  add({ id: "activity", label: activityOpen ? "Hide activity" : "Show activity", icon: <ActivityIcon />, group: "View", run: () => setActivityOpen(!activityOpen) });
  add({ id: "mine", label: "Highlight my commits", icon: <UserIcon />, group: "View", run: ctx.highlightMine }, Boolean(snapshot.user));
  add({ id: "sidebar", label: sidebarOpen ? "Hide branches sidebar" : "Show branches sidebar", icon: <SidebarIcon />, group: "View", run: () => setSidebarOpen(!sidebarOpen) });
  add({ id: "dense", label: dense ? "Normal rows" : "Compact rows", icon: <ViewIcon />, group: "View", run: () => setDense(!dense) });
  return list;
}
