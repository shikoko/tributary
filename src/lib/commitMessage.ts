import type { CommitRow, Identity } from "../api";

export interface Person {
  name: string;
  email: string;
}

const isYou = (commit: CommitRow, you: Identity | null) => {
  const email = you?.email?.toLowerCase();
  return email ? commit.authorEmail.toLowerCase() === email : commit.authorName === you?.name;
};

/** Your most recent commits with different summaries, newest first. */
export function recentMessages(commits: CommitRow[], you: Identity | null, limit = 12): CommitRow[] {
  const seen = new Set<string>();
  const found: CommitRow[] = [];
  for (const commit of commits) {
    if (commit.kind !== "commit" || !isYou(commit, you) || seen.has(commit.summary)) continue;
    seen.add(commit.summary);
    found.push(commit);
    if (found.length === limit) break;
  }
  return found;
}

/** People who committed here, most commits first: not you, and not bots like Dependabot. */
export function coAuthorCandidates(commits: CommitRow[], you: Identity | null, limit = 12): Person[] {
  const yours = you?.email?.toLowerCase() ?? null;
  const counts = new Map<string, Person & { count: number }>();
  for (const commit of commits) {
    if (commit.kind !== "commit" || !commit.authorEmail) continue;
    const email = commit.authorEmail.toLowerCase();
    if (email === yours || email.includes("[bot]") || commit.authorName.endsWith("[bot]")) continue;
    const known = counts.get(email);
    if (known) known.count += 1;
    else counts.set(email, { name: commit.authorName, email: commit.authorEmail, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ name, email }) => ({ name, email }));
}

/** `description` with a "Co-authored-by:" line for `person`, with the other trailers at the end. */
export function withCoAuthor(description: string, person: Person): string {
  const trailer = `Co-authored-by: ${person.name} <${person.email}>`;
  if (description.includes(trailer)) return description;
  const text = description.trimEnd();
  if (!text) return trailer;
  const lines = text.split("\n");
  // Trailers go together at the end, after a blank line.
  const endsWithTrailer = /^[\w-]+: /.test(lines[lines.length - 1] ?? "");
  return `${text}${endsWithTrailer ? "\n" : "\n\n"}${trailer}`;
}
