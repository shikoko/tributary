// A branch's earlier versions, for showing what changed when it was rewritten.
import type { BranchVersion, CommitPair } from "../api";

/** The version before the latest rewrite (the one to compare with by default), or null. */
export function beforeLatestRewrite(versions: BranchVersion[]): BranchVersion | null {
  const rewrite = versions.findIndex((version) => version.rewritten);
  return rewrite >= 0 ? (versions[rewrite + 1] ?? null) : null;
}

/** The earlier versions worth choosing from: each one a rewrite replaced, newest first. */
export function rewrittenVersions(versions: BranchVersion[]): BranchVersion[] {
  return versions.flatMap((version, index) => (version.rewritten && versions[index + 1] ? [versions[index + 1]] : []));
}

/** "Force-pushed", "Rebased", … for what replaced a version. */
export function describeRewrite(how: string): string {
  if (how.includes("forced-update")) return "Force-pushed";
  if (how.startsWith("rebase") || how.startsWith("pull --rebase")) return "Rebased";
  if (how.startsWith("reset")) return "Reset";
  if (how.startsWith("commit (amend)")) return "Amended";
  return "Rewritten";
}

/** "2 changed, 1 new, 1 dropped, 3 the same". */
export function summarizePairs(pairs: CommitPair[]): string {
  const count = (status: CommitPair["status"]) => pairs.filter((pair) => pair.status === status).length;
  const parts = [
    [count("changed"), "changed"],
    [count("added"), "new"],
    [count("removed"), "dropped"],
    [count("same"), "the same"],
  ] as const;
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
  return said.length > 0 ? said.join(", ") : "No commits";
}

/** How a line of git's diff of two diffs is shown: the outer sign says what the rewrite did. */
export function changeLineKind(line: string): "added" | "removed" | "header" | "context" {
  if (line.startsWith("@@") || line.startsWith("##")) return "header";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
