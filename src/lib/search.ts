import type { CommitRow } from "../api";

/**
 * Indexes of the commits matching `query`: in the first line of the message, the
 * author's name or email, a branch or tag name, or (for hex queries) the start of the SHA.
 */
export function findMatches(commits: CommitRow[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const looksLikeSha = /^[0-9a-f]{4,64}$/.test(needle);
  const matches: number[] = [];
  commits.forEach((commit, index) => {
    if (commit.kind === "worktree") return;
    const hit =
      commit.summary.toLowerCase().includes(needle) ||
      commit.authorName.toLowerCase().includes(needle) ||
      commit.authorEmail.toLowerCase().includes(needle) ||
      commit.refs.some((ref) => ref.name.toLowerCase().includes(needle)) ||
      (looksLikeSha && commit.id.startsWith(needle));
    if (hit) matches.push(index);
  });
  return matches;
}
