import { describe, expect, it } from "vitest";
import { askAgainIn } from "./ciStates";

describe("askAgainIn", () => {
  it("asks again soon while checks run, later while some failed, and not once all passed", () => {
    expect(askAgainIn(["success", "pending", "failure"])).toBe(60_000);
    // A failed one may be run again on the site: its dot mustn't stay red when it is.
    expect(askAgainIn(["success", "failure"])).toBe(120_000);
    expect(askAgainIn(["success", "success"])).toBeNull();
    expect(askAgainIn([])).toBeNull();
  });
});
