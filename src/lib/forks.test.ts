import { describe, expect, it } from "vitest";
import type { Fork } from "../api";
import { barWidth, describeForkRun, forkKey, listNames, onForkSyncNews, outcomeText, parentKey, shortCount, syncDue, tellForkSyncNews, type ForkSyncNews } from "./forks";

const FORK: Fork = {
  owner: "rosa-bell",
  name: "notebook-sync",
  branch: "main",
  private: false,
  url: "https://github.com/rosa-bell/notebook-sync",
  pushed: null,
  parent: { owner: "mayachen", name: "notebook-sync", branch: "main", url: "https://github.com/mayachen/notebook-sync" },
};

describe("forks", () => {
  it("names a fork and its original as GitHub does", () => {
    expect(forkKey(FORK)).toBe("rosa-bell/notebook-sync");
    expect(parentKey(FORK)).toBe("mayachen/notebook-sync");
  });

  it("syncs by itself when it's been long enough, and never when it's off", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    const hour = 60 * 60_000;
    expect(syncDue("hour", null, now)).toBe(true);
    expect(syncDue("hour", now - hour + 1000, now)).toBe(false);
    expect(syncDue("hour", now - hour, now)).toBe(true);
    expect(syncDue("day", now - 5 * hour, now)).toBe(false);
    expect(syncDue("day", now - 25 * hour, now)).toBe(true);
    expect(syncDue("off", null, now)).toBe(false);
  });

  it("says what a sync did", () => {
    expect(outcomeText({ outcome: "fastForward", message: "" })).toBe("Synced: it moved straight on to the original's commits");
    expect(outcomeText({ outcome: "merged", message: "" })).toBe("Synced: the original's commits were merged into it, with a merge commit");
    expect(outcomeText({ outcome: "upToDate", message: "" })).toBe("It already had all of the original's commits");
    expect(outcomeText({ outcome: "conflict", message: "There are merge conflicts" })).toBe("Its own changes clash with the original's");
    expect(outcomeText({ outcome: "refused", message: "Branch not found" })).toBe("Branch not found");
  });

  it("sums up an automatic sync, or says nothing when nothing happened", () => {
    expect(listNames(["a"])).toBe("a");
    expect(listNames(["a", "b", "c"])).toBe("a, b and c");
    expect(
      describeForkRun({
        time: 0,
        results: [
          { name: "notebook-sync", outcome: "fastForward", message: "" },
          { name: "pixel-fonts", outcome: "merged", message: "" },
          { name: "hinge-physics", outcome: "upToDate", message: "" },
          { name: "lantern-ui", outcome: "conflict", message: "There are merge conflicts" },
          { name: "quill-docs", outcome: "failed", message: "Couldn't reach GitHub." },
        ],
      }),
    ).toBe(
      "Synced notebook-sync and pixel-fonts with their originals. lantern-ui couldn't sync by itself: its own changes clash with the original's. quill-docs couldn't sync: Couldn't reach GitHub.",
    );
    expect(describeForkRun({ time: 0, results: [{ name: "tavern-assets", outcome: "fastForward", message: "" }] })).toBe(
      "Synced tavern-assets with its original.",
    );
    expect(describeForkRun({ time: 0, results: [{ name: "hinge-physics", outcome: "upToDate", message: "" }] })).toBeNull();
    expect(describeForkRun({ time: 0, results: [] })).toBeNull();
  });

  it("draws bars in proportion, with a little one for a few", () => {
    expect(barWidth(41, 41, 70)).toBe(70);
    expect(barWidth(1, 41, 70)).toBe(6);
    expect(barWidth(0, 41, 70)).toBe(0);
    expect(barWidth(500, 41, 70)).toBe(70);
  });

  it("tells what the automatic sync does to whoever listens, until they stop", () => {
    const heard: ForkSyncNews[] = [];
    const stop = onForkSyncNews((news) => heard.push(news));
    tellForkSyncNews({ kind: "syncing", fork: FORK });
    tellForkSyncNews({ kind: "done", fork: FORK, sync: { outcome: "fastForward", message: "" }, error: null });
    stop();
    tellForkSyncNews({ kind: "syncing", fork: FORK });
    expect(heard.map((news) => news.kind)).toEqual(["syncing", "done"]);
  });

  it("shortens counts that wouldn't fit beside a bar", () => {
    expect(shortCount(0)).toBe("0");
    expect(shortCount(999)).toBe("999");
    expect(shortCount(1000)).toBe("1k");
    expect(shortCount(1691)).toBe("1.7k");
    expect(shortCount(2195)).toBe("2.2k");
    expect(shortCount(9960)).toBe("10k");
    expect(shortCount(17_400)).toBe("17k");
    expect(shortCount(999_499)).toBe("999k");
    expect(shortCount(999_500)).toBe("1M");
    expect(shortCount(1_740_000)).toBe("1.7M");
  });
});
