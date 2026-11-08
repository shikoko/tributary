import { describe, expect, it } from "vitest";
import type { Submodule } from "../api";
import { outOfDate, submoduleName, submoduleNote, submoduleNotice } from "./submodules";

const submodule = (path: string, state: Submodule["state"], more: Partial<Submodule> = {}): Submodule => ({
  name: path,
  path,
  url: null,
  state,
  recorded: "a",
  current: "b",
  behind: 0,
  ahead: 0,
  changed: false,
  ...more,
});

describe("submodules", () => {
  it("names a submodule by its folder", () => {
    expect(submoduleName(submodule("vendor/editor-kit", "upToDate"))).toBe("editor-kit");
  });

  it("notes what needs doing", () => {
    expect(submoduleNote(submodule("a", "upToDate"))).toBeNull();
    expect(submoduleNote(submodule("a", "upToDate", { changed: true }))).toBe("changed");
    expect(submoduleNote(submodule("a", "behind"))).toBe("out of date");
    expect(submoduleNote(submodule("a", "ahead"))).toBe("new commits");
  });

  it("offers to update the ones out of date, but not the ones moved on purpose", () => {
    const list = [submodule("vendor/kit", "behind"), submodule("vendor/icons", "ahead"), submodule("docs/theme", "notSetUp")];
    expect(outOfDate(list).map((s) => s.path)).toEqual(["vendor/kit"]);
    // Unless a checkout just left it ahead.
    expect(outOfDate(list, new Set(["vendor/icons"])).map((s) => s.path)).toEqual(["vendor/kit", "vendor/icons"]);
    expect(submoduleNotice(list)).toEqual({
      text: "Your copy of the submodule kit is older than the version this branch uses.",
      paths: ["vendor/kit"],
      action: "Update it",
    });
  });

  it("offers to set them up when none are", () => {
    const notice = submoduleNotice([submodule("a", "notSetUp"), submodule("b", "notSetUp")]);
    expect(notice?.action).toBe("Set them up");
    // Some set up and some not: leaving one out may be on purpose.
    expect(submoduleNotice([submodule("a", "notSetUp"), submodule("b", "upToDate")])).toBeNull();
  });
});
