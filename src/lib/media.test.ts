import { describe, expect, it } from "vitest";
import type { FileDiff } from "../api";
import { dataUrlBytes, describeSizes, formatDuration, missingSide } from "./media";

const diff = (sizeBefore: number | null, sizeAfter: number | null) => ({ sizeBefore, sizeAfter }) as FileDiff;

describe("media", () => {
  it("reads a data: URL's bytes", () => {
    expect([...new Uint8Array(dataUrlBytes("data:audio/wav;base64,UklGRg=="))]).toEqual([82, 73, 70, 70]);
  });

  it("formats durations", () => {
    expect(formatDuration(3.42)).toBe("0:03.4");
    expect(formatDuration(65)).toBe("1:05");
  });

  it("says why a side has nothing to show", () => {
    expect(missingSide(diff(null, 10), "before")).toBe("Not there yet");
    expect(missingSide(diff(10, null), "after")).toBe("Deleted");
    expect(missingSide(diff(90_000_000, 10), "before")).toBe("Too big to show here (90 MB)");
    expect(describeSizes(diff(1000, 2000))).toBe("1 KB → 2 KB");
  });
});
