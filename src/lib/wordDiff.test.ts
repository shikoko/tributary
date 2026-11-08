import { describe, expect, it } from "vitest";
import type { DiffLine } from "../api";
import { changedSpan, wordSegments } from "./wordDiff";

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, old: null, new: null, text });

describe("word diff", () => {
  it("finds the changed middle of a line", () => {
    expect(changedSpan("speed = 10;", "speed = 12;")).toEqual({ start: 9, endBefore: 10, endAfter: 10 });
    expect(changedSpan("same", "same")).toEqual({ start: 4, endBefore: 4, endAfter: 4 });
  });

  it("marks the changed words of paired lines", () => {
    const segments = wordSegments([line("context", "a"), line("removed", "let speed = 10;"), line("added", "let speed = 12;")]);
    expect(segments[0]).toBeNull();
    expect(segments[1]).toEqual([
      { text: "let speed = 1", changed: false },
      { text: "0", changed: true },
      { text: ";", changed: false },
    ]);
    expect(segments[2]?.find((segment) => segment.changed)?.text).toBe("2");
  });

  it("leaves lines without a partner, or changed completely, alone", () => {
    const segments = wordSegments([line("removed", "one"), line("removed", "two"), line("added", "completely different")]);
    expect(segments).toEqual([null, null, null]);
    expect(wordSegments([line("added", "new line")])).toEqual([null]);
  });
});
