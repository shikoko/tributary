import { describe, expect, it } from "vitest";
import { busyTabs, type Run } from "./useActions";

describe("busyTabs", () => {
  it("rings each repository's tab whose progress shows, at how far it is", () => {
    const runs = new Map<string, Run>([
      ["/game", { kind: "pull", progress: { label: "Pulling", value: { phase: "Receiving objects", percent: 40 }, visible: true, cancellable: true } }],
      ["/tools", { kind: "fetch", progress: { label: "Fetching", value: null, visible: true, cancellable: true } }],
      // Just started: its progress doesn't show yet.
      ["/site", { kind: "push", progress: { label: "Pushing", value: null, visible: false, cancellable: true } }],
      ["/docs", { kind: "other", progress: null }],
    ]);
    expect(busyTabs(runs)).toEqual({
      "/game": { label: "Pulling", percent: 40 },
      "/tools": { label: "Fetching", percent: null },
    });
  });
});
