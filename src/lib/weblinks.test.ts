import { describe, expect, it } from "vitest";
import type { WebRemote } from "../api";
import { branchUrl, coAuthors, commitUrl, linkify, newPullRequestUrl, siteName } from "./weblinks";

const github: WebRemote = { name: "origin", host: "github", url: "https://github.com/shikoko/feast" };
const gitlab: WebRemote = { name: "origin", host: "gitlab", url: "https://gitlab.com/shikoko/feast" };

describe("web links", () => {
  it("links commits and branches on each site", () => {
    expect(siteName(github)).toBe("GitHub");
    expect(commitUrl(github, "abc")).toBe("https://github.com/shikoko/feast/commit/abc");
    expect(commitUrl(gitlab, "abc")).toBe("https://gitlab.com/shikoko/feast/-/commit/abc");
    expect(branchUrl(github, "feat/Barber v2")).toBe("https://github.com/shikoko/feast/tree/feat/Barber%20v2");
    expect(newPullRequestUrl(github, "feat/menu")).toContain("feat/menu");
  });

  it("finds links, issue numbers and commit ids in messages", () => {
    const parts = linkify("Fixes #12 (see https://example.com/x.) after a1b2c3d", github, (sha) => (sha === "a1b2c3d" ? "a1b2c3d4e5" : null));
    expect(parts).toEqual([
      { kind: "text", text: "Fixes " },
      { kind: "url", text: "#12", url: "https://github.com/shikoko/feast/issues/12" },
      { kind: "text", text: " (see " },
      { kind: "url", text: "https://example.com/x", url: "https://example.com/x" },
      { kind: "text", text: ".) after " },
      { kind: "commit", text: "a1b2c3d", id: "a1b2c3d4e5" },
    ]);
  });

  it("reads co-authors", () => {
    expect(coAuthors("Text\n\nCo-authored-by: Rosa Bell <rosa@example.com>\nco-authored-by:Theo <theo@example.com>")).toEqual([
      { name: "Rosa Bell", email: "rosa@example.com" },
      { name: "Theo", email: "theo@example.com" },
    ]);
  });
});
