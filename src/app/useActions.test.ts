import { describe, expect, it } from "vitest";
import type { FileChange, WorktreeStatus } from "../api";
import { discardLabel } from "./constants";
import { busyTabs, type Run } from "./useActions";

describe("busyTabs", () => {
  it("rings each repository's tab whose progress shows, at how far it is", () => {
    const runs = new Map<string, Run>([
      ["/game", { kind: "pull", label: "Pulling", progress: { label: "Pulling", value: { phase: "Receiving objects", percent: 40 }, visible: true, cancellable: true } }],
      ["/tools", { kind: "fetch", label: "Fetching", progress: { label: "Fetching", value: null, visible: true, cancellable: true } }],
      // Just started: its progress doesn't show yet.
      ["/site", { kind: "push", label: "Pushing", progress: { label: "Pushing", value: null, visible: false, cancellable: true } }],
      ["/docs", { kind: "other", label: null, progress: null }],
    ]);
    expect(busyTabs(runs)).toEqual({
      "/game": { label: "Pulling", percent: 40 },
      "/tools": { label: "Fetching", percent: null },
    });
  });
});

describe("discardLabel", () => {
  const file = (path: string, oldPath: string | null = null) => ({ path, oldPath }) as FileChange;
  const worktree = {
    staged: [file("Content/Maps/Tavern.umap"), file("README.md", "README.txt")],
    unstaged: [file("Content/Maps/Tavern.umap"), file("Content/Maps/Cellar.umap"), file("Content/Mapsfolder.txt"), file("notes/idea.md")],
  } as WorktreeStatus;

  it("counts every uncommitted file once for Discard all", () => {
    expect(discardLabel({ kind: "discardAll" }, worktree)).toBe("Discarding 5 files");
  });

  it("counts the files in a chosen folder, not the folder itself", () => {
    expect(discardLabel({ kind: "discardFiles", paths: ["Content/Maps"] }, worktree)).toBe("Discarding 2 files");
    expect(discardLabel({ kind: "discardFiles", paths: ["Content/Maps/"] }, worktree)).toBe("Discarding 2 files");
  });

  it("counts a renamed file once, by either of its names", () => {
    expect(discardLabel({ kind: "discardFiles", paths: ["README.txt", "README.md"] }, worktree)).toBe("Discarding 1 file");
  });

  it("writes big counts with separators, and says something when it can't count", () => {
    const many = { staged: [], unstaged: Array.from({ length: 12345 }, (_, index) => file(`Saved/${index}.tmp`)) } as unknown as WorktreeStatus;
    expect(discardLabel({ kind: "discardAll" }, many)).toBe(`Discarding ${(12345).toLocaleString()} files`);
    expect(discardLabel({ kind: "discardAll" }, null)).toBeNull();
  });

  it("counts a new folder as a folder, not as one file", () => {
    const withFolder = { staged: [], unstaged: [file("notes/idea.md"), file("exports/")] } as unknown as WorktreeStatus;
    expect(discardLabel({ kind: "discardAll" }, withFolder)).toBe("Discarding 1 file and 1 new folder");
    expect(discardLabel({ kind: "discardFiles", paths: ["exports/"] }, withFolder)).toBe("Discarding 1 new folder");
  });

  it("is only for discarding", () => {
    expect(discardLabel({ kind: "stageAll" }, worktree)).toBeNull();
  });
});
