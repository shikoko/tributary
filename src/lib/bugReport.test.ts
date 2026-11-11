import { describe, expect, it } from "vitest";
import { bugReportUrl, NEW_ISSUE } from "./bugReport";

describe("bugReportUrl", () => {
  it("fills in the bug report form's fields", () => {
    const url = new URL(bugReportUrl({ title: "Window stopped", what: "TypeError: x", diagnostics: "Tributary 0.2.1", system: "macOS" }));
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "bug_report.yml",
      title: "Window stopped",
      what: "TypeError: x",
      diagnostics: "Tributary 0.2.1",
      system: "macOS",
    });
  });

  it("cuts long diagnostics so the address stays one GitHub takes", () => {
    const url = bugReportUrl({ what: "TypeError: x", diagnostics: "a very long line of diagnostics\n".repeat(500) });
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(new URL(url).searchParams.get("diagnostics")!.endsWith("\n…")).toBe(true);
    expect(new URL(url).searchParams.get("what")).toBe("TypeError: x");
  });
});
