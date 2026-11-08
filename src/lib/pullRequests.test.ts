import { describe, expect, it } from "vitest";
import type { RequestDetails } from "../api";
import { describeMergeable, suggestRequest, summarizeChecks, titleFromBranch } from "./pullRequests";

describe("suggestRequest", () => {
  it("uses a single commit's message", () => {
    expect(suggestRequest("fix/door", [{ summary: "Make the door creak", body: "It was silent." }])).toEqual({
      title: "Make the door creak",
      body: "It was silent.",
    });
  });

  it("lists several commits under a title from the branch", () => {
    const commits = [
      { summary: "Add a sync client", body: "" },
      { summary: "Retry failed requests", body: "Twice." },
    ];
    expect(suggestRequest("feature/sync-retry", commits)).toEqual({ title: "Sync retry", body: "- Add a sync client\n- Retry failed requests" });
    expect(titleFromBranch("main")).toBe("Main");
    expect(titleFromBranch("art/barber_v2")).toBe("Barber v2");
  });
});

describe("summarizeChecks", () => {
  it("counts the worst first", () => {
    const check = (state: "success" | "failure" | "pending" | null) => ({ name: "x", state, url: null, detail: null });
    expect(summarizeChecks([check("success"), check("failure"), check("success"), check(null)])).toBe("1 failed, 2 passed, 1 skipped");
    expect(summarizeChecks([])).toBe("");
  });
});

describe("describeMergeable", () => {
  const details = (overrides: Partial<RequestDetails>): RequestDetails => ({
    number: 1,
    title: "t",
    url: "",
    body: "",
    author: "",
    state: "open",
    base: "main",
    branch: "fix/door",
    created: "",
    additions: null,
    deletions: null,
    files: null,
    comments: 0,
    mergeable: null,
    reviews: [],
    checks: [],
    forge: "github",
    ...overrides,
  });

  it("says why it can't be merged", () => {
    expect(describeMergeable(details({ mergeable: "ready" }))).toEqual({ text: "Ready to merge into main", tone: "good" });
    expect(describeMergeable(details({ mergeable: "conflicts" }))?.tone).toBe("bad");
    expect(describeMergeable(details({ mergeable: "blocked", checks: [{ name: "test", state: "failure", url: null, detail: null }] }))?.text).toBe(
      "Can't be merged yet: checks failed",
    );
    expect(describeMergeable(details({ mergeable: "blocked" }))?.tone).toBe("waiting");
    expect(describeMergeable(details({ mergeable: null }))).toBeNull();
  });
});
