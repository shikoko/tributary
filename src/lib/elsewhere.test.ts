import { describe, expect, it } from "vitest";
import type { OtherChange, Overlap } from "../api";
import { byBranch, describeChange, overlapHeadline, overlapTitle, people } from "./elsewhere";

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

describe("byBranch", () => {
  const change = (branch: string, author: string, time: number): OtherChange => ({ branch, commit: `${branch}-${time}`, summary: "s", author, time });
  const overlap = (path: string, unmergeable: boolean, ...elsewhere: OtherChange[]): Overlap => ({ path, unmergeable, uncommitted: true, elsewhere });

  it("groups the files by branch, assets first, then the most recent", () => {
    const groups = byBranch([
      overlap("src/a.ts", false, change("feature/x", "Theo Park", 300), change("origin/main", "Sam Okafor", 100)),
      overlap("Hero.uasset", true, change("art/hero", "Rosa Bell", 50)),
      overlap("src/b.ts", false, change("feature/x", "Lena Fischer", 400)),
    ]);
    expect(groups.map((group) => [group.branch, group.files.length, group.assets])).toEqual([
      ["art/hero", 1, 1],
      ["feature/x", 2, 0],
      ["origin/main", 1, 0],
    ]);
    expect(groups[1].authors).toEqual(["Lena Fischer", "Theo Park"]);
    expect(groups[1].files.map((file) => file.overlap.path)).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("names people briefly", () => {
    expect(people(["Rosa Bell"])).toBe("Rosa Bell");
    expect(people(["Rosa Bell", "Theo Park"])).toBe("Rosa Bell and Theo Park");
    expect(people(["A", "B", "C", "D"])).toBe("A, B and 2 others");
  });
});
