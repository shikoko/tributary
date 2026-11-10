import { describe, expect, it } from "vitest";
import { shownStops, tourById, tourToOffer, TOURS } from "./tours";

const facts = { simple: false, people: 1, usesLfs: false, actions: 0 };

describe("guided tours", () => {
  it("offers getting started first, then what fits the repository, once each", () => {
    expect(tourToOffer(facts, [])).toBe("start");
    expect(tourToOffer(facts, ["start"])).toBeNull();
    expect(tourToOffer({ ...facts, people: 3, usesLfs: true }, ["start"])).toBe("team");
    expect(tourToOffer({ ...facts, people: 3, usesLfs: true }, ["start", "team"])).toBe("lfs");
    expect(tourToOffer({ ...facts, actions: 2 }, ["start"])).toBe("safety");
    // Simple mode has its own, and only that.
    expect(tourToOffer({ ...facts, simple: true }, [])).toBe("simple");
    expect(tourToOffer({ ...facts, simple: true }, ["simple"])).toBeNull();
  });

  it("leaves out optional stops whose target isn't there", () => {
    const start = tourById("start");
    const all = shownStops(start, () => true);
    expect(all).toHaveLength(start.stops.length);
    const bare = shownStops(start, () => false);
    expect(bare.map((stop) => stop.title)).toEqual(["The graph", "Fetch, Pull and Push", "Everything, from the keyboard"]);
  });

  it("has a few stops in each", () => {
    for (const tour of TOURS) {
      expect(tour.stops.length).toBeGreaterThanOrEqual(3);
      expect(tour.stops.length).toBeLessThanOrEqual(6);
    }
  });
});
