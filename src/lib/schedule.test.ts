import { describe, expect, it } from "vitest";
import { describeRun, dueRun, nextRun } from "./schedule";

// Monday 9 November 2026.
const monday = (hours: number, minutes = 0) => new Date(2026, 10, 9, hours, minutes);

describe("fetch latest on a schedule", () => {
  it("is due from the set time until a while after", () => {
    expect(dueRun("daily", "07:00", monday(6, 59))).toBeNull();
    expect(dueRun("daily", "07:00", monday(7, 0))).toBe("2026-11-09 07:00");
    expect(dueRun("daily", "07:00", monday(7, 45))).toBe("2026-11-09 07:00");
    // Woken long after: skipped today.
    expect(dueRun("daily", "07:00", monday(9, 30))).toBeNull();
    expect(dueRun("off", "07:00", monday(7, 0))).toBeNull();
  });

  it("skips weekends when it's weekdays only", () => {
    const saturday = new Date(2026, 10, 14, 7, 5);
    expect(dueRun("weekdays", "07:00", saturday)).toBeNull();
    expect(dueRun("daily", "07:00", saturday)).toBe("2026-11-14 07:00");
    // Friday evening: next on Monday.
    expect(nextRun("weekdays", "07:00", new Date(2026, 10, 13, 18, 0))).toEqual(new Date(2026, 10, 16, 7, 0));
    expect(nextRun("daily", "07:00", monday(6, 0))).toEqual(monday(7, 0));
    expect(nextRun("off", "07:00", monday(6, 0))).toBeNull();
  });

  it("sums up how it went", () => {
    const ok = (name: string) => ({ name, ok: true, message: "Pulled main" });
    const failed = (name: string) => ({ name, ok: false, message: "Conflicts" });
    expect(describeRun({ time: 0, results: [ok("studio"), ok("notebook")] })).toBe("Fetched the latest of 2 repositories");
    expect(describeRun({ time: 0, results: [ok("studio")] })).toBe("Fetched the latest of studio");
    expect(describeRun({ time: 0, results: [ok("studio"), failed("notebook")] })).toBe("Fetched the latest of 1 of 2 repositories; not notebook");
    expect(describeRun({ time: 0, results: [failed("studio")] })).toBe("Couldn't fetch the latest of studio");
  });
});
