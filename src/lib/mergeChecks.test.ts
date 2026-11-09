import { describe, expect, it } from "vitest";
import type { MergeCheck } from "../api";
import { conflictList, describeMergeCheck } from "./mergeChecks";

const check = (outcome: MergeCheck["outcome"], conflicts: string[] = [], incoming = 3, outgoing = 2): MergeCheck => ({
  outcome,
  conflicts,
  conflictCount: conflicts.length,
  incoming,
  outgoing,
});

describe("merge checks", () => {
  it("says how a merge or a rebase would go", () => {
    expect(describeMergeCheck(check("clean"), "merge")).toEqual({ text: "3 commits, no conflicts", tone: "good" });
    expect(describeMergeCheck(check("clean"), "rebase")?.text).toBe("2 commits to replay, no conflicts expected");
    expect(describeMergeCheck(check("fastForward", [], 1, 0), "merge")?.text).toBe("Moves forward 1 commit: no conflicts");
    expect(describeMergeCheck(check("upToDate", [], 0), "merge")?.tone).toBe("quiet");
    expect(describeMergeCheck(check("unknown"), "merge")).toBeNull();
  });

  it("names the first conflicting file and counts the rest", () => {
    expect(describeMergeCheck(check("conflicts", ["Content/Hero.uasset"]), "merge")?.text).toBe("Conflicts in Hero.uasset");
    expect(describeMergeCheck(check("conflicts", ["a/b.txt", "c.txt", "d.txt"]), "rebase")).toEqual({
      text: "May stop at conflicts in b.txt and 2 more files",
      tone: "bad",
    });
  });

  it("lists the files for a tooltip", () => {
    const many = Array.from({ length: 14 }, (_, i) => `f${i}.txt`);
    const list = conflictList(check("conflicts", many)).split("\n");
    expect(list).toHaveLength(13);
    expect(list[list.length - 1]).toBe("and 2 more files");
  });
});
