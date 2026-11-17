import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { findRefMatches, searchPrefix } from "./search";

const commit = (id: string, refs: [string, string][]): CommitRow => ({ kind: "commit", id, refs: refs.map(([name, kind]) => ({ name, kind, current: false })) }) as unknown as CommitRow;

describe("searchPrefix", () => {
  it("reads the kind to search from a prefix, and keeps the rest", () => {
    expect(searchPrefix("author:maya")).toEqual({ mode: "authors", rest: "maya" });
    expect(searchPrefix("Tag: v0.2")).toEqual({ mode: "refs", rest: "v0.2" });
    expect(searchPrefix("branch:feature/")).toEqual({ mode: "refs", rest: "feature/" });
    expect(searchPrefix("hash:35e1")).toEqual({ mode: "hashes", rest: "35e1" });
    expect(searchPrefix("file:*.psd")).toEqual({ mode: "files", rest: "*.psd" });
    expect(searchPrefix("code: PAGE_SIZE")).toEqual({ mode: "code", rest: "PAGE_SIZE" });
    expect(searchPrefix("message:fix")).toEqual({ mode: "messages", rest: "fix" });
  });

  it("leaves words that aren't a prefix alone", () => {
    expect(searchPrefix("fix: the counter")).toBeNull();
    expect(searchPrefix("export")).toBeNull();
  });
});

describe("findRefMatches", () => {
  it("finds the commits with a branch or tag by name, ignoring case, but not stashes", () => {
    const commits = [commit("a", [["feature/Export", "branch"]]), commit("b", [["v0.2.0", "tag"]]), commit("c", [["stash@{0}", "stash"]]), commit("d", [["origin/feature/export", "remote"]])];
    expect(findRefMatches(commits, "export")).toEqual([0, 3]);
    expect(findRefMatches(commits, "V0.2")).toEqual([1]);
    expect(findRefMatches(commits, "stash")).toEqual([]);
  });
});
