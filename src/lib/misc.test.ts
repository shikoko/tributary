import { describe, expect, it } from "vitest";
import type { CommitRow, RefLabel } from "../api";
import { hookFailure, involvesUntrackedFiles, isLocalChangesError, isNotMergedError } from "./errors";
import { ancestors, countMissing } from "./graph";
import { refPills } from "./refs";
import { findMatches } from "./search";

const commit = (id: string, parents: string[], extra: Partial<CommitRow> = {}) =>
  ({ id, kind: "commit", parents, summary: "", authorName: "", authorEmail: "", refs: [], ...extra }) as CommitRow;

describe("graph", () => {
  it("walks a commit's history", () => {
    const byId = new Map([commit("c", ["b", "x"]), commit("b", ["a"]), commit("a", []), commit("x", ["a"])].map((c) => [c.id, c]));
    expect([...ancestors("c", byId)].sort()).toEqual(["a", "b", "c", "x"]);
    expect(ancestors(null, byId).size).toBe(0);
    expect(countMissing(ancestors("c", byId), ancestors("b", byId))).toBe(2);
  });
});

describe("refPills", () => {
  it("shows a local branch and its remote copy at the same commit as one label", () => {
    const refs: RefLabel[] = [
      { name: "origin/main", kind: "remote", current: false },
      { name: "main", kind: "branch", current: true },
      { name: "origin/feat/x", kind: "remote", current: false },
      { name: "v1.0", kind: "tag", current: false },
    ];
    expect(refPills(refs).map((pill) => [pill.name, pill.remotes])).toEqual([
      ["main", ["origin"]],
      ["origin/feat/x", ["origin"]],
      ["v1.0", []],
    ]);
  });
});

describe("findMatches", () => {
  const commits = [
    commit("a1b2c3d4", [], { summary: "Light the tavern", authorName: "Rosa Bell" }),
    commit("ffff0000", [], { summary: "Seat guests", authorEmail: "theo@example.com" }),
    commit("worktree", [], { kind: "worktree", summary: "tavern" } as Partial<CommitRow>),
  ];
  it("matches messages, authors and the start of a SHA", () => {
    expect(findMatches(commits, "TAVERN")).toEqual([0]);
    expect(findMatches(commits, "theo@")).toEqual([1]);
    expect(findMatches(commits, "a1b2")).toEqual([0]);
    expect(findMatches(commits, "  ")).toEqual([]);
  });
});

describe("errors", () => {
  it("recognizes git's messages", () => {
    expect(isLocalChangesError("error: Your local changes to the following files would be overwritten by checkout")).toBe(true);
    expect(involvesUntrackedFiles("The following untracked working tree files would be overwritten")).toBe(true);
    expect(isNotMergedError("error: the branch 'x' is not fully merged.")).toBe(true);
    expect(isLocalChangesError("fatal: not a git repository")).toBe(false);
  });
});

describe("hook failures", () => {
  it("reads which hook stopped what, and its output", () => {
    expect(hookFailure("The pre-commit hook stopped the commit.\n\nlint: 2 problems\nin a.txt")).toEqual({
      hook: "pre-commit",
      what: "commit",
      output: "lint: 2 problems\nin a.txt",
    });
    expect(hookFailure("The pre-push hook stopped the push.")?.output).toBe("");
    expect(hookFailure("fatal: not a git repository")).toBeNull();
  });
});
