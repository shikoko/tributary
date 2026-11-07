import type { CommitRow, RepoSnapshot } from "../api";
import { ancestors } from "./graph";

/** Commits that arrived on a remote branch with a fetch. */
export interface News {
  /** Like "origin/main". */
  branch: string;
  /** Where it points now. */
  tip: string;
  count: number;
  /** Who wrote them, most commits first. */
  authors: string[];
}

/** Branches people keep for a long time, whose new commits are worth hearing about. */
const LONG_LIVED = ["main", "master", "develop", "development", "dev", "trunk"];

/** Where each remote branch points, like "origin/main" → its commit. */
export function remoteTips(snapshot: RepoSnapshot): Map<string, string> {
  const tips = new Map<string, string>();
  for (const commit of snapshot.commits) {
    for (const ref of commit.refs) if (ref.kind === "remote") tips.set(ref.name, commit.id);
  }
  for (const ref of snapshot.hiddenRefs) if (ref.kind === "remote") tips.set(ref.name, ref.commit);
  return tips;
}

/** The remote branches to tell you about: the checked-out branch's upstream, and main (or the like) on each remote. */
export function watchedBranches(snapshot: RepoSnapshot): string[] {
  const watched = new Set<string>();
  if (snapshot.upstream) watched.add(snapshot.upstream.name);
  for (const remote of snapshot.remotes) {
    for (const name of LONG_LIVED) watched.add(`${remote}/${name}`);
  }
  return [...watched];
}

/**
 * New commits on the watched remote branches: those `next` has that weren't loaded
 * before (`known`), so your own pushes don't count.
 */
export function findNews(before: Map<string, string>, known: Set<string>, next: RepoSnapshot): News[] {
  const byId = new Map<string, CommitRow>(next.commits.map((commit) => [commit.id, commit]));
  const after = remoteTips(next);
  const news: News[] = [];
  for (const branch of watchedBranches(next)) {
    const tip = after.get(branch);
    const old = before.get(branch);
    if (!tip || tip === old) continue;
    const oldHistory = old ? ancestors(old, byId) : new Set<string>();
    const fresh = [...ancestors(tip, byId)].filter((id) => !oldHistory.has(id) && !known.has(id));
    if (fresh.length === 0) continue;
    const counts = new Map<string, number>();
    for (const id of fresh) {
      const author = byId.get(id)?.authorName || "someone";
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
    const authors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    news.push({ branch, tip, count: fresh.length, authors });
  }
  return news;
}

/** "3 new commits on origin/main from Rosa Bell and Theo Park". */
export function describeNews(news: News): string {
  const people =
    news.authors.length === 1
      ? news.authors[0]
      : news.authors.length === 2
        ? `${news.authors[0]} and ${news.authors[1]}`
        : `${news.authors[0]}, ${news.authors[1]} and ${news.authors.length - 2} more`;
  return `${news.count === 1 ? "A new commit" : `${news.count} new commits`} on ${news.branch} from ${people}`;
}
