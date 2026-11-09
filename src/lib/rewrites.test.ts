import { describe, expect, it } from "vitest";
import type { BranchVersion } from "../api";
import { beforeLatestRewrite, changeLineKind, describeRewrite, rewrittenVersions, summarizePairs } from "./rewrites";

const version = (id: string, rewritten: boolean, how = "fetch: fast-forward"): BranchVersion => ({ id, at: 0, rewritten, how });

describe("rewrites", () => {
  it("finds the version before the latest rewrite", () => {
    const versions = [version("d", false), version("c", true, "fetch: forced-update"), version("b", false), version("a", true), version("z", false)];
    expect(beforeLatestRewrite(versions)?.id).toBe("b");
    expect(rewrittenVersions(versions).map((v) => v.id)).toEqual(["b", "z"]);
    expect(beforeLatestRewrite([version("a", false)])).toBeNull();
    // Rewritten, but its history doesn't go back further.
    expect(beforeLatestRewrite([version("a", true)])).toBeNull();
  });

  it("says what rewrote it", () => {
    expect(describeRewrite("fetch: forced-update")).toBe("Force-pushed");
    expect(describeRewrite("rebase (finish): refs/heads/fix onto 1234")).toBe("Rebased");
    expect(describeRewrite("commit (amend): Door")).toBe("Amended");
  });

  it("sums up the commits", () => {
    const pair = (status: "same" | "changed" | "added" | "removed") => ({ status, old: null, new: null, summary: "", changes: [], cut: false });
    expect(summarizePairs([pair("changed"), pair("same"), pair("same"), pair("added")])).toBe("1 changed, 1 new, 2 the same");
    expect(summarizePairs([])).toBe("No commits");
    expect(changeLineKind("@@ door.txt")).toBe("header");
    expect(changeLineKind("+    +creak")).toBe("added");
  });
});
