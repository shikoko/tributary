import { describe, expect, it } from "vitest";
import type { PullRequest } from "../api";
import { describeReflog } from "../components/RecoverDialog";
import { lfsPattern } from "../components/WorktreeDetails";
import { formatBytes } from "./format";
import { watchedFor } from "./news";
import { describeChecks, makeLookup } from "./pullRequests";

const pr = (number: number, remote: string, branch: string, checks: PullRequest["checks"] = null): PullRequest => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  remote,
  branch,
  draft: false,
  author: "rosa",
  checks,
});

describe("pull requests", () => {
  const lookup = makeLookup([pr(12, "origin", "feat/menu", "success"), pr(13, "origin", "fix/door")], () => {});

  it("finds a branch's pull request by its remote branch", () => {
    expect(lookup.find("feat/menu", true, ["origin"])?.number).toBe(12);
    expect(lookup.find("origin/fix/door", false, [])?.number).toBe(13);
    // A local branch tracking a remote branch with another name.
    expect(lookup.find("menu", true, [], "origin/feat/menu")?.number).toBe(12);
    expect(lookup.find("feat/menu", true, [])).toBeUndefined();
    expect(lookup.find("main", true, ["origin"])).toBeUndefined();
  });

  it("describes checks", () => {
    expect(describeChecks(pr(12, "origin", "x", "failure"))).toBe("Pull request #12: Change 12 by rosa · checks failed");
    expect(describeChecks(pr(13, "origin", "x"))).toBe("Pull request #13: Change 13 by rosa");
  });
});

describe("helpers", () => {
  it("formats sizes like Git LFS does", () => {
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(950)).toBe("950 bytes");
    expect(formatBytes(48_200_000)).toBe("48.2 MB");
    expect(formatBytes(12_000_000_000)).toBe("12 GB");
    expect(formatBytes(512_000_000)).toBe("512 MB");
  });

  it("picks the Git LFS pattern for a file", () => {
    expect(lfsPattern("Content/Maps/Level.umap")).toBe("*.umap");
    expect(lfsPattern("Content/Video/intro.final.mp4")).toBe("*.mp4");
    expect(lfsPattern("Tools/bake")).toBe("Tools/bake");
    expect(lfsPattern(".env")).toBe(".env");
  });

  it("watches main and your upstream on every remote", () => {
    expect(watchedFor("origin/feat/menu", ["origin"])).toEqual([
      "origin/feat/menu",
      "origin/main",
      "origin/master",
      "origin/develop",
      "origin/development",
      "origin/dev",
      "origin/trunk",
    ]);
  });

  it("describes reflog entries", () => {
    expect(describeReflog("reset: moving to HEAD~2")).toEqual({ action: "Reset", detail: "moving to HEAD~2" });
    expect(describeReflog("commit (amend): Fix the door")).toEqual({ action: "Amend", detail: "Fix the door" });
    expect(describeReflog("rebase (finish): returning to refs/heads/feat")).toEqual({
      action: "Rebase",
      detail: "returning to refs/heads/feat",
    });
    expect(describeReflog("checkout: moving from main to feat").action).toBe("Checkout");
  });
});
