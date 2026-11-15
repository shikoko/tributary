import { describe, expect, it } from "vitest";
import type { CommitRuns, Job, JobGroup, Run } from "../api";
import { countStates, elapsed, groupState, jobState, jobTime, memberName, runColumns, stepProgress } from "./runGraph";

const job = (name: string, over: Partial<Job> = {}): Job => ({
  name,
  state: "success",
  url: null,
  startedAt: "2026-11-14T10:00:00Z",
  finishedAt: "2026-11-14T10:01:00Z",
  stepsDone: 0,
  steps: 0,
  step: null,
  ...over,
});
const group = (key: string, needs: string[], jobs: Job[], over: Partial<JobGroup> = {}): JobGroup => ({ key, name: key, needs, matrix: jobs.length > 1, jobs, ...over });
const run = (groups: JobGroup[], state: Run["state"] = "pending"): Run => ({ name: "Build", trigger: "on push to develop", url: null, state, startedAt: null, finishedAt: null, groups });

// This repository's Build: version, then the builds, then Flatpak, beta and release, then "Flatpak starts".
const build = run([
  group("version", [], [job("Version")]),
  group("build", ["version"], [job("Linux"), job("macOS", { state: "pending", finishedAt: null, stepsDone: 10, steps: 18, step: "Build installers" })]),
  group("flatpak", ["version", "build"], []),
  group("flatpak-check", ["flatpak"], []),
  group("beta", ["version", "build"], []),
  group("release", ["version", "build"], []),
]);

describe("run graphs", () => {
  it("puts each group one column after the last group it waits for", () => {
    expect(runColumns(build).map((column) => column.map((g) => g.key))).toEqual([["version"], ["build"], ["flatpak", "beta", "release"], ["flatpak-check"]]);
  });

  it("puts groups that wait for nothing in the first column, and cuts a loop", () => {
    const loop = run([group("a", ["b"], [job("a")]), group("b", ["a"], [job("b")]), group("c", [], [job("c")])]);
    const columns = runColumns(loop).map((column) => column.map((g) => g.key));
    expect(columns.flat().sort()).toEqual(["a", "b", "c"]);
    expect(columns[0]).toContain("c");
  });

  it("says how jobs and groups are doing", () => {
    expect(jobState(job("x", { state: "pending", startedAt: null }))).toBe("queued");
    expect(jobState(job("x", { state: "pending" }))).toBe("running");
    expect(jobState(job("x", { state: null }))).toBe("skipped");
    expect(groupState(build.groups[1], build)).toBe("running");
    expect(groupState(build.groups[2], build)).toBe("waiting");
    expect(groupState(build.groups[2], { ...build, state: "success" })).toBe("skipped");
    expect(groupState(group("g", [], [job("a"), job("b", { state: "failure" })]), build)).toBe("failure");
  });

  it("names a job in its box without what the box says", () => {
    const analyze = group("analyze", [], [job("Analyze (rust)")], { name: "Analyze" });
    expect(memberName(analyze, analyze.jobs[0])).toBe("rust");
    expect(memberName(build.groups[1], build.groups[1].jobs[0])).toBe("Linux");
    expect(memberName(analyze, job("Analyze ()"))).toBe("Analyze ()");
  });

  it("times and steps", () => {
    expect(elapsed("2026-11-14T10:00:00Z", "2026-11-14T10:07:56Z", 0)).toBe("7m 56s");
    expect(elapsed("2026-11-14T10:00:00Z", null, Date.parse("2026-11-14T10:00:42Z"))).toBe("42s");
    expect(elapsed(null, null, 0)).toBeNull();
    expect(jobTime(job("x"), 0)).toBe("1m 0s");
    expect(jobTime(job("x", { state: null }), 0)).toBeNull();
    expect(stepProgress(build.groups[1].jobs[1])).toBeCloseTo(10 / 18);
    expect(stepProgress(job("x"))).toBeNull();
  });

  it("counts jobs by how they're doing, with the groups still waiting", () => {
    const runs: CommitRuns = { runs: [build], others: [{ name: "Deploy preview", state: null, url: null, detail: null, startedAt: null, finishedAt: null, workflow: null, trigger: null }], canRerun: false, signedIn: true, site: "GitHub", url: null };
    expect(countStates(runs)).toEqual([
      ["running", 1],
      ["waiting", 4],
      ["success", 2],
      ["skipped", 1],
    ]);
  });
});
