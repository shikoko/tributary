import type { SincePerson, SinceThen } from "../api";

/** When you were last here, in words after "Since": "earlier today", "yesterday", "Tuesday", "12 Nov". */
export function sinceWhen(at: number, now: number = Date.now()): string {
  const day = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const date = new Date(at);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "long" });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** People's first names, unless two of them share one: then their whole names. */
function shortNames(people: SincePerson[]): string[] {
  const first = (name: string) => name.trim().split(/\s+/)[0] || name;
  const counts = new Map<string, number>();
  for (const person of people) counts.set(first(person.name), (counts.get(first(person.name)) ?? 0) + 1);
  return people.map((person) => (counts.get(first(person.name))! > 1 ? person.name : first(person.name)));
}

/** "Rosa", "Rosa and Theo", "Rosa, Theo and Maya", "Rosa, Theo and 21 others": at most three names. */
export function peopleWords(people: SincePerson[], count: number): string {
  const names = shortNames(people.slice(0, 3));
  const others = Math.max(count, people.length) - names.length;
  if (names.length === 0) return count === 1 ? "someone" : `${count} people`;
  if (others > 0) return `${names.slice(0, 2).join(", ")} and ${others + names.length - 2} ${others + names.length - 2 === 1 ? "other" : "others"}`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A remote branch's name without its remote when that's origin (or the only one): "main" for "origin/main". */
export function branchWords(branch: string, remotes: string[]): string {
  const [remote, ...rest] = branch.split("/");
  const usual = remote === "origin" || (remotes.length === 1 && remote === remotes[0]);
  return usual && rest.length > 0 ? rest.join("/") : branch;
}

/** 1240 as "1,240". */
export function countWords(count: number): string {
  return count.toLocaleString("en-GB");
}

/** The branches with news, the one you'd most want first: your own branch's remote, then main. */
export function sortSince(since: SinceThen[], upstream: string | null): SinceThen[] {
  const rank = (item: SinceThen) => (item.branch === upstream ? 0 : 1);
  return [...since].sort((a, b) => rank(a) - rank(b) || b.commits - a.commits);
}

/** Where the remote branches you follow pointed when you last had a repository open, and when. */
export interface Seen {
  at: number;
  tips: Record<string, string>;
}

const seenKey = (path: string) => `tributary.seen.${path}`;

export function loadSeen(path: string): Seen | null {
  try {
    const value = JSON.parse(localStorage.getItem(seenKey(path)) ?? "null");
    return value && typeof value.at === "number" && value.tips && typeof value.tips === "object" ? (value as Seen) : null;
  } catch {
    return null;
  }
}

export function saveSeen(path: string, seen: Seen) {
  try {
    localStorage.setItem(seenKey(path), JSON.stringify(seen));
  } catch {
    // Storage can be unavailable; the next visit just won't say what changed.
  }
}

/** A part of the "since you were last here" line: words that go somewhere, and the words after them. */
export interface SinceItem {
  link: string;
  /** The commit it goes to. */
  to: string;
  title: string;
  rest: string;
}

/** At most this many branches are named; the rest are counted. */
const MOST_BRANCHES = 2;

/**
 * What arrived since you were last here, as parts of one line: the new commits on each
 * branch (going to where you left off on it), the requests merged, and your locked files
 * someone else changed (each going to its commit).
 */
export function sinceItems(branches: SinceThen[], remotes: string[]): SinceItem[] {
  const items: SinceItem[] = [];
  const named = branches.slice(0, MOST_BRANCHES);
  named.forEach((item, index) => {
    const commits = `${countWords(item.commits)} new ${item.commits === 1 ? "commit" : "commits"}`;
    items.push({
      link: index === 0 ? commits : countWords(item.commits),
      to: item.was,
      title: `Go to where you left off on ${branchWords(item.branch, remotes)}`,
      rest: ` on ${branchWords(item.branch, remotes)} from ${peopleWords(item.people, item.peopleCount)}`,
    });
  });
  const others = branches.slice(MOST_BRANCHES);
  if (others.length > 0) {
    const count = others.reduce((sum, item) => sum + item.commits, 0);
    items.push({ link: countWords(count), to: others[0].was, title: `Go to where you left off on ${branchWords(others[0].branch, remotes)}`, rest: ` on ${others.length} more ${others.length === 1 ? "branch" : "branches"}` });
  }
  const merged = branches.flatMap((item) => item.merged.map((request) => ({ ...request, branch: item.branch })));
  const requests = merged.filter((request, index) => merged.findIndex((other) => other.sign === request.sign && other.number === request.number) === index);
  if (requests.length === 1) {
    const [request] = requests;
    items.push({ link: `${request.sign}${request.number}`, to: request.commit, title: request.title, rest: ` merged into ${branchWords(request.branch, remotes)}` });
  } else if (requests.length > 1) {
    const kind = requests.every((request) => request.sign === "!") ? "merge requests" : "pull requests";
    items.push({ link: `${requests.length} ${kind}`, to: requests[0].commit, title: requests.map((request) => `${request.sign}${request.number} ${request.title}`).join("\n"), rest: " merged" });
  }
  const changed = branches.flatMap((item) => item.changed);
  const files = changed.filter((file, index) => changed.findIndex((other) => other.path === file.path) === index);
  if (files.length === 1) {
    const [file] = files;
    items.push({ link: file.path.split("/").pop() || file.path, to: file.commit, title: `${file.path}, changed by ${file.author}`, rest: ", which you've locked, changed" });
  } else if (files.length > 1) {
    items.push({ link: `${files.length} files you've locked`, to: files[0].commit, title: files.map((file) => `${file.path}, changed by ${file.author}`).join("\n"), rest: " changed" });
  }
  return items;
}
