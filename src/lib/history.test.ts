import { describe, expect, it } from "vitest";
import type { Action } from "../api";
import { checkFor, KEPT, undoState, withEntry, type HistoryEntry } from "./history";

const entry = (action: Action, undo: Action | null, after = { headBranch: "main", headCommit: "c2" }): HistoryEntry => ({
  id: "1",
  time: 0,
  path: "/repo",
  text: "Did it",
  action,
  undo,
  check: checkFor(action),
  after,
  undone: false,
});
const now = { headBranch: "main", headCommit: "c2", operation: null, remotes: ["origin"] };

describe("action history", () => {
  it("undoes a commit only while the branch is where the commit left it", () => {
    const commit = entry({ kind: "commit", message: "Fix the door", amend: false, noVerify: false } as Action, { kind: "resetSoft", id: "c1" });
    expect(undoState(commit, now).ok).toBe(true);
    const moved = undoState(commit, { ...now, headCommit: "c3" });
    expect(moved.ok).toBe(false);
    expect(moved.why).toMatch(/moved/);
    const switched = undoState(commit, { ...now, headBranch: "dev", headCommit: "c0" });
    expect(switched.why).toMatch(/switched to dev since: switch back to main/);
    expect(undoState({ ...commit, undone: true }, now)).toEqual({ ok: false, why: "Undone" });
  });

  it("checks what each kind of action changed", () => {
    const resolved = entry({ kind: "resolveConflicts", paths: ["a.txt"], keep: "mine" }, { kind: "recreateConflicts", paths: ["a.txt"] });
    expect(undoState(resolved, now).ok).toBe(false);
    expect(undoState(resolved, { ...now, operation: { kind: "merge" } as never }).ok).toBe(true);
    const added = entry({ kind: "addRemote", name: "backup", url: "x" } as Action, { kind: "removeRemote", name: "backup" });
    expect(undoState(added, now).ok).toBe(false);
    expect(undoState(added, { ...now, remotes: ["origin", "backup"] }).ok).toBe(true);
    const deleted = entry({ kind: "deleteBranches", branches: [] } as Action, { kind: "restoreBranches", branches: [] });
    expect(undoState(deleted, { ...now, headCommit: "c9" }).ok).toBe(true);
    expect(undoState(entry({ kind: "fetch" }, null), now)).toEqual({ ok: false, why: "This can't be undone" });
    expect(checkFor({ kind: "stashAndRetry", action: { kind: "addRemote", name: "b", url: "x" }, includeUntracked: false } as Action)).toBe("remote");
  });

  it("keeps the newest", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < KEPT + 5; i++) list = withEntry(list, { ...entry({ kind: "fetch" }, null), id: String(i) });
    expect(list).toHaveLength(KEPT);
    expect(list[0].id).toBe(String(KEPT + 4));
  });
});
