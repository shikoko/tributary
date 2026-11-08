import { describe, expect, it } from "vitest";
import type { Hunk } from "../api";
import { changedKeys, keysBetween, lineKey, linesOf } from "./lineSelection";

const hunk: Hunk = {
  section: "",
  lines: [
    { kind: "context", old: 1, new: 1, text: "one" },
    { kind: "removed", old: 2, new: null, text: "two" },
    { kind: "added", old: null, new: 2, text: "TWO" },
    { kind: "added", old: null, new: 3, text: "two and a half" },
    { kind: "context", old: 3, new: 4, text: "three" },
  ],
};

describe("line selection", () => {
  it("knows changed lines by sign and number", () => {
    expect(lineKey(hunk.lines[0])).toBeNull();
    expect(changedKeys([hunk])).toEqual(["-2", "+2", "+3"]);
  });

  it("picks ranges either way round", () => {
    const order = changedKeys([hunk]);
    expect(keysBetween(order, "+3", "-2")).toEqual(["-2", "+2", "+3"]);
    expect(keysBetween(order, "-2", "-2")).toEqual(["-2"]);
  });

  it("sends added and removed lines apart, in order", () => {
    expect(linesOf(["+3", "-2", "+2"])).toEqual({ added: [2, 3], removed: [2] });
  });
});
