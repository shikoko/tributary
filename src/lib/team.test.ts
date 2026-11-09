import { describe, expect, it } from "vitest";
import { assignSlots, change, dayStart, labelledDays, median, nextDay, perDay, periodDays, previousPerDay, punchCard, rhythm, roughDuration, smoothPath, withoutRemote } from "./team";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe("team activity charts", () => {
  it("lists the days from the period's start to today", () => {
    const now = at(2026, 3, 10, 15);
    const since = (now - 7 * 24 * 3600 * 1000) / 1000;
    const days = periodDays(since, now);
    expect(days).toHaveLength(8);
    expect(days[0]).toBe(at(2026, 3, 3));
    expect(days[7]).toBe(dayStart(now));
  });

  it("counts commits per day, leaving out those outside the period", () => {
    const days = [at(2026, 3, 1), at(2026, 3, 2), at(2026, 3, 3)];
    const times = [at(2026, 3, 1, 9), at(2026, 3, 1, 23, 59), at(2026, 3, 3, 0, 1), at(2026, 2, 28, 12), at(2026, 3, 4, 1)].map((ms) => ms / 1000);
    expect(perDay(times, days)).toEqual([2, 0, 1]);
  });

  it("keeps everyone's colour when others come and go", () => {
    const first = assignSlots(new Map(), ["rosa@example.com", "Theo@example.com"]);
    expect([...first.entries()]).toEqual([
      ["rosa@example.com", 1],
      ["theo@example.com", 2],
    ]);
    const later = assignSlots(first, ["maya@example.com", "theo@example.com"]);
    expect(later.get("theo@example.com")).toBe(2);
    expect(later.get("maya@example.com")).toBe(3);
    const crowd = assignSlots(new Map(), Array.from({ length: 10 }, (_, i) => `p${i}@example.com`));
    expect(crowd.get("p9@example.com")).toBe(10);
  });

  it("draws a smooth line that doesn't bulge past its points", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[0, 40]])).toBe("M0,40");
    const path = smoothPath([
      [0, 100],
      [1, 20],
      [2, 100],
      [3, 100],
    ]);
    expect(path.startsWith("M0,100 C")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(3);
    // Every control point stays between the lowest and highest point.
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it("steps through days and labels axes", () => {
    expect(nextDay(at(2026, 3, 1))).toBe(at(2026, 3, 2));
    const week = labelledDays(8);
    expect([0, 7].every(week)).toBe(true);
    const month = labelledDays(31);
    expect([30, 23, 16].every(month)).toBe(true);
    expect(month(29)).toBe(false);
    expect(withoutRemote("origin/feat/door")).toBe("feat/door");
    expect(withoutRemote("feat/door")).toBe("feat/door");
  });

  it("compares with the period before", () => {
    expect(change(12, 10)).toBe(20);
    expect(change(5, 10)).toBe(-50);
    expect(change(3, 0)).toBeNull();
    const days = [at(2026, 3, 8), at(2026, 3, 9), at(2026, 3, 10)];
    const times = [at(2026, 3, 5, 10), at(2026, 3, 7, 9), at(2026, 3, 7, 18), at(2026, 3, 8, 9)].map((ms) => ms / 1000);
    expect(previousPerDay(times, days)).toEqual([1, 0, 2]);
  });

  it("sums up when and how steadily people commit", () => {
    // Tuesday 3 March 2026, 14:20.
    const grid = punchCard([at(2026, 3, 3, 14, 20) / 1000, at(2026, 3, 8, 23) / 1000]);
    expect(grid[1][14]).toBe(1);
    expect(grid[6][23]).toBe(1);
    expect(rhythm([0, 2, 1, 0, 3, 1, 1, 0])).toEqual({ active: 5, streak: 3 });
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect([600, 3 * 3600, 36 * 3600].map(roughDuration)).toEqual(["10 minutes", "3 hours", "1.5 days"]);
  });
});
