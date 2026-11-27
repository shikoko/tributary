import { describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../api";
import { DiffCache, weight } from "./diffCache";

const diff = (picture = "", lines: string[] = []): FileDiff => ({
  path: "Art/door.png",
  binary: picture !== "",
  lfs: false,
  tooLarge: false,
  additions: lines.length,
  deletions: 0,
  hunks: lines.length ? [{ section: "", lines: lines.map((text, i) => ({ kind: "added", old: null, new: i + 1, text })) }] : [],
  sizeBefore: null,
  sizeAfter: null,
  media: picture
    ? { kind: "image", format: "png", before: null, after: picture, beforeDimensions: null, afterDimensions: null, beforeNote: null, afterNote: null }
    : null,
  submodule: null,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("weight", () => {
  it("counts the pictures and the lines", () => {
    expect(weight(diff("x".repeat(1000)))).toBe(1000);
    expect(weight(diff("", ["abc", "de"]))).toBe(3 + 16 + 2 + 16);
  });
});

describe("DiffCache", () => {
  it("loads a file's changes once, and gives them again", async () => {
    const cache = new DiffCache();
    const load = vi.fn(() => Promise.resolve(diff("a")));
    const first = await cache.get("door", load);
    const again = await cache.get("door", load);
    expect(again).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares a load still under way", async () => {
    const cache = new DiffCache();
    const load = vi.fn(() => Promise.resolve(diff("a")));
    const [one, two] = await Promise.all([cache.get("door", load), cache.get("door", load)]);
    expect(one).toBe(two);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lets go of the oldest when there are too many", async () => {
    const cache = new DiffCache(2);
    for (const key of ["one", "two", "three"]) await cache.get(key, () => Promise.resolve(diff("a")));
    expect(cache.has("one")).toBe(false);
    expect(cache.has("two") && cache.has("three")).toBe(true);
  });

  it("keeps the one used last, going by when it was used, not loaded", async () => {
    const cache = new DiffCache(2);
    await cache.get("one", () => Promise.resolve(diff("a")));
    await cache.get("two", () => Promise.resolve(diff("a")));
    await cache.get("one", () => Promise.resolve(diff("a")));
    await cache.get("three", () => Promise.resolve(diff("a")));
    expect(cache.has("one")).toBe(true);
    expect(cache.has("two")).toBe(false);
  });

  it("lets go of the oldest when they weigh too much, but never the newest", async () => {
    const cache = new DiffCache(10, 1500);
    await cache.get("small", () => Promise.resolve(diff("x".repeat(600))));
    await cache.get("medium", () => Promise.resolve(diff("x".repeat(800))));
    await settle();
    expect(cache.size).toBe(2);
    await cache.get("big", () => Promise.resolve(diff("x".repeat(5000))));
    await settle();
    expect([...["small", "medium", "big"]].filter((key) => cache.has(key))).toEqual(["big"]);
  });

  it("doesn't keep changes that failed to load, or that it's told not to", async () => {
    const cache = new DiffCache();
    await expect(cache.get("door", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await settle();
    expect(cache.has("door")).toBe(false);
    await cache.get("sign", () => Promise.resolve(diff("a")), () => false);
    await settle();
    expect(cache.has("sign")).toBe(false);
  });
});
