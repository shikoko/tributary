import { describe, expect, it } from "vitest";
import { describeCount, describeSync } from "./branchSync";

describe("describeSync", () => {
  it("says how far a branch is from the one it tracks", () => {
    expect(describeSync({ ahead: 0, behind: 1, upstream: "origin/feat/barbershop" })).toBe(
      "1 commit behind origin/feat/barbershop (pull to bring them in)",
    );
    expect(describeSync({ ahead: 3, behind: 0, upstream: "origin/main" })).toBe("3 commits ahead of origin/main (not pushed yet)");
    expect(describeSync({ ahead: 2, behind: 5, upstream: "origin/main" })).toBe("2 commits ahead of and 5 behind origin/main");
    expect(describeSync({ ahead: 0, behind: 0, upstream: "origin/main" })).toBeNull();
  });
});

describe("describeCount", () => {
  it("counts a merged branch once, with its commits in brackets", () => {
    expect(describeCount(3)).toBe("3 commits");
    expect(describeCount(3, 3)).toBe("3 commits");
    expect(describeCount(1, 2)).toBe("1 change (2 commits)");
    expect(describeSync({ ahead: 0, behind: 1, behindCommits: 2, upstream: "origin/develop" })).toBe(
      "1 change (2 commits) behind origin/develop (pull to bring them in)",
    );
    expect(describeSync({ ahead: 2, behind: 1, behindCommits: 4, upstream: "origin/develop" })).toBe(
      "2 commits ahead of and 1 change (4 commits) behind origin/develop",
    );
  });
});
