import { describe, expect, it } from "vitest";
import type { ReleaseNotes } from "../api";
import { names, releaseMarkdown } from "./releaseNotes";

const notes: ReleaseNotes = {
  from: "v0.1.0",
  to: "v0.2.0",
  earlier: ["v0.1.0"],
  items: [
    { title: "Fix the counter", number: null, author: "Lena Fischer", id: "c", body: "" },
    { title: "Sync notes between devices", number: "#18", author: "Maya Chen", id: "a", body: "" },
  ],
  contributors: ["Diego Ramos", "Lena Fischer", "Maya Chen"],
  commits: 4,
};

describe("release notes", () => {
  it("lists the changes oldest first, the issues and who made them", () => {
    expect(releaseMarkdown(notes, [{ key: "FEAST-12", url: "https://studio.atlassian.net/browse/FEAST-12" }])).toBe(
      [
        "## What's changed",
        "",
        "- Sync notes between devices (#18)",
        "- Fix the counter",
        "",
        "## Issues",
        "",
        "- [FEAST-12](https://studio.atlassian.net/browse/FEAST-12)",
        "",
        "Thanks to Diego Ramos, Lena Fischer and Maya Chen.",
        "",
        "**Full changes:** v0.1.0...v0.2.0",
        "",
      ].join("\n"),
    );
  });

  it("says when there's nothing new, and joins names", () => {
    expect(releaseMarkdown({ ...notes, from: null, items: [], contributors: [] })).toBe("Nothing new since the last release.\n");
    expect(names(["Maya Chen", "Theo Park"])).toBe("Maya Chen and Theo Park");
  });
});
