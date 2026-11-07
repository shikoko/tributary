import { describe, expect, it } from "vitest";
import type { CommitRow, RepoSnapshot } from "../api";
import { describeNews, findNews, remoteTips, watchedBranches } from "./news";

function row(id: string, parents: string[], author: string, remote?: string): CommitRow {
  return {
    id,
    kind: "commit",
    parents,
    authorName: author,
    refs: remote ? [{ name: remote, kind: "remote", current: false }] : [],
  } as unknown as CommitRow;
}

function snapshot(commits: CommitRow[], upstream = "origin/feat/menu"): RepoSnapshot {
  return {
    commits,
    hiddenRefs: [],
    remotes: ["origin"],
    upstream: { name: upstream, commit: null },
  } as unknown as RepoSnapshot;
}

describe("findNews", () => {
  const base = [row("b", ["a"], "Maya Chen", "origin/main"), row("a", [], "Maya Chen")];
  const before = snapshot(base);
  const known = new Set(before.commits.map((commit) => commit.id));

  it("watches main and the branch yours tracks", () => {
    expect(watchedBranches(before)).toContain("origin/feat/menu");
    expect(watchedBranches(before)).toContain("origin/main");
  });

  it("finds commits that arrived on main, with who wrote them", () => {
    const after = snapshot([
      row("e", ["d"], "Rosa Bell", "origin/main"),
      row("d", ["c"], "Theo Park"),
      row("c", ["b"], "Rosa Bell"),
      ...base.map((commit) => ({ ...commit, refs: [] })),
    ]);
    const news = findNews(remoteTips(before), known, after);
    expect(news).toEqual([{ branch: "origin/main", tip: "e", count: 3, authors: ["Rosa Bell", "Theo Park"] }]);
    expect(describeNews(news[0])).toBe("3 new commits on origin/main from Rosa Bell and Theo Park");
  });

  it("doesn't count commits that were already here, like your own push", () => {
    const local = [row("c", ["b"], "Maya Chen"), ...base];
    const pushed = snapshot([{ ...local[0], refs: [{ name: "origin/main", kind: "remote", current: false }] }, ...base.map((c) => ({ ...c, refs: [] }))]);
    expect(findNews(remoteTips(snapshot(local)), new Set(local.map((c) => c.id)), pushed)).toEqual([]);
  });

  it("says a new commit, and sums up many authors", () => {
    expect(describeNews({ branch: "origin/main", tip: "x", count: 1, authors: ["Rosa Bell"] })).toBe(
      "A new commit on origin/main from Rosa Bell",
    );
    expect(describeNews({ branch: "origin/main", tip: "x", count: 9, authors: ["A", "B", "C", "D"] })).toBe(
      "9 new commits on origin/main from A, B and 2 more",
    );
  });
});
