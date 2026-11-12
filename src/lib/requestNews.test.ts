import { describe, expect, it } from "vitest";
import type { PullRequest, RequestComment, RequestConversation } from "../api";
import { checksState, describeRequestNews, type RequestSeen } from "./requestNews";

const pr: PullRequest = { number: 12, title: "Barber v2", url: "", remote: "origin", branch: "art/barber-v2", draft: false, author: "rosa-bell", checks: null, forge: "github" };
const comment = (id: string, author: string, more: Partial<RequestComment> = {}): RequestComment => ({
  id,
  author,
  body: "",
  created: "",
  review: null,
  path: null,
  line: null,
  hunk: null,
  thread: null,
  reply: false,
  ...more,
});
const conversation = (comments: RequestComment[]): RequestConversation => ({ comments, you: "rosa-bell", mergeMethods: [], canRequestChanges: true });
const seen = (ids: string[], checks: RequestSeen["checks"] = null, state: RequestSeen["state"] = "open"): RequestSeen => ({ comments: new Set(ids), checks, state });

describe("describeRequestNews", () => {
  it("tells of reviews and comments by others, not yours", () => {
    const now = conversation([comment("a", "lena-fischer"), comment("b", "maya-chen", { review: "approved" }), comment("c", "rosa-bell"), comment("d", "sam-okafor", { path: "Config/DefaultGame.ini", reply: true })]);
    expect(describeRequestNews(pr, seen(["a"]), seen(["a", "b", "c", "d"]), now)).toEqual(["maya-chen approved #12", "sam-okafor replied on #12 (DefaultGame.ini)"]);
  });

  it("counts many comments", () => {
    const now = conversation([comment("a", "lena-fischer"), comment("b", "sam-okafor"), comment("c", "lena-fischer")]);
    expect(describeRequestNews(pr, seen([]), seen(["a", "b", "c"]), now)).toEqual(["3 new comments on #12 from lena-fischer and sam-okafor"]);
  });

  it("tells when checks finish or fail, and when it's merged", () => {
    expect(describeRequestNews(pr, seen([], "pending"), seen([], "success"), null)).toEqual(["#12's checks passed"]);
    expect(describeRequestNews(pr, seen([], "success"), seen([], "failure"), null)).toEqual(["#12's checks failed"]);
    expect(describeRequestNews(pr, seen([], "success"), seen([], "success"), null)).toEqual([]);
    expect(describeRequestNews({ ...pr, forge: "gitlab" }, seen([], "pending", "open"), seen([], "failure", "merged"), null)).toEqual(["!12 was merged", "!12's pipeline failed"]);
  });

  it("sums up checks", () => {
    const check = (state: "success" | "failure" | "pending" | null) => ({ name: "x", state, url: null, detail: null, startedAt: null, finishedAt: null, workflow: null, trigger: null });
    expect(checksState([check("success"), check("pending")])).toBe("pending");
    expect(checksState([check("success"), check("failure")])).toBe("failure");
    expect(checksState([check(null)])).toBeNull();
  });
});
