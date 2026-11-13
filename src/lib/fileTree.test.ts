import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { fileTreeRows, type TreeRow } from "./fileTree";

const file = (path: string, status: FileChange["status"] = "modified"): FileChange => ({ path, oldPath: null, status });

/** Rows as text: "  Content/Props/ (+1 ~1 -0)" for a folder, "    Chair.uasset" for a file. */
const text = (rows: TreeRow[]) =>
  rows.map((row) =>
    row.kind === "folder"
      ? `${"  ".repeat(row.depth)}${row.name}/${row.open ? "" : " (closed)"} (+${row.counts.added} ~${row.counts.changed} -${row.counts.deleted})`
      : `${"  ".repeat(row.depth)}${row.file.path.split("/").filter(Boolean).pop()}`,
  );

describe("the changed files as a tree", () => {
  it("puts files under their folders, folders first, each by name", () => {
    const rows = fileTreeRows([file("README.md"), file("src/b.ts"), file("src/a.ts", "added"), file("docs/guide.md", "deleted")]);
    expect(text(rows)).toEqual(["docs/ (+0 ~0 -1)", "  guide.md", "src/ (+1 ~1 -0)", "  a.ts", "  b.ts", "README.md"]);
  });

  it("joins a chain of folders with nothing else in them into one row", () => {
    const rows = fileTreeRows([file("Content/Props/Chair.uasset", "added"), file("Content/Props/Stool.uasset"), file("Content/Maps/Tavern.umap")]);
    expect(text(rows)).toEqual(["Content/ (+1 ~2 -0)", "  Maps/ (+0 ~1 -0)", "    Tavern.umap", "  Props/ (+1 ~1 -0)", "    Chair.uasset", "    Stool.uasset"]);
    const deep = fileTreeRows([file("Source/Feast/Game/Mode.cpp"), file("Source/Feast/Game/Mode.h")]);
    expect(text(deep)).toEqual(["Source/Feast/Game/ (+0 ~2 -0)", "  Mode.cpp", "  Mode.h"]);
    expect(deep[0].kind === "folder" && deep[0].path).toBe("Source/Feast/Game");
  });

  it("leaves out what's in a closed folder, and still counts it", () => {
    const rows = fileTreeRows([file("src/a.ts"), file("src/lib/b.ts", "deleted"), file("top.txt")], new Set(["src"]));
    expect(text(rows)).toEqual(["src/ (closed) (+0 ~1 -1)", "top.txt"]);
  });

  it("sorts names as people do, and lists an untracked folder as a file", () => {
    const rows = fileTreeRows([file("level10.umap"), file("level2.umap"), file("Notes/", "untracked")]);
    expect(text(rows)).toEqual(["level2.umap", "level10.umap", "Notes"]);
  });
});
