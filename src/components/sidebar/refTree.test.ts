import { describe, expect, it } from "vitest";
import type { RefEntry } from "../../lib/refs";
import { group, stashLabel } from "./refTree";

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
