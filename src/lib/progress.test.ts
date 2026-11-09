import { describe, expect, it } from "vitest";
import { overallPercent } from "./progress";

describe("overall progress", () => {
  it("counts files when there are some, else uses the percentage", () => {
    expect(overallPercent(null)).toBeNull();
    expect(overallPercent({ phase: "Connecting", percent: null })).toBeNull();
    expect(overallPercent({ phase: "Receiving objects", percent: 45 })).toBe(45);
    // One small file done of thousands: the files say how far it really is.
    expect(overallPercent({ phase: "Downloading LFS files", percent: 100, files: { done: 1204, total: 2468 } })).toBe(49);
    expect(overallPercent({ phase: "Downloading LFS files", percent: 30, files: { done: 0, total: 1 } })).toBe(30);
  });
});
