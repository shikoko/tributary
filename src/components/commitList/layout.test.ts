import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, fitColumns } from "./layout";

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

  it("leaves widths chosen by dragging as they are", () => {
    expect(fit(500, 9, { columnWidths: { refs: 200, graph: 90 } })).toMatchObject({ refsWidth: 200, graphWidth: 90 });
    // A branch column of a chosen width doesn't give way.
    expect(fit(500, 6, { columnWidths: { refs: 200, graph: null } }).refsWidth).toBe(200);
  });
});
