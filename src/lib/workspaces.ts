// Workspaces: named sets of tabs, one open at a time. The open workspace's tabs are the tab
// bar's (`tabs.list`, as before workspaces); the others' are kept here until you switch to
// them. With one workspace, it's as if there were none.
import type { Tab } from "../components/TabBar";

export interface Workspace {
  id: string;
  name: string;
  /** Which of the graph's lane colours (an index, so it follows the palette chosen). */
  color: number;
  /** Its tabs, while it isn't the open one (the open one's are the tab bar's). */
  tabs: Tab[];
  /** The tab that was open in it when you left it. */
  active: string | null;
}

export interface Workspaces {
  /** The open workspace's id. */
  current: string;
  list: Workspace[];
}

/** Before any are made: one, holding every tab. */
export const FIRST_WORKSPACE: Workspaces = {
  current: "first",
  list: [{ id: "first", name: "My repositories", color: 0, tabs: [], active: null }],
};

/** How many lane colours to choose from (the shortest palette's). */
export const WORKSPACE_COLORS = 12;

/** A stored value that isn't workspaces (or none) read as the first one. */
export function readWorkspaces(value: unknown): Workspaces {
  const stored = value as Partial<Workspaces> | null;
  const list = Array.isArray(stored?.list)
    ? stored.list.filter((each): each is Workspace => typeof each?.id === "string" && typeof each.name === "string" && Array.isArray(each.tabs))
    : [];
  if (list.length === 0) return FIRST_WORKSPACE;
  const current = list.some((each) => each.id === stored?.current) ? stored!.current! : list[0].id;
  return { current, list };
}

export const currentWorkspace = (state: Workspaces): Workspace => state.list.find((each) => each.id === state.current) ?? state.list[0];

/** Each workspace's tabs: the open one's from the tab bar. */
export function tabsOf(state: Workspaces, id: string, openTabs: Tab[]): Tab[] {
  if (id === state.current) return openTabs;
  return state.list.find((each) => each.id === id)?.tabs ?? [];
}

/** Every tab in every workspace, each repository once (the open workspace's first). */
export function everyTab(state: Workspaces, openTabs: Tab[]): Tab[] {
  const seen = new Set<string>();
  const all: Tab[] = [];
  for (const tab of [...openTabs, ...state.list.filter((each) => each.id !== state.current).flatMap((each) => each.tabs)]) {
    if (seen.has(tab.path)) continue;
    seen.add(tab.path);
    all.push(tab);
  }
  return all;
}

/** The workspace a repository is in: the open one when it's there, or else the first that has it. */
export function workspaceOf(state: Workspaces, path: string, openTabs: Tab[]): Workspace | null {
  if (openTabs.some((tab) => tab.path === path)) return currentWorkspace(state);
  return state.list.find((each) => each.id !== state.current && each.tabs.some((tab) => tab.path === path)) ?? null;
}

/**
 * Switching to workspace `id`: the open one keeps its tabs and the tab open in it; the
 * tabs to show, and the one to open (null: the start screen).
 */
export function switchTo(state: Workspaces, id: string, openTabs: Tab[], openPath: string | null): { state: Workspaces; tabs: Tab[]; open: string | null } | null {
  const target = state.list.find((each) => each.id === id);
  if (!target || id === state.current) return null;
  const list = state.list.map((each) => (each.id === state.current ? { ...each, tabs: openTabs, active: openPath } : each.id === id ? { ...each, tabs: [], active: null } : each));
  const open = target.active && target.tabs.some((tab) => tab.path === target.active) ? target.active : (target.tabs[0]?.path ?? null);
  return { state: { current: id, list }, tabs: target.tabs, open };
}

/** A colour no workspace has yet, if one's left. */
export function freeColor(state: Workspaces): number {
  const used = new Set(state.list.map((each) => each.color));
  for (let color = 0; color < WORKSPACE_COLORS; color++) if (!used.has(color)) return color;
  return state.list.length % WORKSPACE_COLORS;
}

/** A new workspace, empty, after the others. */
export function addWorkspace(state: Workspaces, name: string, color: number, id = newId()): { state: Workspaces; id: string } {
  return { state: { ...state, list: [...state.list, { id, name: name.trim(), color, tabs: [], active: null }] }, id };
}

/** Its name and colour changed. */
export function editWorkspace(state: Workspaces, id: string, change: { name?: string; color?: number }): Workspaces {
  const name = change.name?.trim();
  return { ...state, list: state.list.map((each) => (each.id === id ? { ...each, ...(name ? { name } : {}), ...(change.color === undefined ? {} : { color: change.color }) } : each)) };
}

