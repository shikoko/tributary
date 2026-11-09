import { describe, expect, it } from "vitest";
import type { Tracker, WebRemote } from "../api";
import { branchNameFor, effectiveTracker, issueKeys, issueUrl, branchIssueKey, fromTemplate, withIssueKey } from "./issues";

const jira: Tracker = { kind: "jira", site: "studio.atlassian.net/", keys: ["FEAST"] };
const linear: Tracker = { kind: "linear", site: "studio", keys: [] };
const github: Tracker = { kind: "github", site: "", keys: [] };

describe("issues", () => {
  it("finds the issues a message mentions", () => {
    expect(issueKeys("FEAST-12: barber's apron (see FEAST-3, UTF-8 and FEAST-12)", jira)).toEqual(["FEAST-12", "FEAST-3"]);
    expect(issueKeys("ENG-7 and DESIGN-2", linear)).toEqual(["ENG-7", "DESIGN-2"]);
    expect(issueKeys("Fixes #12, see a/b#3 and &#39;", github)).toEqual(["#12"]);
    expect(issueKeys("FEAST-12", null)).toEqual([]);
  });

  it("links to them", () => {
    expect(issueUrl("FEAST-12", jira, undefined)).toBe("https://studio.atlassian.net/browse/FEAST-12");
    expect(issueUrl("ENG-7", linear, undefined)).toBe("https://linear.app/studio/issue/ENG-7");
    const remote: WebRemote = { name: "origin", host: "github", url: "https://github.com/example/feast" };
    expect(issueUrl("#12", github, remote)).toBe("https://github.com/example/feast/issues/12");
  });

  it("names a branch after an issue", () => {
    expect(branchNameFor({ key: "FEAST-12", title: "Barber's apron: make it leather!" })).toBe("FEAST-12-barber-s-apron-make-it-leather");
    expect(branchNameFor({ key: "#7", title: "Crème brûlée recipe" })).toBe("7-creme-brulee-recipe");
    expect(branchNameFor({ key: "ENG-1", title: "!!!" })).toBe("ENG-1");
  });

  it("uses the remote's own issues unless told otherwise", () => {
    const snapshot = { webRemotes: [{ name: "origin", host: "gitlab", url: "https://gitlab.com/x/y" } as WebRemote] };
    expect(effectiveTracker(null, snapshot)?.kind).toBe("gitlab");
    expect(effectiveTracker("off", snapshot)).toBeNull();
    expect(effectiveTracker(jira, snapshot)).toBe(jira);
  });
});

describe("commit messages and branches", () => {
  const jira = { kind: "jira" as const, site: "example.atlassian.net", keys: ["FEAST"] };
  it("finds the issue a branch is for", () => {
    expect(branchIssueKey("FEAST-23-tavern-sign", jira)).toBe("FEAST-23");
    expect(branchIssueKey("feature/feast-23-tavern-sign", jira)).toBe("FEAST-23");
    expect(branchIssueKey("OTHER-4-thing", jira)).toBeNull();
    expect(branchIssueKey("main", jira)).toBeNull();
    expect(branchIssueKey("23-tavern-sign", { kind: "github", site: "", keys: [] })).toBeNull();
    expect(branchIssueKey("ENG-7-x", { kind: "linear", site: "studio", keys: [] })).toBe("ENG-7");
  });

  it("puts the key in front once", () => {
    expect(withIssueKey("Add the opening hours", "FEAST-23")).toBe("FEAST-23: Add the opening hours");
    expect(withIssueKey("feast-23 add the hours", "FEAST-23")).toBe("feast-23 add the hours");
    expect(withIssueKey("Add the hours", null)).toBe("Add the hours");
  });

  it("reads a template without git's comments", () => {
    expect(fromTemplate("# Write why\nFix: \n\nWhy:\n- \n# end\n\n")).toEqual({ summary: "Fix:", description: "Why:\n- " });
    expect(fromTemplate("")).toEqual({ summary: "", description: "" });
  });
});
