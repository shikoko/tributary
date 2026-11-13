import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { items, left } from "./release-checklist.mjs";

const CHECKLIST = readFileSync(new URL("../release-checklist.md", import.meta.url), "utf8");

const LIST = `## Before releasing

- [ ] **Version:** the version is the one meant.
- [ ] **Notes:** they cover every pull request.
- [ ] **Windows:** the latest beta, tried.
`;

describe("the release checklist", () => {
  it("names its items by their bold start", () => {
    expect(items(LIST)).toEqual(["Version", "Notes", "Windows"]);
    // The real one has the steps on real computers, and every item is named.
    const real = items(CHECKLIST);
    expect(real).toEqual(expect.arrayContaining(["Version", "Notes", "What's New", "Windows", "macOS"]));
    expect(real.length).toBe(CHECKLIST.match(/^\s*- \[ \]/gm).length);
  });

  it("has nothing left once every item is ticked, with notes under them", () => {
    const description = LIST.replaceAll("- [ ]", "- [x]") + "\n  The beta was 0.7.0-beta.6, at 100% and 150%.\n";
    expect(left(LIST, description)).toEqual([]);
    expect(left(LIST, LIST.replaceAll("- [ ]", "- [X]"))).toEqual([]);
  });

  it("says which items aren't ticked, and which aren't there", () => {
    const description = "- [x] **Version:** the version is the one meant.\r\n- [ ] **Notes:** they cover every pull request.\r\n";
    expect(left(LIST, description)).toEqual([
      { name: "Notes", ticked: false, there: true },
      { name: "Windows", ticked: false, there: false },
    ]);
  });

  it("doesn't count an item that's only mentioned, not a box", () => {
    expect(left(LIST, "The **Version:** is right, and so are the **Notes:**.")).toHaveLength(3);
  });

  it("finds every item of the real checklist in a copy of it, unticked", () => {
    expect(left(CHECKLIST, CHECKLIST).every((item) => item.there && !item.ticked)).toBe(true);
  });
});
