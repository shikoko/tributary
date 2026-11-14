import { describe, expect, it } from "vitest";
import { dropIndex, moved } from "./order";

describe("moving an item in a list", () => {
  it("moves it later, earlier, or not at all", () => {
    expect(moved(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moved(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("leaves the list it was given alone", () => {
    const list = ["a", "b"];
    moved(list, 0, 1);
    expect(list).toEqual(["a", "b"]);
  });
});

describe("where a dragged tab goes", () => {
  // Three tabs 100px wide, 2px apart.
  const slots = [0, 102, 204].map((left) => ({ left, right: left + 100 }));

  it("stays until its leading edge passes a neighbour's middle", () => {
    expect(dropIndex(slots, 0, 0)).toBe(0);
    expect(dropIndex(slots, 0, 50)).toBe(0);
    expect(dropIndex(slots, 0, 53)).toBe(1);
    expect(dropIndex(slots, 2, -50)).toBe(2);
    expect(dropIndex(slots, 2, -53)).toBe(1);
  });

  it("goes past every neighbour it has crossed, either way", () => {
    expect(dropIndex(slots, 0, 160)).toBe(2);
    expect(dropIndex(slots, 2, -204)).toBe(0);
    expect(dropIndex(slots, 1, -60)).toBe(0);
    expect(dropIndex(slots, 1, 60)).toBe(2);
  });

  it("stops at the ends", () => {
    expect(dropIndex(slots, 2, 500)).toBe(2);
    expect(dropIndex(slots, 0, -500)).toBe(0);
  });
});
