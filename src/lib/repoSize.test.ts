import { describe, expect, it } from "vitest";
import { kindOf, squarify } from "./repoSize";

describe("repository size", () => {
  it("names kinds of file as Git LFS patterns", () => {
    expect(kindOf("Art/Hero.PSD")).toBe("*.psd");
    expect(kindOf("Makefile")).toBe("Makefile");
    expect(kindOf("Art/.gitkeep")).toBe(".gitkeep");
  });
});

describe("squarify", () => {
  const box = { x: 0, y: 0, w: 400, h: 300 };
  const value = (item: number) => item;

  it("gives each item an area in proportion to it, filling the box", () => {
    const placed = squarify([60, 30, 10], value, box);
    expect(placed.map((tile) => tile.item)).toEqual([60, 30, 10]);
    for (const tile of placed) expect(tile.w * tile.h).toBeCloseTo((tile.item / 100) * 400 * 300, 6);
    for (const tile of placed) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(400 + 1e-9);
      expect(tile.y + tile.h).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  it("keeps tiles close to square", () => {
    const placed = squarify([20, 20, 20, 20, 20, 20], value, { x: 0, y: 0, w: 300, h: 200 });
    for (const tile of placed) expect(Math.max(tile.w / tile.h, tile.h / tile.w)).toBeLessThan(2);
  });

  it("leaves out what's worth nothing, and lays out nothing in an empty box", () => {
    expect(squarify([5, 0, -1], value, box).map((tile) => tile.item)).toEqual([5]);
    expect(squarify([5], value, { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
    expect(squarify([], value, box)).toEqual([]);
  });
});
