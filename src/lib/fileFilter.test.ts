import { describe, expect, it } from "vitest";
import { filterFiles } from "./fileFilter";

const files = ["Content/Maps/Tavern.umap", "Content/Characters/Barber.uasset", "Source/Feast/FeastGameMode.cpp"].map((path) => ({
  path,
  oldPath: null as string | null,
}));

describe("filterFiles", () => {
  it("keeps the files with every word in their path, whatever the case", () => {
    expect(filterFiles(files, "maps TAVERN").map((f) => f.path)).toEqual(["Content/Maps/Tavern.umap"]);
    expect(filterFiles(files, "content").length).toBe(2);
    expect(filterFiles(files, "  ").length).toBe(3);
    expect(filterFiles(files, "nothing")).toEqual([]);
  });

  it("finds a renamed file by its old path too", () => {
    expect(filterFiles([{ path: "b.txt", oldPath: "old/a.txt" }], "old/a")).toHaveLength(1);
  });
});
