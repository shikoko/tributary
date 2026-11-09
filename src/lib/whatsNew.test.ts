import { describe, expect, it } from "vitest";
import { compareVersions, forMenu, onStart, type Release } from "./whatsNew";

const releases: Release[] = [
  { version: "0.3.0", items: [{ title: "C", text: "" }] },
  { version: "0.2.0", items: [{ title: "B", text: "" }] },
  { version: "0.1.0", items: [{ title: "A", text: "" }] },
];

describe("what's new", () => {
  it("compares versions by their numbers", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.2.1")).toBe(-1);
  });

  it("greets someone new with the tour, and says what's new after an update", () => {
    expect(onStart("0.3.0", null, false, releases).show).toBe("tour");
    // Updated from 0.1.0 straight to 0.3.0: both versions' news, newest first.
    expect(onStart("0.3.0", "0.1.0", true, releases).releases.map((r) => r.version)).toEqual(["0.3.0", "0.2.0"]);
    expect(onStart("0.3.0", "0.3.0", true, releases).show).toBeNull();
    // Used before this existed: this version's news.
    expect(onStart("0.2.0", null, true, releases).releases.map((r) => r.version)).toEqual(["0.2.0"]);
    expect(onStart("0.2.5", null, true, releases).show).toBeNull();
  });

  it("always has something to show from the Help menu", () => {
    const versions = (version: string | null) => forMenu(version, releases).map((r) => r.version);
    expect(versions("0.2.4")).toEqual(["0.2.0"]);
    expect(versions("0.3.0")).toEqual(["0.3.0"]);
    // A build from before its version was raised: the newest notes there are.
    expect(versions("0.0.9")).toEqual(["0.3.0"]);
    expect(versions(null)).toEqual(["0.3.0"]);
  });
});
