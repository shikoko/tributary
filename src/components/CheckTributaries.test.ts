import { describe, expect, it } from "vitest";
import { blend } from "./CheckTributaries";

describe("blend", () => {
  it("mixes the colours of the waves that reach the river, in proportion", () => {
    expect(blend([])).toBeNull();
    expect(blend(["success", "success"])).toBe("var(--success)");
    // Three green and one amber: a quarter amber in green.
    expect(blend(["success", "success", "success", "pending"])).toBe("color-mix(in oklch, var(--warning) 25%, var(--success))");
  });
});
