import { describe, expect, it } from "vitest";
import { hang, hangsFrom, JOINT_GAP, meets, snap } from "./joint";

const button = { left: 100, top: 6, right: 124, bottom: 30 };

describe("a panel joined to its button", () => {
  it("lines up its left edge with the button's, or its right edge, as asked", () => {
    expect(hang(button, 300, 1280, "left", 8)).toBe(100);
    expect(hang({ left: 900, top: 6, right: 940, bottom: 30 }, 300, 1280, "right", 8)).toBe(640);
  });

  it("takes the other edge when the one asked for doesn't fit in the window", () => {
    // From the left it would run off the window's right side.
    expect(hang({ left: 1100, top: 6, right: 1140, bottom: 30 }, 300, 1280, "left", 8)).toBe(840);
    // From the right it would run off its left side.
    expect(hang({ left: 20, top: 6, right: 60, bottom: 30 }, 300, 1280, "right", 8)).toBe(20);
  });

  it("stays inside the window when neither edge fits", () => {
    expect(hang({ left: 300, top: 6, right: 330, bottom: 30 }, 600, 640, "left", 8)).toBe(32);
    expect(hang({ left: 2, top: 6, right: 20, bottom: 30 }, 600, 640, "right", 8)).toBe(8);
  });

  it("is square at the corners that meet the button's sides", () => {
    expect(meets(button, 100, 300)).toEqual({ left: true, right: false });
    expect(meets(button, -176, 300)).toEqual({ left: false, right: true });
    expect(meets(button, 80, 300)).toEqual({ left: false, right: false });
  });

  it("is joined only when it hangs from the button, not pushed up or opened above it", () => {
    expect(hangsFrom(button, 30 + JOINT_GAP)).toBe(true);
    expect(hangsFrom(button, 20)).toBe(false);
  });

  it("puts the button on whole pixels, for sharp lines", () => {
    expect(snap({ left: 10.4, top: 5.6, right: 40.5, bottom: 30.2 })).toEqual({ left: 10, top: 6, right: 41, bottom: 30 });
  });
});
