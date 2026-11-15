import { describe, expect, it } from "vitest";
import { compactTime, idleFor, initials, plural, relativeTime, utcOffset } from "./format";

describe("dates", () => {
  const now = Date.UTC(2026, 10, 7, 12) / 1000;
  it("says just now for the last minute", () => {
    expect(relativeTime(now - 30, now)).toBe("just now");
    expect(compactTime(now - 30, now)).toBe("just now");
  });

  it("counts back in minutes, hours and days, shorter for the list", () => {
    expect(relativeTime(now - 5 * 60, now)).toBe("5 minutes ago");
    expect(relativeTime(now - 3 * 3600, now)).toBe("3 hours ago");
    expect(relativeTime(now - 86400, now)).toBe("yesterday");
    expect(compactTime(now - 5 * 60, now)).toBe("5 min. ago");
  });

  it("says how long a branch has gone without commits, in months then years", () => {
    const day = 86400;
    expect(idleFor(now - 10 * day, now)).toBe("1 month");
    expect(idleFor(now - 100 * day, now)).toBe("3 months");
    expect(idleFor(now - 400 * day, now)).toBe("over a year");
    expect(idleFor(now - 800 * day, now)).toBe("over 2 years");
  });

  it("writes timezone offsets as UTC±hh:mm", () => {
    expect(utcOffset(3600)).toBe("UTC+01:00");
    expect(utcOffset(-(5 * 3600 + 30 * 60))).toBe("UTC−05:30");
    expect(utcOffset(0)).toBe("UTC+00:00");
  });
});

describe("words", () => {
  it("makes initials from names", () => {
    expect(initials("Rosa Bell")).toBe("RB");
    expect(initials("Maya van der Chen")).toBe("MC");
    expect(initials("theo")).toBe("TH");
    expect(initials("  ")).toBe("?");
  });

  it("counts things", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
    expect(plural(2, "match", "matches")).toBe("2 matches");
    expect(plural(12000, "commit")).toBe("12,000 commits");
  });
});
