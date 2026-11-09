import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { describeMeta, stagedMetaWarnings } from "./unityMeta";

const change = (path: string, status: FileChange["status"]): FileChange => ({ path, oldPath: null, status });

describe("Unity .meta files", () => {
  it("finds what committing the staged files would get wrong", () => {
    const problems = [
      { path: "Assets/New", problem: "missing" as const },
      { path: "Assets/Old.mat.meta", problem: "orphan" as const },
    ];
    const staged = [change("Assets/New/Lamp.prefab", "added"), change("Assets/Hero.png", "added")];
    const unstaged = [change("Assets/Hero.png.meta", "untracked"), change("Assets/Old.mat.meta", "untracked")];
    expect(stagedMetaWarnings(problems, staged, unstaged)).toEqual([
      { path: "Assets/New", problem: "missing" },
      { path: "Assets/Hero.png", problem: "notStaged" },
    ]);
  });

  it("says what to do", () => {
    expect(describeMeta({ path: "Assets/Gone.png", problem: "leftBehind" })).toBe("is deleted, but its .meta isn't: delete that too");
  });
});
