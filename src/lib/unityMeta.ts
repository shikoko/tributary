// Unity's .meta files: saying what's wrong, and which of the staged files are being
// committed without their .meta.
import type { FileChange, MetaProblem } from "../api";

/** What's wrong, in a few words. */
export function describeMeta(problem: MetaWarning): string {
  switch (problem.problem) {
    case "missing":
      return "has no .meta yet: open the project in Unity so it makes one";
    case "orphan":
      return "is a .meta whose file is gone: delete it too";
    case "leftBehind":
      return "is deleted, but its .meta isn't: delete that too";
    case "notStaged":
      return "is staged without its .meta: stage that too";
  }
}

/** A problem, or a staged asset whose .meta is changed but not staged ("notStaged"). */
export type MetaWarning = MetaProblem | { path: string; problem: "notStaged" };

/**
 * What committing the staged files would get wrong: their own .meta problems (a file, or a
 * folder with staged files in it), and new assets staged while their new .meta isn't.
 */
export function stagedMetaWarnings(problems: MetaProblem[], staged: FileChange[], unstaged: FileChange[]): MetaWarning[] {
  const stagedPaths = new Set(staged.map((file) => file.path));
  const isStaged = (path: string) => stagedPaths.has(path) || staged.some((file) => file.path.startsWith(`${path}/`));
  const own = problems.filter((problem) => isStaged(problem.path));
  const waiting = new Set(unstaged.filter((file) => file.status === "added" || file.status === "untracked").map((file) => file.path));
  const notStaged: MetaWarning[] = staged
    .filter((file) => (file.status === "added" || file.status === "renamed") && !file.path.endsWith(".meta") && waiting.has(`${file.path}.meta`))
    .map((file) => ({ path: file.path, problem: "notStaged" }));
  return [...own, ...notStaged];
}
