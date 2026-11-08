import { describe, expect, it } from "vitest";
import type { Overlap } from "../api";
import { describeChange, overlapHeadline, overlapTitle } from "./elsewhere";

const now = 1_800_000_000;
const change = (branch: string, author = "Rosa Bell", daysAgo = 2) => ({ branch, commit: "c", summary: "s", author, time: now - daysAgo * 86400 });
const overlap = (path: string, unmergeable: boolean, ...branches: string[]): Overlap => ({
  path,
  unmergeable,
  uncommitted: true,
  elsewhere: branches.map((branch) => change(branch)),
});

describe("changed elsewhere", () => {
  it("says where and when", () => {
    expect(describeChange(change("origin/art/lighting"), now)).toBe("origin/art/lighting, by Rosa Bell 2 days ago");
  });

  it("names one file, or counts them", () => {
    expect(overlapHeadline([overlap("Content/Maps/Tavern.umap", true, "origin/art/lighting")], now)).toBe(
      "Tavern.umap was also changed on origin/art/lighting, by Rosa Bell 2 days ago.",
    );
    expect(overlapHeadline([overlap("a.umap", true, "x", "y", "z")], now)).toContain("(and 2 more branches)");
    expect(overlapHeadline([overlap("a.umap", true, "x"), overlap("b.txt", false, "y")], now)).toBe(
      "a.umap and 1 more you're changing were also changed on other branches.",
    );
    expect(overlapHeadline([overlap("a.txt", false, "x"), overlap("b.txt", false, "y")], now)).toBe(
      "2 files you're changing were also changed on other branches.",
    );
  });

  it("explains what it means for the file", () => {
    expect(overlapTitle(overlap("a.umap", true, "x"), now)).toContain("one version will have to win");
    expect(overlapTitle(overlap("a.txt", false, "x"), now)).toContain("Git can usually merge");
  });
});
