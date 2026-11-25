import { describe, expect, it } from "vitest";
import type { Tab } from "../components/TabBar";
import {
  FIRST_WORKSPACE,
  addWorkspace,
  editWorkspace,
  everyTab,
  foldersToGroup,
  freeColor,
  groupByFolder,
  moveTab,
  parentFolder,
  readWorkspaces,
  removeWorkspace,
  switchTo,
  workspaceOf,
  type Workspaces,
} from "./workspaces";

const tab = (path: string): Tab => ({ path, name: path.split("/").pop()! });
const client = tab("/p/game/client");
const server = tab("/p/game/server");
const site = tab("/p/web/site");
const docs = tab("/p/web/docs");
const notes = tab("/home/notes");

/** Game open with client and server; Web kept with site and docs, docs last open there. */
const two: Workspaces = {
  current: "game",
  list: [
    { id: "game", name: "Game", color: 3, tabs: [], active: null },
    { id: "web", name: "Web", color: 0, tabs: [site, docs], active: docs.path },
  ],
};

describe("workspaces", () => {
  it("reads one workspace with every tab when there are none, or the stored ones are broken", () => {
    expect(readWorkspaces(null)).toEqual(FIRST_WORKSPACE);
    expect(readWorkspaces({ current: "x", list: [{ nope: true }] })).toEqual(FIRST_WORKSPACE);
    expect(readWorkspaces({ current: "gone", list: two.list }).current).toBe("game");
    expect(readWorkspaces(two)).toEqual(two);
  });

  it("switches: the open one keeps its tabs and open tab, and the other opens where it was left", () => {
    const switched = switchTo(two, "web", [client, server], server.path)!;
    expect(switched.tabs).toEqual([site, docs]);
    expect(switched.open).toBe(docs.path);
    expect(switched.state.current).toBe("web");
    expect(switched.state.list[0]).toMatchObject({ tabs: [client, server], active: server.path });
    // And back.
    const back = switchTo(switched.state, "game", switched.tabs, site.path)!;
    expect(back.tabs).toEqual([client, server]);
    expect(back.open).toBe(server.path);
    expect(back.state.list[1]).toMatchObject({ tabs: [site, docs], active: site.path });
    // An empty one opens the start screen; the open one and unknown ones aren't switched to.
    const empty = addWorkspace(two, "Art", 5, "art");
    expect(switchTo(empty.state, "art", [client], client.path)).toMatchObject({ tabs: [], open: null });
    expect(switchTo(two, "game", [client], null)).toBeNull();
    expect(switchTo(two, "nope", [client], null)).toBeNull();
  });

  it("knows every tab once, and which workspace a repository is in", () => {
    expect(everyTab(two, [client, site]).map((each) => each.path)).toEqual([client.path, site.path, docs.path]);
    expect(workspaceOf(two, client.path, [client, server])?.id).toBe("game");
    expect(workspaceOf(two, docs.path, [client, server])?.id).toBe("web");
    expect(workspaceOf(two, notes.path, [client, server])).toBeNull();
  });

  it("moves a tab into another workspace, once", () => {
    const moved = moveTab(two, server.path, "web", [client, server])!;
    expect(moved.tabs).toEqual([client]);
    expect(moved.state.list[1].tabs).toEqual([site, docs, server]);
    expect(moveTab(two, site.path, "web", [client, site])!.state.list[1].tabs).toEqual([site, docs]);
    expect(moveTab(two, server.path, "game", [client, server])).toBeNull();
  });

  it("removes a workspace by bringing its tabs into the open one, never the open or the last", () => {
    const removed = removeWorkspace(two, "web", [client, docs])!;
    expect(removed.tabs).toEqual([client, docs, site]);
    expect(removed.state.list.map((each) => each.id)).toEqual(["game"]);
    expect(removeWorkspace(two, "game", [client])).toBeNull();
    expect(removeWorkspace(FIRST_WORKSPACE, "first", [])).toBeNull();
  });

  it("renames and recolours, and picks a colour no workspace has", () => {
    const edited = editWorkspace(two, "web", { name: "  Website ", color: 7 });
    expect(edited.list[1]).toMatchObject({ name: "Website", color: 7 });
    expect(editWorkspace(two, "web", { name: "   " }).list[1].name).toBe("Web");
    expect(freeColor(two)).toBe(1);
  });

  it("finds the folder a repository is in, on Windows too", () => {
    expect(parentFolder("/p/game/client")).toEqual({ folder: "/p/game", name: "game" });
    expect(parentFolder("C:\\Projects\\web\\site\\")).toEqual({ folder: "C:\\Projects\\web", name: "web" });
  });

  it("offers a workspace for each folder with two or more open repositories", () => {
    const found = foldersToGroup([client, site, server, docs, notes])!;
    expect(found.groups).toEqual([
      { name: "Game", tabs: [client, server] },
      { name: "Web", tabs: [site, docs] },
    ]);
    expect(found.rest).toEqual([notes]);
    // Nothing to offer when it would make just one.
    expect(foldersToGroup([client, server])).toBeNull();
    expect(foldersToGroup([client, notes])).toBeNull();
    expect(foldersToGroup([client, server, notes])).not.toBeNull();
  });

  it("groups the open workspace by folder, the open repository's workspace open after", () => {
    const grouped = groupByFolder(FIRST_WORKSPACE, [client, site, server, docs, notes], site.path)!;
    expect(grouped.state.list.map((each) => [each.name, each.tabs.map((one) => one.name)])).toEqual([
      ["My repositories", ["notes"]],
      ["Game", ["client", "server"]],
      ["Web", []],
    ]);
    const web = grouped.state.list[2];
    expect(grouped.state.current).toBe(web.id);
    expect(grouped.tabs).toEqual([site, docs]);
    // Nothing left over: the open workspace takes the first folder's name and tabs.
    const all = groupByFolder(FIRST_WORKSPACE, [client, server, site, docs], client.path)!;
    expect(all.state.list.map((each) => each.name)).toEqual(["Game", "Web"]);
    expect(all.tabs).toEqual([client, server]);
    expect(all.state.current).toBe("first");
  });
});
