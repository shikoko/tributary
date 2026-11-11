import { describe, expect, it } from "vitest";
import { ciOffset, DEFAULT_COLUMNS, fitColumns, rowRange } from "./layout";

const fit = (width: number, lanes: number, extra: Partial<Parameters<typeof fitColumns>[0]> = {}) =>
  fitColumns({
    width,
    narrow: width < 760,
    lanes,
    laneWidth: 28,
    columnWidths: { refs: null, graph: null },
    show: DEFAULT_COLUMNS,
    authorsOnGraph: true,
    ...extra,
  });

describe("fitting the graph's lanes", () => {
  it("is as wide as the lanes need when there's room", () => {
    expect(fit(1200, 3).graphWidth).toBe(10 * 2 + 3 * 28);
    expect(fit(1200, 1).graphWidth).toBe(72);
  });

  it("gives many lanes up to 40% of a wide list", () => {
    // 14 lanes need 412 px: more than the usual 320, and within 40% of 1200.
    expect(fit(1200, 14).graphWidth).toBe(10 * 2 + 14 * 28);
    // 30 lanes would need 860 px: they get 40% (480 px), and the rest stay off the edge.
    expect(fit(1200, 30).graphWidth).toBe(480);
    // A narrower list keeps the 320 px most.
    expect(fit(700, 14).graphWidth).toBeLessThanOrEqual(320);
  });

  it("keeps every lane in a narrow list: the message, the branch column, then the dates give way", () => {
    // A 500 px list (a side panel open): the message gives way first.
    expect(fit(500, 3)).toMatchObject({ graphWidth: 104, refsWidth: 140, dateWidth: 116 });
    // A little more: the labels give a little (8 px).
    expect(fit(500, 4)).toMatchObject({ graphWidth: 132, refsWidth: 132, dateWidth: 116 });
    // More than they can: the dates make way, and the labels get their width back.
    expect(fit(500, 5)).toMatchObject({ graphWidth: 160, refsWidth: 140, dateWidth: 0 });
    // A 395 px list: before, the graph stayed at 72 px and cut off the third lane. The dates
    // make way, and the labels keep their width.
    expect(fit(395, 3)).toMatchObject({ graphWidth: 104, refsWidth: 140, dateWidth: 0 });
    // Many lanes in a narrow list: the labels shrink as far as they go.
    const many = fit(395, 8);
    expect(many.dateWidth).toBe(0);
    expect(many.refsWidth).toBe(80);
    expect(many.graphWidth).toBe(395 - 80 - 120);
  });

  it("keeps a graph width chosen by dragging as the least it gets", () => {
    // Wider than the lanes need: kept as it is.
    expect(fit(1200, 2, { columnWidths: { refs: null, graph: 200 } }).graphWidth).toBe(200);
    // Narrower than the lanes need: it widens for them, as it would without the choice.
    expect(fit(1200, 5, { columnWidths: { refs: null, graph: 110 } }).graphWidth).toBe(10 * 2 + 5 * 28);
    // Even past the usual most, when there's room.
    expect(fit(1600, 14, { columnWidths: { refs: null, graph: 110 } }).graphWidth).toBe(10 * 2 + 14 * 28);
    // In a narrow list the message gives way as usual, but the graph never goes under the choice.
    expect(fit(500, 9, { columnWidths: { refs: 200, graph: 90 } })).toMatchObject({ refsWidth: 200 });
    expect(fit(500, 9, { columnWidths: { refs: 200, graph: 90 } }).graphWidth).toBeGreaterThanOrEqual(90);
  });

  it("leaves a branch column width chosen by dragging as it is", () => {
    expect(fit(500, 6, { columnWidths: { refs: 200, graph: null } }).refsWidth).toBe(200);
  });
});

describe("ciOffset", () => {
  it("puts a CI dot half outside a node's edge", () => {
    // A 25px node (a 21px picture in a 2px ring): its centre 13.5px out along the diagonal.
    expect(ciOffset({ avatar: true, dense: false, head: false, merge: false })).toBe(9.5);
    // A plain dot: 7.5px out.
    expect(ciOffset({ avatar: false, dense: false, head: false, merge: false })).toBe(5.5);
  });

  it("follows the node's size", () => {
    // The checked-out commit's ring is thicker; compact rows and merges are smaller.
    expect(ciOffset({ avatar: true, dense: false, head: true, merge: false })).toBe(10.5);
    expect(ciOffset({ avatar: true, dense: true, head: false, merge: false })).toBe(7);
    expect(ciOffset({ avatar: false, dense: false, head: false, merge: true })).toBe(3.5);
  });
});

describe("rowRange", () => {
  it("renders the rows on screen and a few around them", () => {
    expect(rowRange(280, 28, 280, 100)).toEqual({ first: 0, last: 32, firstOnScreen: 10, lastOnScreen: 20 });
  });

  it("asks for no row above the list while macOS bounces past its top", () => {
    // The list pulled 30 px past its top: scrollTop is negative.
    const range = rowRange(-30, 28, 280, 100);
    expect(range.firstOnScreen).toBe(0);
    expect(range.first).toBe(0);
    expect(range.lastOnScreen).toBe(10);
  });

  it("asks for no row below the list while it bounces past its end", () => {
    const range = rowRange(100 * 28 + 40, 28, 280, 100);
    expect(range.firstOnScreen).toBeLessThanOrEqual(100);
    expect(range.lastOnScreen).toBe(100);
    expect(range.last).toBe(100);
  });
});
