import { describe, expect, it } from "vitest";
import { stepFocus } from "./inputMode";

describe("stepFocus", () => {
  const items = ["a", "b", "c"];
  it("moves with the arrow keys and wraps around", () => {
    expect(stepFocus(items, null, "ArrowDown")).toBe("a");
    expect(stepFocus(items, null, "ArrowUp")).toBe("c");
    expect(stepFocus(items, "c", "ArrowDown")).toBe("a");
    expect(stepFocus(items, "a", "ArrowUp")).toBe("c");
    expect(stepFocus(items, "b", "ArrowRight")).toBe("c");
  });
  it("jumps to the ends, and ignores other keys", () => {
    expect(stepFocus(items, "b", "Home")).toBe("a");
    expect(stepFocus(items, "b", "End")).toBe("c");
    expect(stepFocus(items, "b", "x")).toBeNull();
    expect(stepFocus([], null, "ArrowDown")).toBeNull();
  });
});
