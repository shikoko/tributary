import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitRow } from "../api";
import { laneHover, laneOf } from "./lanes";

const commit = (id: string, column: number, parents: string[]) => ({ id, parents, graph: { column, lines: [] } }) as unknown as CommitRow;

describe("laneOf", () => {
  // feature (column 1) has two commits on main (column 0), which goes back to the root.
  const commits = [commit("f2", 1, ["f1"]), commit("m3", 0, ["m2"]), commit("f1", 1, ["m2"]), commit("m2", 0, ["m1"]), commit("m1", 0, [])];
  const indexById = new Map(commits.map((each, index) => [each.id, index]));

  it("follows a branch's first parents while they stay in its column", () => {
    const lane = laneOf(commits, indexById, "f2")!;
    expect([...lane.ids]).toEqual(["f2", "f1"]);
    expect(lane.last).toBe("f1");
    expect(lane.column).toBe(1);
  });

  it("goes down to the start of history in the main lane", () => {
    expect([...laneOf(commits, indexById, "m3")!.ids]).toEqual(["m3", "m2", "m1"]);
  });

  it("knows nothing of commits that aren't loaded", () => {
    expect(laneOf(commits, indexById, "elsewhere")).toBeNull();
  });
});

describe("laneHover", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const start = () => {
    const lit: (string | null)[] = [];
    return { lit, lanes: laneHover((commitId) => lit.push(commitId)) };
  };

  it("lights a lane up a moment after the pointer reaches its label", () => {
    const { lit, lanes } = start();
    lanes.hover("a");
    vi.advanceTimersByTime(100);
    expect(lit).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(lit).toEqual(["a"]);
  });

  it("lights nothing while the pointer passes over labels", () => {
    const { lit, lanes } = start();
    for (const commitId of ["a", "b", "c"]) {
      lanes.hover(commitId);
      vi.advanceTimersByTime(40);
      lanes.hover(null);
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(1000);
    expect(lit).toEqual([]);
  });

  it("goes from one lit lane to the next straight away, and goes out after leaving", () => {
    const { lit, lanes } = start();
    lanes.hover("a");
    vi.advanceTimersByTime(150);
    lanes.hover(null);
    vi.advanceTimersByTime(30);
    lanes.hover("b");
    expect(lit).toEqual(["a", "b"]);
    lanes.hover(null);
    vi.advanceTimersByTime(100);
    expect(lit).toEqual(["a", "b", null]);
  });
});
