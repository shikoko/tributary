import type { CommitRow, HiddenRef } from "../../api";
import { collectRefs, type RefEntry } from "../../lib/refs";

/** An entry, or a folder of entries that share a prefix like "feature/". */
export type Node =
  | { kind: "entry"; entry: RefEntry; label: string }
  | { kind: "folder"; path: string; name: string; children: Node[]; count: number };

/** Group names that share a prefix ("feature/a", "feature/b") into folders. Lone names stay as they are. */
export function group(entries: { entry: RefEntry; label: string }[], prefix = ""): Node[] {
  const folders = new Map<string, { entry: RefEntry; label: string }[]>();
  for (const item of entries) {
    const slash = item.label.indexOf("/");
    if (slash <= 0) continue;
    const name = item.label.slice(0, slash);
    folders.set(name, [...(folders.get(name) ?? []), item]);
  }
  const nodes: Node[] = [];
  const placed = new Set<string>();
  for (const item of entries) {
    const slash = item.label.indexOf("/");
    const name = slash > 0 ? item.label.slice(0, slash) : null;
    const members = name ? folders.get(name) : undefined;
    if (!name || !members || members.length < 2) {
      nodes.push({ kind: "entry", ...item });
    } else if (!placed.has(name)) {
      placed.add(name);
      const path = `${prefix}${name}/`;
      const children = group(
        members.map((member) => ({ entry: member.entry, label: member.label.slice(name.length + 1) })),
        path,
      );
      nodes.push({ kind: "folder", path, name, children, count: members.length });
    }
  }
  return nodes;
}

/**
 * The sidebar's lists: branches (the checked-out one first), remote branches by remote,
 * tags and stashes, sorted by name (numbers in order: v2 before v10). Hidden branches and
 * tags are listed too, so they can be shown again.
 */
export function sidebarLists(commits: CommitRow[], hiddenRefs: HiddenRef[]) {
  const lists = collectRefs(commits);
  const byName = (a: RefEntry, b: RefEntry) => a.name.localeCompare(b.name, undefined, { numeric: true });
  for (const ref of hiddenRefs) {
    const entry: RefEntry = {
      kind: ref.kind === "head" ? "branch" : ref.kind,
      name: ref.name,
      commitId: ref.commit,
      current: false,
      summary: "",
      upstream: ref.upstream,
      hidden: true,
    };
    if (ref.kind === "branch") lists.branches.push(entry);
    else if (ref.kind === "tag") lists.tags.push(entry);
    else if (ref.kind === "remote") {
      const remote = ref.name.slice(0, Math.max(0, ref.name.indexOf("/"))) || ref.name;
      if (!lists.remotes.has(remote)) lists.remotes.set(remote, []);
      lists.remotes.get(remote)!.push(entry);
    }
  }
  lists.branches.sort((a, b) => Number(b.current) - Number(a.current) || byName(a, b));
  lists.tags.sort(byName);
  for (const entries of lists.remotes.values()) entries.sort(byName);
  return lists;
}

/** "Try a collapsible sidebar" for a stash made with the message "On main: Try a collapsible sidebar". */
export function stashLabel(entry: RefEntry): string {
  return entry.summary.replace(/^(WIP )?on [^:]+: /i, "") || entry.name;
}

/** The branches as one list: a local branch and its copies on remotes are one entry. */
export interface BranchGroups {
  /** The checked-out branch, then the protected ones (like main): always at the top. */
  top: RefEntry[];
  /** The other local branches. */
  rest: RefEntry[];
  /** For each local branch, the remotes with a branch of the same name. */
  copies: Map<string, string[]>;
  /** Local branches that aren't on any remote (never pushed, or gone from it). */
  localOnly: Set<string>;
  /** Remote branches that no local branch tracks or shares a name with, by remote. */
  remoteOnly: [string, RefEntry[]][];
}

export function branchGroups(branches: RefEntry[], remotes: Map<string, RefEntry[]>, protectedNames: string[]): BranchGroups {
  const remoteNames = new Set([...remotes.values()].flat().map((entry) => entry.name));
  const covered = new Set<string>();
  const copies = new Map<string, string[]>();
  const localOnly = new Set<string>();
  for (const branch of branches) {
    const same = [...remotes.keys()].filter((remote) => remoteNames.has(`${remote}/${branch.name}`));
    same.forEach((remote) => covered.add(`${remote}/${branch.name}`));
    if (branch.upstream && remoteNames.has(branch.upstream)) covered.add(branch.upstream);
    copies.set(branch.name, same);
    if (same.length === 0 && !(branch.upstream && remoteNames.has(branch.upstream))) localOnly.add(branch.name);
  }
  const order = (entry: RefEntry) => protectedNames.indexOf(entry.name);
  const top = [
    ...branches.filter((entry) => entry.current),
    ...branches.filter((entry) => !entry.current && order(entry) >= 0).sort((a, b) => order(a) - order(b)),
  ];
  return {
    top,
    rest: branches.filter((entry) => !top.includes(entry)),
    copies,
    localOnly,
    remoteOnly: [...remotes.entries()]
      .map(([remote, entries]): [string, RefEntry[]] => [remote, entries.filter((entry) => !covered.has(entry.name) && entry.name !== `${remote}/HEAD`)])
      .filter(([, entries]) => entries.length > 0),
  };
}
