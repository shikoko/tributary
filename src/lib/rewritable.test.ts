import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { rewritable } from "./graph";

const onBranch = { headBranch: "main", headCommit: "c3" };
const detached = { headBranch: null, headCommit: "c3" };

describe("rewritable", () => {
  const commit = (id: string, parents: string[]) => ({ id, kind: "commit", parents, summary: id, refs: [] }) as unknown as CommitRow;
  const commits = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];
  const byId = new Map(commits.map((c) => [c.id, c]));
  const history = new Set(["c3", "c2", "c1"]);

  it("lists the commits after one on the checked-out branch", () => {
    expect((rewritable(commits[2], { ...onBranch, commits }, history, byId) as CommitRow[]).map((c) => c.id)).toEqual(["c3", "c2"]);
  });

  it("says why it can't", () => {
    expect(rewritable(commits[2], { ...detached, commits }, history, byId)).toBe("check out a branch first");
    expect(rewritable(commits[0], { ...onBranch, commits }, history, byId)).toBe("main has nothing after this commit");
    expect(rewritable(commit("x", []), { ...onBranch, commits }, history, byId)).toBe("not part of main");
  });
});
