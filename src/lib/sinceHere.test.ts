import { describe, expect, it } from "vitest";
import type { SincePerson, SinceThen } from "../api";
import { branchWords, countWords, peopleWords, sinceItems, sinceWhen, sortSince } from "./sinceHere";

const person = (name: string, commits = 1): SincePerson => ({ name, commits });

describe("sinceWhen", () => {
  const now = new Date(2026, 10, 15, 18, 0).getTime();
  it("says the day you were last here", () => {
    expect(sinceWhen(new Date(2026, 10, 15, 9, 0).getTime(), now)).toBe("earlier today");
    expect(sinceWhen(new Date(2026, 10, 14, 23, 50).getTime(), now)).toBe("yesterday");
    expect(sinceWhen(new Date(2026, 10, 10, 17, 40).getTime(), now)).toBe("Tuesday");
    expect(sinceWhen(new Date(2026, 10, 3, 12, 0).getTime(), now)).toBe("3 Nov");
    expect(sinceWhen(new Date(2025, 11, 24, 12, 0).getTime(), now)).toBe("24 Dec 2025");
  });
});

describe("peopleWords", () => {
  it("names up to three people by their first names", () => {
    expect(peopleWords([person("Rosa Bell")], 1)).toBe("Rosa");
    expect(peopleWords([person("Rosa Bell"), person("Theo Park")], 2)).toBe("Rosa and Theo");
    expect(peopleWords([person("Rosa Bell"), person("Theo Park"), person("Maya Chen")], 3)).toBe("Rosa, Theo and Maya");
  });
  it("counts the rest", () => {
    const people = [person("Rosa Bell"), person("Theo Park"), person("Maya Chen"), person("Lea Fischer")];
    expect(peopleWords(people, 23)).toBe("Rosa, Theo and 21 others");
    expect(peopleWords(people.slice(0, 3), 4)).toBe("Rosa, Theo and 2 others");
  });
  it("uses whole names when first names are shared", () => {
    expect(peopleWords([person("Rosa Bell"), person("Rosa Diaz")], 2)).toBe("Rosa Bell and Rosa Diaz");
  });
});

describe("branchWords", () => {
  it("leaves the remote out when it's origin or the only one", () => {
    expect(branchWords("origin/main", ["origin"])).toBe("main");
    expect(branchWords("origin/feature/door", ["origin", "upstream"])).toBe("feature/door");
    expect(branchWords("studio/main", ["studio"])).toBe("main");
    expect(branchWords("upstream/main", ["origin", "upstream"])).toBe("upstream/main");
  });
});

describe("countWords", () => {
  it("groups thousands", () => {
    expect(countWords(6)).toBe("6");
    expect(countWords(1240)).toBe("1,240");
  });
});

describe("sortSince", () => {
  const news = (branch: string, commits: number): SinceThen => ({ branch, was: "a", tip: "b", commits, people: [], peopleCount: 0, merged: [], changed: [] });
  it("puts your own branch's remote first, then the busiest", () => {
    const sorted = sortSince([news("origin/main", 40), news("origin/develop", 90), news("origin/door", 2)], "origin/door");
    expect(sorted.map((item) => item.branch)).toEqual(["origin/door", "origin/develop", "origin/main"]);
  });
});

describe("sinceItems", () => {
  const news = (branch: string, commits: number, extra: Partial<SinceThen> = {}): SinceThen => ({
    branch,
    was: `was-${branch}`,
    tip: `tip-${branch}`,
    commits,
    people: [person("Rosa Bell", 4), person("Theo Park", 2)],
    peopleCount: 2,
    merged: [],
    changed: [],
    ...extra,
  });
  const words = (items: ReturnType<typeof sinceItems>) => items.map((item) => `[${item.link}]${item.rest}`).join(" · ");

  it("says what arrived on main, what was merged and which locked file changed", () => {
    const items = sinceItems(
      [
        news("origin/main", 6, {
          merged: [{ sign: "#", number: 11, title: "A sturdier stool", commit: "m11" }],
          changed: [{ path: "Content/Barber.uasset", commit: "c1", author: "Theo Park" }],
        }),
      ],
      ["origin"],
    );
    expect(words(items)).toBe("[6 new commits] on main from Rosa and Theo · [#11] merged into main · [Barber.uasset], which you've locked, changed");
    expect(items.map((item) => item.to)).toEqual(["was-origin/main", "m11", "c1"]);
  });

  it("stays one line with thousands of commits and many branches", () => {
    const people = [person("Rosa Bell"), person("Theo Park"), person("Maya Chen")];
    const items = sinceItems(
      [news("origin/main", 1240, { people, peopleCount: 23 }), news("origin/door", 1), news("origin/stool", 3), news("origin/sign", 4)],
      ["origin"],
    );
    expect(words(items)).toBe("[1,240 new commits] on main from Rosa, Theo and 21 others · [1] on door from Rosa and Theo · [7] on 2 more branches");
  });

  it("counts several merged requests and locked files", () => {
    const items = sinceItems(
      [
        news("origin/main", 9, {
          merged: [
            { sign: "!", number: 7, title: "Make the door creak", commit: "m7" },
            { sign: "!", number: 5, title: "Paint the sign", commit: "m5" },
          ],
          changed: [
            { path: "Content/Barber.uasset", commit: "c1", author: "Theo Park" },
            { path: "Maps/Tavern.umap", commit: "c2", author: "Rosa Bell" },
          ],
        }),
      ],
      ["origin"],
    );
    expect(words(items)).toBe("[9 new commits] on main from Rosa and Theo · [2 merge requests] merged · [2 files you've locked] changed");
  });
});
