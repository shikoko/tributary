import { describe, expect, it } from "vitest";
import { isBeta } from "./updates";

describe("isBeta", () => {
  it("tells a beta (or an older build of develop) from a release", () => {
    expect(isBeta("0.3.0-beta.4")).toBe(true);
    expect(isBeta("0.3.0-dev.12")).toBe(true);
    expect(isBeta("0.3.0")).toBe(false);
    expect(isBeta(null)).toBe(false);
  });
});
