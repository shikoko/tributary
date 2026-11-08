import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { commitTargets, findTarget, highlightedFirst, isShown, worktreeTargets } from "./diffTargets";

const file = (path: string, status: FileChange["status"] = "modified"): FileChange => ({ path, status, oldPath: null }) as FileChange;

describe("worktreeTargets", () => {
  it("lists conflicts, then staged, then the other changes, without whole folders", () => {
    const targets = worktreeTargets({
      staged: [file("a.txt")],
      unstaged: [file("b.txt"), file("c.txt", "conflicted"), file("new/", "untracked"), file("d.png", "untracked")],
    } as never);
    expect(targets.map((target) => [target.file.path, target.source.kind, target.label])).toEqual([
      ["c.txt", "unstaged", "Conflicted"],
      ["a.txt", "staged", "Staged"],
      ["b.txt", "unstaged", "Not staged"],
      ["d.png", "unstaged", "New, not staged"],
    ]);
  });
});

describe("findTarget", () => {
  const targets = worktreeTargets({ staged: [file("a.txt")], unstaged: [file("b.txt")] } as never);

  it("finds the file shown from the same side", () => {
    expect(findTarget(targets, { kind: "unstaged" }, "b.txt")).toBe(1);
  });

  it("follows a file that was just staged or unstaged", () => {
    expect(findTarget(targets, { kind: "unstaged" }, "a.txt")).toBe(0);
  });

  it("gives -1 once the file isn't changed", () => {
    expect(findTarget(targets, { kind: "staged" }, "gone.txt")).toBe(-1);
  });
});

describe("commitTargets", () => {
  it("labels files by their commit", () => {
    const [target] = commitTargets("1a2b3c4d5e6f", [file("x.ts")]);
    expect(target.label).toBe("In 1a2b3c4");
    expect(isShown({ source: { kind: "commit", id: "1a2b3c4d5e6f" }, path: "x.ts" }, target.source, "x.ts")).toBe(true);
    expect(isShown({ source: { kind: "commit", id: "other" }, path: "x.ts" }, target.source, "x.ts")).toBe(false);
  });

  it("puts highlighted files first", () => {
    const files = [file("a"), file("b"), file("c")];
    expect(highlightedFirst(files, (path) => path === "c").map((f) => f.path)).toEqual(["c", "a", "b"]);
  });
});
