import { describe, expect, it } from "vitest";
import type { RefEntry } from "../../lib/refs";
import { branchCount, branchGroups, group, shortName, stashLabel } from "./refTree";

const entry = (name: string): RefEntry => ({ kind: "branch", name, commitId: "c", current: false, summary: "" });
const grouped = (...names: string[]) => group(names.map((name) => ({ entry: entry(name), label: name })));

describe("group", () => {
  it("puts names that share a prefix in folders, and leaves lone ones", () => {
    const nodes = grouped("main", "feature/a", "feature/b", "fix/c");
    expect(nodes.map((node) => (node.kind === "folder" ? `${node.name}/ (${node.count})` : node.label))).toEqual(["main", "feature/ (2)", "fix/c"]);
  });

  it("nests folders, labelling entries by what's left", () => {
    const [folder] = grouped("team/ui/x", "team/ui/y", "team/api");
    expect(folder.kind).toBe("folder");
    if (folder.kind !== "folder") return;
    expect(folder.path).toBe("team/");
    const labels = folder.children.map((node) => (node.kind === "folder" ? `${node.path}` : node.label));
    expect(labels).toEqual(["team/ui/", "api"]);
  });
});

describe("stashLabel", () => {
  it("drops git's prefix", () => {
    expect(stashLabel({ ...entry("stash@{0}"), kind: "stash", summary: "On main: Try a sidebar" })).toBe("Try a sidebar");
    expect(stashLabel({ ...entry("stash@{1}"), kind: "stash", summary: "WIP on main: abc123 Thing" })).toBe("abc123 Thing");
  });
});

describe("branchGroups", () => {
  const remote = (name: string): RefEntry => ({ ...entry(name), kind: "remote" });
  const names = (entries: RefEntry[]) => entries.map((each) => each.name);
  const branches = [
    entry("feat/barbershop"),
    { ...entry("feat/world-build-tools"), current: true },
    entry("main"),
    { ...entry("lantern"), upstream: "origin/maya/lantern" },
    entry("sketch"),
  ];
  const remotes = new Map([
    ["origin", ["origin/HEAD", "origin/feat/barbershop", "origin/feat/world-build-tools", "origin/main", "origin/maya/lantern", "origin/spike/fox"].map(remote)],
    ["upstream", ["upstream/main", "upstream/release"].map(remote)],
  ]);
  const groups = branchGroups(branches, remotes, ["main", "develop"]);

  it("puts the checked-out branch, then the protected ones, at the top", () => {
    expect(names(groups.top)).toEqual(["feat/world-build-tools", "main"]);
    expect(names(groups.rest)).toEqual(["feat/barbershop", "lantern", "sketch"]);
  });

  it("lists a local branch once, with its copies on remotes", () => {
    expect(groups.copies.get("main")).toEqual(["origin", "upstream"]);
    expect(groups.copies.get("feat/barbershop")).toEqual(["origin"]);
  });

  it("leaves out remote branches that a local branch tracks or shares a name with", () => {
    expect(groups.remoteOnly.map(([name, entries]) => [name, names(entries)])).toEqual([
      ["origin", ["origin/spike/fox"]],
      ["upstream", ["upstream/release"]],
    ]);
  });

  it("knows which branches are only on this computer", () => {
    expect([...groups.localOnly]).toEqual(["sketch"]);
  });
});

describe("shortName", () => {
  const branches = ["feat/world-build-tools", "feat/barbershop", "maya/barbershop", "main"].map(entry);

  it("is a branch's last part", () => {
    expect(shortName(branches[0], branches)).toBe("world-build-tools");
    expect(shortName(branches[3], branches)).toBe("main");
  });

  it("is the whole name when another branch ends the same way", () => {
    expect(shortName(branches[1], branches)).toBe("feat/barbershop");
  });
});

describe("branchCount", () => {
  it("counts a branch and its copies on remotes once", () => {
    expect(branchCount(["refs/heads/main", "refs/remotes/origin/main", "refs/remotes/upstream/main", "refs/heads/sketch"], ["origin", "upstream"])).toBe(2);
  });

  it("tells a remote's name from a folder", () => {
    expect(branchCount(["refs/remotes/origin/feat/a", "refs/heads/origin/feat/a"], ["origin"])).toBe(2);
    expect(branchCount([], ["origin"])).toBe(0);
  });
});
