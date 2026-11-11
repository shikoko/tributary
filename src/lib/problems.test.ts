import { describe, expect, it, vi } from "vitest";

const reportProblem = vi.fn(async (_what: string) => "/logs/problems.log");
vi.mock("../api", () => ({ reportProblem: (what: string) => reportProblem(what) }));

const { describeProblem, keepProblem } = await import("./problems");

describe("describeProblem", () => {
  it("gives the error, where it happened and in which part of the interface", () => {
    const error = new TypeError("rows is undefined");
    error.stack = "TypeError: rows is undefined\n    at ListRow (index.js:1:200)\n    at render (index.js:1:900)";
    const text = describeProblem(error, "\n    at ListRow\n    at CommitList\n");
    expect(text).toBe("TypeError: rows is undefined\n  at ListRow (index.js:1:200)\n  at render (index.js:1:900)\nIn:\n  at ListRow\n  at CommitList");
  });

  it("keeps WebKit's stacks, which don't start with the message", () => {
    const error = new Error("");
    error.stack = "ListRow@tauri://localhost/assets/index.js:1:200";
    expect(describeProblem(error)).toBe("Error: \n  ListRow@tauri://localhost/assets/index.js:1:200");
  });

  it("describes things thrown that aren't errors", () => {
    expect(describeProblem("no repository")).toBe("no repository");
  });
});

describe("keepProblem", () => {
  it("keeps each problem once, and says where the log is", async () => {
    expect(await keepProblem("stopped the window: TypeError")).toBe("/logs/problems.log");
    expect(await keepProblem("stopped the window: TypeError")).toBeNull();
    expect(reportProblem).toHaveBeenCalledTimes(1);
  });

  it("never fails, even when the log can't be written", async () => {
    reportProblem.mockRejectedValueOnce(new Error("no log folder"));
    expect(await keepProblem("unhandled: Error")).toBeNull();
  });
});
