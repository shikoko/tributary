import { describe, expect, it } from "vitest";
import { comparePixels, describePixelChanges } from "./pixels";

/** A width × height picture of one colour. */
function picture(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
}

describe("comparePixels", () => {
  it("finds the changed pixels and the area they're in", () => {
    const before = picture(4, 3, [10, 20, 30, 255]);
    const after = picture(4, 3, [10, 20, 30, 255]);
    after.set([10, 20, 31, 255], (1 * 4 + 1) * 4); // (1, 1)
    after.set([99, 20, 30, 255], (2 * 4 + 3) * 4); // (3, 2)
    const out = new Uint8ClampedArray(after.length);
    const changes = comparePixels(before, after, 4, 3, out, [255, 0, 128]);
    expect(changes).toEqual({ changed: 2, total: 12, area: { x: 1, y: 1, width: 3, height: 2 } });
    expect(Array.from(out.slice(20, 24))).toEqual([255, 0, 128, 255]);
    // The rest is grey and dimmed.
    const [r, g, b, a] = Array.from(out.slice(0, 4));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeLessThan(10);
    expect(a).toBe(255);
  });

  it("treats transparent pixels as the same whatever their colour", () => {
    const before = picture(2, 1, [255, 0, 0, 0]);
    const after = picture(2, 1, [0, 255, 0, 0]);
    const changes = comparePixels(before, after, 2, 1, new Uint8ClampedArray(8), [255, 0, 0]);
    expect(changes.changed).toBe(0);
    expect(changes.area).toBeNull();
  });
});

describe("describePixelChanges", () => {
  it("says how much changed, and where", () => {
    expect(describePixelChanges({ changed: 1204, total: 150_000, area: { x: 340, y: 210, width: 120, height: 80 } })).toBe(
      "1,204 pixels changed (0.8%), in a 120 × 80 area at 340, 210.",
    );
    expect(describePixelChanges({ changed: 1, total: 1_000_000, area: { x: 0, y: 0, width: 1, height: 1 } })).toBe(
      "1 pixel changed (under 0.1%), in a 1 × 1 area at 0, 0.",
    );
    expect(describePixelChanges({ changed: 12, total: 12, area: { x: 0, y: 0, width: 4, height: 3 } })).toBe("Every pixel changed (12).");
    expect(describePixelChanges({ changed: 0, total: 12, area: null })).toMatch(/^No pixels changed/);
  });
});
