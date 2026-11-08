import { describe, expect, it } from "vitest";
import { bisectMarks } from "./bisect";

describe("bisectMarks", () => {
  it("marks the commits tested, and the one found", () => {
    const marks = bisectMarks({ start: "main", bad: "b", good: ["g1", "g2"], skipped: ["s"], left: 1, steps: 0, found: "b" });
    expect([...marks.entries()]).toEqual([
      ["g1", "good"],
      ["g2", "good"],
      ["s", "skipped"],
      ["b", "found"],
    ]);
    expect(bisectMarks(null).size).toBe(0);
  });
});
