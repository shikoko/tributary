import { describe, expect, it } from "vitest";
import type { CommitRow } from "../api";
import { dayBucket, slotsFor } from "./days";

// A Friday afternoon.
const now = new Date(2026, 10, 6, 15, 0);
const at = (days: number) => new Date(2026, 10, 6 - days, 10, 0).getTime() / 1000;

describe("dayBucket", () => {
  it("groups by how long ago, with weeks starting on Monday", () => {
    expect(dayBucket(at(0), now).label).toBe("Today");
    expect(dayBucket(at(1), now).label).toBe("Yesterday");
    expect(dayBucket(at(4), now).label).toBe("Earlier this week"); // Monday
    expect(dayBucket(at(5), now).label).toBe("Last week"); // Sunday
    expect(dayBucket(at(11), now).label).toBe("Last week"); // the Monday before
  });

  it("names older months, with the year once it's another year", () => {
    expect(dayBucket(new Date(2026, 8, 3).getTime() / 1000, now).label).toMatch(/September/);
    expect(dayBucket(new Date(2025, 8, 3).getTime() / 1000, now).label).toMatch(/September 2025/);
  });
});

describe("slotsFor", () => {
  const commit = (id: string, days: number): CommitRow =>
    ({ id, kind: "commit", commitTime: at(days), time: at(days), refs: [], parents: [] }) as unknown as CommitRow;

  it("adds a divider before each new period, never going back", () => {
    // The third commit's clock is skewed: it claims to be from today.
    const commits = [commit("a", 0), commit("b", 1), commit("c", 0), commit("d", 1)];
    expect(slotsFor(commits, true, now)).toEqual([{ day: "Today", before: 0 }, 0, { day: "Yesterday", before: 1 }, 1, 2, 3]);
    expect(slotsFor(commits, false, now)).toEqual([0, 1, 2, 3]);
  });
});
