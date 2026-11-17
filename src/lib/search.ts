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

/**
 * The next of the sorted row `indexes` after row `from` (or before it, for `step` -1),
 * wrapping around at the ends. `from` -1 means nothing is selected.
 */
export function stepThrough(indexes: number[], from: number, step: 1 | -1): number | undefined {
  if (indexes.length === 0) return undefined;
  return step > 0
    ? (indexes.find((index) => index > from) ?? indexes[0])
    : ([...indexes].reverse().find((index) => index < from) ?? indexes[indexes.length - 1]);
}

/** Indexes of the commits with a branch or tag whose name contains `query`, ignoring case. */
export function findRefMatches(commits: CommitRow[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return commits.flatMap((commit, index) => (commit.refs.some((ref) => ref.kind !== "stash" && ref.kind !== "head" && ref.name.toLowerCase().includes(needle)) ? [index] : []));
}

/** What a prefix typed in the search box (`author:`, `tag:`…) asks to search, and the rest. */
export function searchPrefix(text: string): { mode: "messages" | "authors" | "refs" | "hashes" | "files" | "code"; rest: string } | null {
  const match = /^\s*(message|msg|author|branch|tag|hash|sha|id|file|path|code):\s*(.*)$/i.exec(text);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const mode =
    kind === "message" || kind === "msg"
      ? "messages"
      : kind === "author"
        ? "authors"
        : kind === "branch" || kind === "tag"
          ? "refs"
          : kind === "hash" || kind === "sha" || kind === "id"
            ? "hashes"
            : kind === "file" || kind === "path"
              ? "files"
              : "code";
  return { mode, rest: match[2] };
}
