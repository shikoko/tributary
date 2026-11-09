import { describe, expect, it } from "vitest";
import { isPatchFile, patchFileName } from "./patches";

describe("patches", () => {
  it("names patch files after the newest commit", () => {
    expect(patchFileName("Barber v2: new hair & apron", 1)).toBe("barber-v2-new-hair-apron.patch");
    expect(patchFileName("Door creak", 3)).toBe("door-creak-and-2-more.patch");
    expect(patchFileName("!!!", 1)).toBe("changes.patch");
  });

  it("knows patch files", () => {
    expect(isPatchFile("/tmp/fix.PATCH")).toBe(true);
    expect(isPatchFile("C:\\mail\\0001-door.eml")).toBe(true);
    expect(isPatchFile("/tmp/notes.txt")).toBe(false);
  });
});
