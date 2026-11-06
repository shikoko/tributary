import type { RefLabel } from "../api";

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
