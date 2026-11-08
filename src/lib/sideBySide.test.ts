import { describe, expect, it } from "vitest";
import type { DiffLine } from "../api";
import { splitRows } from "./sideBySide";

const line = (kind: DiffLine["kind"], text = kind): DiffLine => ({ kind, text, old: null, new: null }) as DiffLine;

describe("splitRows", () => {
  it("puts unchanged lines on both sides", () => {
    expect(splitRows([line("context"), line("context")])).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 1 },
    ]);
  });

  it("pairs removed lines with the added lines after them", () => {
    const lines = [line("context"), line("removed"), line("removed"), line("added"), line("context")];
    expect(splitRows(lines)).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 3 },
      { left: 2, right: null },
      { left: 4, right: 4 },
    ]);
  });

  it("leaves the left empty for lines only added", () => {
    expect(splitRows([line("added"), line("added"), line("removed")])).toEqual([
      { left: null, right: 0 },
      { left: null, right: 1 },
      { left: 2, right: null },
    ]);
  });
});
