import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { goodChoices } from "./graph";

/** A commit `id` with `parents`, tagged `tag`, made at `time`. */
function commit(id: string, parents: string[], time: number, tag?: string): CommitRow {
  return {
    kind: "commit",
    id,
    parents,
    time,
    summary: `Commit ${id}`,
    refs: tag ? [{ name: tag, kind: "tag", current: false }] : [],
  } as unknown as CommitRow;
}

describe("goodChoices", () => {
  // d (checked out) ← c ← b (v2) ← a (v1), and x (v3) on another branch.
  const commits = [commit("d", ["c"], 4), commit("c", ["b"], 3), commit("b", ["a"], 2, "v2"), commit("a", [], 1, "v1"), commit("x", ["a"], 5, "v3")];
  const byId = new Map(commits.map((each) => [each.id, each]));

  it("offers the tags before the checked-out commit first, newest first, then the commits before it", () => {
    const choices = goodChoices("d", byId);
    expect(choices.map(({ commit, tag }) => `${commit.id}${tag ? `:${tag}` : ""}`)).toEqual(["b:v2", "a:v1", "c"]);
  });

  it("offers nothing for a commit with nothing before it", () => {
    expect(goodChoices("a", byId)).toEqual([]);
  });
});
