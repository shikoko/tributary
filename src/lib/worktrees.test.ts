import { describe, expect, it } from "vitest";
import type { Worktree } from "../api";
import { folderSlug } from "./paths";
import { worktreeName, worktreeNote } from "./worktrees";

const worktree = (path: string, branch: string | null, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch,
  head: null,
  main: false,
  current: false,
  locked: false,
  prunable: false,
  ...extra,
});

describe("worktrees", () => {
  it("makes folder names from branch names", () => {
    expect(folderSlug("feature/tags")).toBe("feature-tags");
    expect(folderSlug(" fix: crash! ")).toBe("fix-crash");
    expect(folderSlug("///")).toBe("worktree");
  });

  it("names a working tree by its folder, and says what's checked out when the name doesn't", () => {
    expect(worktreeName(worktree("C:\\work\\notebook", "main"))).toBe("notebook");
    expect(worktreeNote(worktree("/work/notebook", "main"))).toBe("main");
    expect(worktreeNote(worktree("/work/notebook-feature-tags", "feature/tags"))).toBeNull();
    expect(worktreeNote(worktree("/work/review", null))).toBe("detached");
    expect(worktreeNote(worktree("/work/gone", "x", { prunable: true }))).toBe("gone");
  });
});
