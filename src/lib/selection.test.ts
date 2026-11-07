import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { stepThrough } from "./search";
import { NO_SELECTION, selectCommit } from "./selection";

const row = (id: string, kind = "commit") => ({ id, kind, parents: [], refs: [] }) as unknown as CommitRow;
const commits = [row("wt", "worktree"), row("a"), row("b"), row("c"), row("d")];
const indexById = new Map(commits.map((c, i) => [c.id, i]));
const pick = (current: typeof NO_SELECTION, id: string | null, how = {}) => selectCommit(current, id, how, commits, indexById);

describe("selectCommit", () => {
  it("selects one commit and remembers it as the anchor", () => {
    expect(pick(NO_SELECTION, "b")).toEqual({ selectedId: "b", ids: null, anchor: "b" });
  });

  it("selects a range with shift, leaving out the uncommitted changes", () => {
    const fromD = pick(NO_SELECTION, "d");
    expect(pick(fromD, "wt", { extend: true })).toEqual({ selectedId: "wt", ids: null, anchor: "wt" });
    expect(pick(fromD, "b", { extend: true })).toEqual({ selectedId: "b", ids: ["b", "c", "d"], anchor: "d" });
  });

  it("adds and removes commits with ⌘ or Ctrl", () => {
    const two = pick(pick(NO_SELECTION, "a"), "c", { toggle: true });
    expect(two.ids).toEqual(["a", "c"]);
    const back = pick(two, "c", { toggle: true });
    expect(back).toEqual({ selectedId: "a", ids: null, anchor: "c" });
  });

  it("clears the selection but keeps the anchor", () => {
    expect(pick({ selectedId: "a", ids: ["a", "b"], anchor: "a" }, null)).toEqual({ selectedId: null, ids: null, anchor: "a" });
  });
});

describe("stepThrough", () => {
  it("moves to the next or previous index, wrapping around", () => {
    expect(stepThrough([2, 5, 9], -1, 1)).toBe(2);
    expect(stepThrough([2, 5, 9], 5, 1)).toBe(9);
    expect(stepThrough([2, 5, 9], 9, 1)).toBe(2);
    expect(stepThrough([2, 5, 9], 5, -1)).toBe(2);
    expect(stepThrough([2, 5, 9], 2, -1)).toBe(9);
    expect(stepThrough([], 0, 1)).toBeUndefined();
  });
});
