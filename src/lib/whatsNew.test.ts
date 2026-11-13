import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync, statSync } from "node:fs";
import { compareVersions, featured, forMenu, onStart, parseNotes, RELEASES, type Release } from "./whatsNew";

const release = (version: string): Release => ({ version, headline: "", sections: [{ name: "New", items: [{ title: version, text: "" }] }] });
const releases: Release[] = [release("0.3.0"), release("0.2.0"), release("0.1.0")];

describe("what's new", () => {
  it("reads a version's notes: the headline, then each section's items", () => {
    const notes = parseNotes(
      "1.2.0",
      [
        "Lanes that light up, and fewer surprises.",
        "",
        "## New",
        "",
        "- **A branch's lane lights up:** point at a branch, and its lane lights up.",
        "",
        "  ![A lane lighting up](v1.2.0/lane.webp)",
        "",
        "## Fixes",
        "",
        "- **Discard all deletes new files too,** and **Undo** puts them back.",
        "- A line with no name.",
        "",
        "<!-- release page only: the update window stops here -->",
        "",
        "## Installing",
        "",
        "- **macOS:** the `.dmg`.",
      ].join("\n"),
    );
    expect(notes.headline).toBe("Lanes that light up, and fewer surprises.");
    expect(notes.sections.map((section) => section.name)).toEqual(["New", "Fixes"]);
    expect(notes.sections[0].items).toEqual([
      { title: "A branch's lane lights up", text: "point at a branch, and its lane lights up.", picture: { path: "v1.2.0/lane.webp", src: "", alt: "A lane lighting up" } },
    ]);
    // A name that runs on into its sentence keeps the whole sentence.
    expect(notes.sections[1].items[0]).toEqual({ title: "Discard all deletes new files too", text: "**Discard all deletes new files too,** and **Undo** puts them back." });
    expect(notes.sections[1].items[1]).toEqual({ title: "", text: "A line with no name." });
  });

  it("reads notes with Windows line endings the same", () => {
    // The Windows installer is built on Windows, where git checks the notes out with them.
    const notes = "A headline.\n\n## New\n\n- **A thing:** it works.\n\n  ![It, working](v1.2.0/thing.webp)\n\n## Fixes\n\n- **A fix,** fixed.\n";
    expect(parseNotes("1.2.0", notes.replace(/\n/g, "\r\n"))).toEqual(parseNotes("1.2.0", notes));
    expect(parseNotes("1.2.0", notes.replace(/\n/g, "\r\n")).sections.map((section) => section.items.length)).toEqual([1, 1]);
  });

  it("has every version's notes from docs/release-notes, newest first", () => {
    const versions = RELEASES.map((r) => r.version);
    expect(versions).toContain("0.5.0");
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
    for (const notes of RELEASES) {
      expect(notes.headline, notes.version).not.toBe("");
      expect(notes.sections.length, notes.version).toBeGreaterThan(0);
      // The release page's own part (installing) isn't news.
      expect(notes.sections.map((section) => section.name), notes.version).not.toContain("Installing");
    }
  });

  // The rule (CLAUDE.md, docs/development.md): from 0.5.0 on, each new thing in a version's
  // notes has a picture of it working, recorded with tools/preview/clips.mjs.
  it("has a picture of every new thing, from 0.5.0 on", () => {
    for (const notes of RELEASES.filter((release) => compareVersions(release.version, "0.5.0") >= 0)) {
      for (const item of featured(notes).items) {
        const where = `${notes.version}: "${item.title}"`;
        expect(item.picture, `${where} has no picture: record one with tools/preview/clips.mjs and put it under the item`).toBeDefined();
        expect(item.picture!.alt, `${where}: say what its picture shows`).not.toBe("");
        expect(item.picture!.src, `${where}: there's no docs/release-notes/${item.picture!.path}`).not.toBe("");
      }
    }
  });

  it("keeps the pictures small, as they're built into the app", () => {
    for (const notes of RELEASES) {
      for (const item of notes.sections.flatMap((section) => section.items)) {
        if (!item.picture) continue;
        const file = `docs/release-notes/${item.picture.path}`;
        const where = new URL(`../../${file}`, import.meta.url);
        expect(statSync(where).size as number, `${file} is over 400 KB: a shorter scene, or a smaller part of the window`).toBeLessThanOrEqual(400 * 1024);
        // Animated WebP, PNG or GIF, as the extension says.
        const head: string = readFileSync(where).subarray(0, 12).toString("latin1");
        expect(head.startsWith("RIFF") || head.startsWith("\x89PNG") || head.startsWith("GIF8"), file).toBe(true);
      }
    }
  });

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
