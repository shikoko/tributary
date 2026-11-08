import { describe, expect, it } from "vitest";
import { describeSync } from "./branchSync";

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
