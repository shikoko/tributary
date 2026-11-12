import { describe, expect, it } from "vitest";
import type { CommitRow } from "../../api";
import type { CanvasColors } from "../../lib/appearance";
import { markRect, marksNear, scrollMarks } from "./canvases";

const commit = (id: string, column: number, branches: string[] = []) =>
  ({ id, graph: { column, lines: [] }, refs: branches.map((name) => ({ kind: "branch", name, current: false })) }) as unknown as CommitRow;

const colors = { lanes: ["#lane0", "#lane1"], match: "#match", accent: "#accent", ring: "#ring" } as unknown as CanvasColors;

describe("scrollMarks", () => {
  // Four commits in four rows of 10px, on a strip as tall as the list: row middles at 5, 15, 25, 35.
  const commits = [commit("a", 0, ["main"]), commit("b", 1), commit("c", 1, ["feat/door"]), commit("d", 0)];
  const indexById = new Map(commits.map((each, index) => [each.id, index]));
  const marks = scrollMarks({
    commits,
    slotOf: [0, 1, 2, 3],
    indexById,
    rowHeight: 10,
    contentHeight: 40,
    height: 40,
    matchIds: new Set(["b"]),
    headId: "a",
    selectedIds: new Set(["c"]),
    colors,
  });

  it("marks branch tips in their lanes' colours, then matches, the checked-out commit and the selection", () => {
    expect(marks.map((mark) => [mark.kind, mark.index, mark.y, mark.color])).toEqual([
      ["branch", 0, 5, "#lane0"],
      ["branch", 2, 25, "#lane1"],
      ["match", 1, 15, "#match"],
      ["head", 0, 5, "#accent"],
      ["selected", 2, 25, "#ring"],
    ]);
  });

  it("finds the marks within a few pixels of the pointer, nearest first", () => {
    expect(marksNear(marks, 24).map((mark) => [mark.kind, mark.index])).toEqual([
      ["branch", 2],
      ["selected", 2],
    ]);
    expect(marksNear(marks, 11).map((mark) => mark.kind)).toEqual(["match"]);
    expect(marksNear(marks, 30)).toEqual([]);
  });

  it("places each mark on the strip: branch tips inset, the checked-out commit full width and thicker", () => {
    const [main, , , head] = marks;
    expect(markRect(main, 12)).toEqual({ x: 3, y: 4, width: 6, height: 2 });
    expect(markRect(head, 12)).toEqual({ x: 0, y: 4, width: 12, height: 3 });
    // A narrower strip takes less off the sides.
    expect(markRect(main, 6)).toEqual({ x: 1.5, y: 4, width: 3, height: 2 });
  });
});