/**
 * Workspace `id` gone: its tabs join the open one, after its own (so nothing you had open is
 * lost). The open one can't go: switch away from it first. Never the last one.
 */
export function removeWorkspace(state: Workspaces, id: string, openTabs: Tab[]): { state: Workspaces; tabs: Tab[] } | null {
  if (id === state.current || state.list.length < 2) return null;
  const gone = state.list.find((each) => each.id === id);
  if (!gone) return null;
  const tabs = [...openTabs, ...gone.tabs.filter((tab) => !openTabs.some((open) => open.path === tab.path))];
  return { state: { ...state, list: state.list.filter((each) => each.id !== id) }, tabs };
}

/** A tab of the open workspace moved into workspace `id`, at its end: what's left open. */
export function moveTab(state: Workspaces, path: string, id: string, openTabs: Tab[]): { state: Workspaces; tabs: Tab[] } | null {
  const tab = openTabs.find((each) => each.path === path);
  if (!tab || id === state.current || !state.list.some((each) => each.id === id)) return null;
  const list = state.list.map((each) => (each.id === id && !each.tabs.some((other) => other.path === path) ? { ...each, tabs: [...each.tabs, tab] } : each));
  return { state: { ...state, list }, tabs: openTabs.filter((each) => each.path !== path) };
}

/** The folder a repository is in, and that folder's name ("~/Projects/game/client" → "game"). */
export function parentFolder(path: string): { folder: string; name: string } {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const folder = cut > 0 ? trimmed.slice(0, cut) : trimmed;
  const nameCut = Math.max(folder.lastIndexOf("/"), folder.lastIndexOf("\\"));
  return { folder, name: folder.slice(nameCut + 1) || folder };
}

export interface FolderGroup {
  name: string;
  tabs: Tab[];
}

/**
 * Workspaces to offer from the folders the open tabs are in: one for each folder that has
 * two or more of them, the rest left where they are. Only when that makes two or more.
 */
export function foldersToGroup(tabs: Tab[]): { groups: FolderGroup[]; rest: Tab[] } | null {
  const byFolder = new Map<string, { name: string; tabs: Tab[] }>();
  for (const tab of tabs) {
    const { folder, name } = parentFolder(tab.path);
    const group = byFolder.get(folder) ?? { name, tabs: [] };
    group.tabs.push(tab);
    byFolder.set(folder, group);
  }
  const groups = [...byFolder.values()].filter((group) => group.tabs.length >= 2);
  const rest = tabs.filter((tab) => !groups.some((group) => group.tabs.includes(tab)));
  if (groups.length + (rest.length > 0 ? 1 : 0) < 2) return null;
  return { groups: groups.map((group) => ({ name: capitalised(group.name), tabs: group.tabs })), rest };
}

/**
 * The open workspace split into the folders' workspaces (`foldersToGroup`). The tabs left
 * over stay in it; if none are, it becomes the first folder's. The open tab's workspace is
 * the open one after.
 */
export function groupByFolder(state: Workspaces, openTabs: Tab[], openPath: string | null): { state: Workspaces; tabs: Tab[] } | null {
  const found = foldersToGroup(openTabs);
  if (!found) return null;
  const current = currentWorkspace(state);
  const groups = [...found.groups];
  // The open workspace keeps the rest, or else takes the first folder's tabs and name.
  const keep = found.rest.length > 0 ? { name: current.name, tabs: found.rest } : groups.shift()!;
  let next: Workspaces = { ...state, list: state.list.map((each) => (each.id === current.id ? { ...each, name: keep.name, tabs: [] } : each)) };
  let tabs = keep.tabs;
  for (const group of groups) {
    const added = addWorkspace(next, group.name, freeColor(next));
    const active = group.tabs.some((tab) => tab.path === openPath) ? openPath : group.tabs[0].path;
    next = { ...added.state, list: added.state.list.map((each) => (each.id === added.id ? { ...each, tabs: group.tabs, active } : each)) };
  }
  // The open repository's workspace is the open one.
  const holder = openPath ? next.list.find((each) => each.id !== next.current && each.tabs.some((tab) => tab.path === openPath)) : null;
  if (holder) {
    const switched = switchTo(next, holder.id, tabs, tabs[0]?.path ?? null);
    if (switched) {
      next = switched.state;
      tabs = switched.tabs;
    }
  }
  return { state: next, tabs };
}

const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;
