import { describe, expect, it } from "vitest";
import { conflictsIn, parseConflicts, resolvedText } from "./conflicts";

const MERGED = `top
<<<<<<< HEAD
mine
=======
theirs
>>>>>>> feature
middle
<<<<<<< HEAD
a
||||||| base
original
=======
b
>>>>>>> feature
bottom
`;

describe("conflicts", () => {
  it("finds the conflicts and what's around them", () => {
    const segments = parseConflicts(MERGED)!;
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "conflict", "text", "conflict", "text"]);
    const [first, second] = conflictsIn(segments);
    expect(first).toMatchObject({ ours: "mine\n", theirs: "theirs\n", base: null, oursLabel: "HEAD", theirsLabel: "feature" });
    expect(second).toMatchObject({ ours: "a\n", base: "original\n", theirs: "b\n" });
  });

  it("puts the file back together from the choices", () => {
    const segments = parseConflicts(MERGED)!;
    expect(resolvedText(segments, ["ours"])).toBeNull();
    expect(resolvedText(segments, ["theirs", "ours-then-theirs"])).toBe("top\ntheirs\nmiddle\na\nb\nbottom\n");
    expect(resolvedText(segments, [{ text: "both\n" }, "theirs-then-ours"])).toBe("top\nboth\nmiddle\nb\na\nbottom\n");
  });

  it("keeps Windows line endings", () => {
    const segments = parseConflicts("x\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> other\r\ny\r\n")!;
    expect(resolvedText(segments, ["ours-then-theirs"])).toBe("x\r\nmine\r\ntheirs\r\ny\r\n");
  });

  it("gives up on markers that don't add up", () => {
    expect(parseConflicts("<<<<<<< HEAD\nmine\n")).toBeNull();
    expect(parseConflicts("=======\n")).toBeNull();
    // Seven equals signs inside a line aren't a marker.
    expect(parseConflicts("a ======= b\n")).toEqual([{ kind: "text", text: "a ======= b\n" }]);
  });
});
