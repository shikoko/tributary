import { describe, expect, it } from "vitest";
import type { RequestCheck, RequestDetails } from "../api";
import { anyRunning, checkTime, checkTimeline, describeCheckProgress, describeMergeable, describeReviews, suggestRequest, formatElapsed, summarizeChecks, titleFromBranch } from "./pullRequests";

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
    baseSha: null,
    headSha: null,
    autoMerge: false,
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

describe("describeReviews", () => {
  it("says who approved, who asked for changes and who it waits for", () => {
    expect(
      describeReviews([
        { author: "maya-chen", state: "approved" },
        { author: "lena-fischer", state: "commented" },
        { author: "sam-okafor", state: "requested" },
      ]),
    ).toBe("Approved by maya-chen · lena-fischer commented · waiting for sam-okafor");
    expect(describeReviews([{ author: "diego-ramos", state: "changesRequested" }, { author: "maya-chen", state: "requested" }])).toBe(
      "diego-ramos asked for changes · waiting for maya-chen",
    );
    expect(describeReviews([{ author: "a", state: "approved" }, { author: "b", state: "approved" }, { author: "c", state: "approved" }])).toBe("Approved by a, b and c");
    expect(describeReviews([])).toBeNull();
  });
});

describe("describeCheckProgress", () => {
  const check = (state: "success" | "failure" | "pending" | null) => ({ name: "x", state, url: null, detail: null });
  it("counts passed, failed and running checks, not skipped ones", () => {
    expect(describeCheckProgress([check("success"), check("success"), check("pending"), check(null)])).toBe("2 of 3 checks passed, 1 still running");
    expect(describeCheckProgress([check("failure"), check("success")])).toBe("1 of 2 checks failed");
    expect(describeCheckProgress([check("success"), check("success")])).toBe("All 2 checks passed");
    expect(describeCheckProgress([check("success")], true)).toBe("The job passed");
    expect(describeCheckProgress([check(null)])).toBeNull();
  });
});

describe("check times", () => {
  const check = (state: RequestCheck["state"], startedAt: string | null, finishedAt: string | null): RequestCheck => ({
    name: "Build",
    state,
    url: null,
    detail: null,
    startedAt,
    finishedAt,
  });
  const start = "2026-11-10T10:00:00Z";
  const at = (iso: string) => Date.parse(iso);

  it("says a length of time briefly", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_400)).toBe("45s");
    expect(formatElapsed(252_000)).toBe("4m 12s");
    expect(formatElapsed(3_780_000)).toBe("1h 3m");
    expect(formatElapsed(-5000)).toBe("0s");
  });

  it("counts a running check up to now, and a finished one to its end", () => {
    expect(checkTime(check("pending", start, null), at("2026-11-10T10:04:12Z"))).toBe("4m 12s");
    expect(checkTime(check("success", start, "2026-11-10T10:02:13Z"), at("2026-11-10T11:00:00Z"))).toBe("2m 13s");
  });

  it("has no time for a check that hasn't started, or a finished one without an end", () => {
    expect(checkTime(check("pending", null, null), Date.now())).toBeNull();
    expect(checkTime(check("failure", start, null), Date.now())).toBeNull();
    // GitHub gives a skipped check a start and an end, the same moment: it still didn't run.
    expect(checkTime(check(null, start, start), Date.now())).toBeNull();
    expect(anyRunning([check("success", start, "2026-11-10T10:02:13Z"), check("pending", null, null)])).toBe(false);
    expect(anyRunning([check("pending", start, null)])).toBe(true);
  });
});

describe("checkTimeline", () => {
  const check = (state: RequestCheck["state"], startedAt: string | null, finishedAt: string | null): RequestCheck => ({
    name: "Build",
    state,
    url: null,
    detail: null,
    startedAt,
    finishedAt,
  });

  it("puts every check on one clock, from the first start to the last end or now", () => {
    const now = Date.parse("2026-11-10T10:10:00Z");
    const timeline = checkTimeline(
      [
        check("success", "2026-11-10T10:00:00Z", "2026-11-10T10:05:00Z"),
        check("pending", "2026-11-10T10:05:00Z", null),
        check("pending", null, null),
      ],
      now,
    );
    expect(timeline?.first).toBe(Date.parse("2026-11-10T10:00:00Z"));
    expect(timeline?.last).toBe(now);
    expect(timeline?.bars).toEqual([{ from: 0, to: 0.5 }, { from: 0.5, to: 1 }, null]);
  });

  it("has nothing to show when no check has times", () => {
    expect(checkTimeline([check("success", null, null)], Date.now())).toBeNull();
  });

  it("keeps a bar when the clock here is behind the site's", () => {
    const timeline = checkTimeline([check("pending", "2026-11-10T10:00:05Z", null)], Date.parse("2026-11-10T10:00:00Z"));
    expect(timeline?.bars).toEqual([{ from: 0, to: 0 }]);
  });
});
