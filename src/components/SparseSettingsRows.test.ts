import { describe, expect, it } from "vitest";
import { foldersToCheckOut } from "./SparseSettingsRows";

describe("foldersToCheckOut", () => {
  it("leaves out folders inside another one chosen", () => {
    expect(foldersToCheckOut(new Set(["Source", "Content/Maps", "Content", "Content/Characters"]))).toEqual(["Content", "Source"]);
    expect(foldersToCheckOut(new Set(["Content/Maps", "ContentOld"]))).toEqual(["Content/Maps", "ContentOld"]);
  });
});
