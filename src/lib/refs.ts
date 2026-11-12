import type { CommitRow, RefLabel } from "../api";

/** A label shown next to a commit. A local branch and its remote counterparts share one pill. */
export interface RefPill {
  key: string;
  name: string;
  kind: "head" | "branch" | "tag" | "stash";
  /** True when a local branch with this name exists. */
  local: boolean;
  /** Remotes (like "origin") that have this branch at the same commit. */
  remotes: string[];
  current: boolean;
}

export function refPills(refs: RefLabel[]): RefPill[] {
  const heads: RefPill[] = [];
  const branches: RefPill[] = [];
  const tags: RefPill[] = [];
  const stashes: RefPill[] = [];
  const localByName = new Map<string, RefPill>();

  for (const ref of refs) {
    if (ref.kind === "head") {
      heads.push({ key: "HEAD", name: "HEAD", kind: "head", local: true, remotes: [], current: true });
    } else if (ref.kind === "branch") {
      const pill: RefPill = {
        key: `b:${ref.name}`,
        name: ref.name,
        kind: "branch",
        local: true,
        remotes: [],
        current: ref.current,
      };
      localByName.set(ref.name, pill);
      branches.push(pill);
    } else if (ref.kind === "tag") {
      tags.push({ key: `t:${ref.name}`, name: ref.name, kind: "tag", local: false, remotes: [], current: false });
    } else if (ref.kind === "stash") {
      stashes.push({ key: `s:${ref.name}`, name: ref.name, kind: "stash", local: true, remotes: [], current: false });
    }
  }

  for (const ref of refs) {
    if (ref.kind !== "remote") continue;
    const slash = ref.name.indexOf("/");
    const remote = slash > 0 ? ref.name.slice(0, slash) : ref.name;
    const branch = slash > 0 ? ref.name.slice(slash + 1) : ref.name;
    const local = localByName.get(branch);
    if (local) {
      local.remotes.push(remote);
    } else {
      branches.push({
        key: `r:${ref.name}`,
        name: ref.name,
        kind: "branch",
        local: false,
        remotes: [remote],
        current: false,
      });
    }
  }

  return [...heads, ...branches, ...tags, ...stashes];
}

export function describePill(pill: RefPill): string {
  if (pill.kind === "head") return "Detached HEAD";
  if (pill.kind === "tag") return `Tag ${pill.name}`;
  if (pill.kind === "stash") return `Stash ${pill.name}`;
  const where = [pill.local ? "local" : null, ...pill.remotes].filter(Boolean).join(", ");
  return `${pill.current ? "Checked out branch" : "Branch"} ${pill.name} (${where})`;
}

/** A branch, tag or stash, and the commit it points to. */
export interface RefEntry {
  kind: "branch" | "remote" | "tag" | "stash";
  name: string;
  commitId: string;
  /** The checked-out branch. */
  current: boolean;
  /** The first line of the commit's message. */
  summary: string;
  /** For a local branch: the remote branch it tracks. */
  upstream?: string;
  /** Left out of the graph (its commit may not be loaded). */
  hidden?: boolean;
  /** For a local branch: the remotes with a branch of the same name (its copies there). */
  remotes?: string[];
}

export interface RefLists {
  branches: RefEntry[];
  /** Remote branches, by remote name. */
  remotes: Map<string, RefEntry[]>;
  /** Newest first. */
  tags: RefEntry[];
  stashes: RefEntry[];
}

/** Every branch, remote branch, tag and stash among the loaded commits. */
export function collectRefs(commits: CommitRow[]): RefLists {
  const lists: RefLists = { branches: [], remotes: new Map(), tags: [], stashes: [] };
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const entry: RefEntry = {
        kind: ref.kind === "head" ? "branch" : ref.kind,
        name: ref.name,
        commitId: commit.id,
        current: ref.current,
        summary: commit.summary,
        upstream: ref.upstream,
      };
      if (ref.kind === "branch") lists.branches.push(entry);
      else if (ref.kind === "tag") lists.tags.push(entry);
      else if (ref.kind === "stash") lists.stashes.push(entry);
      else if (ref.kind === "remote") {
        const remote = ref.name.slice(0, Math.max(0, ref.name.indexOf("/"))) || ref.name;
        if (!lists.remotes.has(remote)) lists.remotes.set(remote, []);
        lists.remotes.get(remote)!.push(entry);
      }
    }
  }
  const byName = (a: RefEntry, b: RefEntry) => a.name.localeCompare(b.name, undefined, { numeric: true });
  lists.branches.sort((a, b) => Number(b.current) - Number(a.current) || byName(a, b));
  for (const entries of lists.remotes.values()) entries.sort(byName);
  lists.stashes.sort((a, b) => (stashNumber(a.name) ?? 0) - (stashNumber(b.name) ?? 0));
  return lists;
}

/** 3 for "stash@{3}". */
export function stashNumber(name: string): number | null {
  const match = /^stash@\{(\d+)\}$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** The stash number of a stash row, from its label. */
export function stashIndexOf(commit: CommitRow): number | null {
  const label = commit.refs.find((ref) => ref.kind === "stash");
  return label ? stashNumber(label.name) : null;
}
