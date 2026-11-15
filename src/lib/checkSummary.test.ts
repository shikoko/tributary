import { describe, expect, it } from "vitest";
import type { RequestCheck } from "../api";
import { checksHeadline, checksTitle, checksVerdict, type CountedState } from "./checkSummary";

const counts = (entries: [CountedState, number][]) => new Map(entries);

describe("a commit's checks in words", () => {
  it("says all passed only when every one did", () => {
    expect(checksHeadline(counts([["success", 22]]), false)).toBe("All 22 checks passed");
    expect(checksHeadline(counts([["success", 1]]), false)).toBe("The check passed");
    // Some cancelled (replaced by a newer run) or skipped: not all of them passed.
    expect(checksHeadline(counts([["success", 13], ["cancelled", 6], ["skipped", 1]]), false)).toBe("13 of 20 checks passed");
    expect(checksVerdict(counts([["success", 13], ["cancelled", 6]]))).toBe("success");
  });

  it("puts failed ones first, then running ones", () => {
    expect(checksHeadline(counts([["failure", 1], ["pending", 1], ["success", 5]]), false)).toBe("1 of 7 checks failed");
    expect(checksHeadline(counts([["pending", 2], ["success", 5]]), true)).toBe("2 of 7 jobs running");
    expect(checksVerdict(counts([["failure", 1], ["pending", 3]]))).toBe("failure");
  });

  it("says when none of them ran", () => {
    expect(checksHeadline(counts([["cancelled", 3]]), false)).toBe("All 3 checks cancelled");
    expect(checksHeadline(counts([["skipped", 1]]), true)).toBe("The job was skipped");
  });
});

const check = (name: string, state: RequestCheck["state"], startedAt: string | null = null, finishedAt: string | null = null): RequestCheck =>
  ({ name, state, url: null, detail: null, startedAt, finishedAt, workflow: null, trigger: null });

describe("the title over a pull request's checks", () => {
  it("names the ones that failed, even while others still run", () => {
    expect(checksTitle([check("Lint", "success"), check("Audio loudness", "failure"), check("Build (Windows)", "pending")])).toBe("Audio loudness failed");
    expect(checksTitle([check("Audio loudness", "failure"), check("Lint", "failure")])).toBe("Audio loudness and Lint failed");
    expect(checksTitle([check("Audio loudness", "failure"), check("Lint", "failure"), check("Build", "failure")])).toBe("Audio loudness and 2 more failed");
  });

  it("names the ones still running when none failed", () => {
    expect(checksTitle([check("Lint", "success"), check("Build (Windows)", "pending")])).toBe("Build (Windows) is still running");
    expect(checksTitle([check("Build (Windows)", "pending"), check("Build (Linux)", "pending")])).toBe("Build (Windows) and Build (Linux) are still running");
  });

  it("says how long they took once they passed, from the first start to the last finish", () => {
    const checks = [
      check("Lint", "success", "2026-03-01T10:00:00Z", "2026-03-01T10:00:40Z"),
      check("Build", "success", "2026-03-01T10:00:05Z", "2026-03-01T10:05:09Z"),
      check("Old build", "cancelled", "2026-03-01T09:50:00Z", "2026-03-01T09:51:00Z"),
      check("Preview", null),
    ];
    expect(checksTitle(checks)).toBe("Passed in 5m 9s");
  });

  it("names cancelled ones when nothing passed, and leaves the rest to the counted headline", () => {
    expect(checksTitle([check("Build", "cancelled")])).toBe("Build was cancelled");
    expect(checksTitle([check("Build", "cancelled"), check("Lint", "cancelled")])).toBe("Build and Lint were cancelled");
    expect(checksTitle([check("Preview", null)])).toBeNull();
    expect(checksTitle([check("Lint", "success")])).toBeNull();
  });

  it("names a skipped matrix job without its template", () => {
    expect(checksTitle([check("Rust (${{ matrix.name }})", "failure")])).toBe("Rust failed");
  });
});
