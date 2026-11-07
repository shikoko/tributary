import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { rewritable } from "./graph";
import { undoFor } from "./undo";

const onBranch = { headBranch: "main", headCommit: "c3" };
const detached = { headBranch: null, headCommit: "c3" };

describe("undoFor", () => {
  it("goes back to where HEAD was after a checkout", () => {
    expect(undoFor({ kind: "checkoutBranch", name: "feat" }, onBranch)).toEqual({ kind: "checkoutBranch", name: "main" });
    expect(undoFor({ kind: "checkoutBranch", name: "feat" }, detached)).toEqual({ kind: "checkoutCommit", id: "c3" });
  });

  it("resets after history changes, and keeps the changes after a commit", () => {
    expect(undoFor({ kind: "rebase", onto: "x" }, onBranch)).toEqual({ kind: "resetHard", id: "c3" });
    expect(undoFor({ kind: "commit", message: "s", amend: false }, onBranch)).toEqual({ kind: "resetSoft", id: "c3" });
  });

  it("undoes stash-and-retry the same way, but not a commit", () => {
    const retried = { kind: "stashAndRetry", action: { kind: "checkoutBranch", name: "feat" }, includeUntracked: true } as const;
    expect(undoFor(retried, onBranch)).toEqual({ kind: "stashAndRetry", action: { kind: "checkoutBranch", name: "main" }, includeUntracked: true });
    const commit = { kind: "stashAndRetry", action: { kind: "commit", message: "s", amend: false }, includeUntracked: false } as const;
    expect(undoFor(commit, onBranch)).toBeNull();
  });

  it("has nothing for actions it can't undo", () => {
    expect(undoFor({ kind: "fetch" }, onBranch)).toBeNull();
  });
});

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
