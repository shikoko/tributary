import { describe, expect, it } from "vitest";
import type { RequestCheck } from "../api";
import { checksHeadline, checksVerdict, riverWords, type CountedState } from "./checkSummary";

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

describe("the words beside a pull request's river", () => {
  it("names the ones that failed, even while others still run, then counts the rest", () => {
    const checks = [check("Lint", "success"), check("Audio loudness", "failure"), check("Build (Windows)", "pending"), check("Preview", null)];
    expect(riverWords(checks, false)).toEqual({ title: "Audio loudness failed", detail: "1 of 3 checks failed, 1 still running, 1 skipped" });
    expect(riverWords([check("Audio loudness", "failure"), check("Lint", "failure")], false).title).toBe("Audio loudness and Lint failed");
    expect(riverWords([check("Audio loudness", "failure"), check("Lint", "failure"), check("Build", "failure")], false).title).toBe("Audio loudness and 2 more failed");
  });

  it("names the ones still running when none failed", () => {
    expect(riverWords([check("Lint", "success"), check("Build (Windows)", "pending")], false)).toEqual({ title: "Build (Windows) is still running", detail: "1 of 2 checks passed, 1 still running" });
    expect(riverWords([check("Build (Windows)", "pending"), check("Build (Linux)", "pending")], true).title).toBe("Build (Windows) and Build (Linux) are still running");
  });

  it("says how many passed and how long they took, from the first start to the last finish", () => {
    const checks = [
      check("Lint", "success", "2026-03-01T10:00:00Z", "2026-03-01T10:00:40Z"),
      check("Build", "success", "2026-03-01T10:00:05Z", "2026-03-01T10:05:09Z"),
      check("Preview", null),
    ];
    expect(riverWords(checks, false)).toEqual({ title: "All 2 checks passed in 5m 9s", detail: "1 skipped" });
    expect(riverWords([check("Lint", "success")], false)).toEqual({ title: "The check passed", detail: null });
  });

  it("counts cancelled ones beside the ones that passed, and names them when nothing passed", () => {
    const checks = [check("Lint", "success", "2026-03-01T10:00:00Z", "2026-03-01T10:00:40Z"), check("Old build", "cancelled")];
    expect(riverWords(checks, false)).toEqual({ title: "1 of 2 checks passed, 1 cancelled", detail: "Took 40s" });
    expect(riverWords([check("Build", "cancelled")], false).title).toBe("Build was cancelled");
    expect(riverWords([check("Build", "cancelled"), check("Lint", "cancelled")], false).title).toBe("Build and Lint were cancelled");
  });

  it("says when every one was skipped, and names a skipped matrix job without its template", () => {
    expect(riverWords([check("Preview", null)], false)).toEqual({ title: "The check was skipped", detail: null });
    expect(riverWords([check("Preview", null), check("Docs", null)], true)).toEqual({ title: "All 2 jobs were skipped", detail: null });
    expect(riverWords([check("Rust (${{ matrix.name }})", "failure")], false).title).toBe("Rust failed");
  });
});
