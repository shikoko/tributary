import { describe, expect, it } from "vitest";
import { baseName, folderOf, joinPath, parentFolder, relativeTo } from "./paths";

describe("relativeTo", () => {
  it("makes paths relative to the repository", () => {
    expect(relativeTo("/work/feast", "/work/feast/Content/Hero.uasset")).toBe("Content/Hero.uasset");
    expect(relativeTo("/work/feast/", "/work/feast/a.txt")).toBe("a.txt");
  });

  it("handles Windows paths, whatever the case of the folder names", () => {
    expect(relativeTo("C:\\Projects\\Feast", "c:\\projects\\feast\\Content\\Hero.uasset")).toBe("Content/Hero.uasset");
  });

  it("refuses paths outside it, and the folder itself", () => {
    expect(relativeTo("/work/feast", "/work/feast-old/a.txt")).toBeNull();
    expect(relativeTo("/work/feast", "/work/feast")).toBeNull();
    expect(relativeTo("/work/feast", "/elsewhere/a.txt")).toBeNull();
  });
});

describe("names", () => {
  it("splits paths into folder and file", () => {
    expect(baseName("Content/Characters/Hero.uasset")).toBe("Hero.uasset");
    expect(baseName("Content/Maps/")).toBe("Maps");
    expect(folderOf("Content/Characters/Hero.uasset")).toBe("Content/Characters");
    expect(folderOf("README.md")).toBe("");
  });

  it("joins with the separator the folder uses", () => {
    expect(joinPath("C:\\Projects\\Feast", "Content/Hero.uasset")).toBe("C:\\Projects\\Feast\\Content\\Hero.uasset");
    expect(joinPath("/work/feast/", "Content/Hero.uasset")).toBe("/work/feast/Content/Hero.uasset");
  });
});

describe("parentFolder", () => {
  it("works with either separator", () => {
    expect(parentFolder("/work/notebook")).toBe("/work");
    expect(parentFolder("/work/notebook/")).toBe("/work");
    expect(parentFolder("C:\\work\\notebook")).toBe("C:\\work");
    expect(parentFolder("/notebook")).toBe("/");
  });
});
