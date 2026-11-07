/** Recently opened repositories, remembered in the webview's local storage. */

export interface RecentRepo {
  path: string;
  name: string;
  /** When it was last opened, in milliseconds since the Unix epoch. */
  openedAt?: number;
  /** The branch that was checked out then. */
  branch?: string | null;
  /** Pinned repositories stay at the top and are never pushed off the list. */
  pinned?: boolean;
}

const KEY = "tributary.recentRepositories";
/** How many repositories that aren't pinned are remembered. */
const MAX = 20;

export function loadRecent(): RecentRepo[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((r): r is RecentRepo => typeof r?.path === "string" && typeof r?.name === "string")
      : [];
  } catch {
    return [];
  }
}

function save(list: RecentRepo[]): RecentRepo[] {
  const pinned = list.filter((repo) => repo.pinned);
  const others = list.filter((repo) => !repo.pinned).slice(0, MAX);
  const kept = [...pinned, ...others];
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage can be unavailable; the list just won't survive a restart.
  }
  return kept;
}

export function rememberRepo(path: string, name: string, branch?: string | null): RecentRepo[] {
  const list = loadRecent();
  const existing = list.find((r) => r.path === path);
  const entry: RecentRepo = { path, name, openedAt: Date.now(), branch: branch ?? null, pinned: existing?.pinned };
  return save([entry, ...list.filter((r) => r.path !== path)]);
}

/** Update the remembered branch without moving the repository up the list. */
export function noteBranch(path: string, branch: string | null): RecentRepo[] {
  const list = loadRecent();
  if (!list.some((r) => r.path === path && r.branch !== branch)) return list;
  return save(list.map((r) => (r.path === path ? { ...r, branch } : r)));
}

export function pinRepo(path: string, pinned: boolean): RecentRepo[] {
  return save(loadRecent().map((r) => (r.path === path ? { ...r, pinned } : r)));
}

export function forgetRepo(path: string): RecentRepo[] {
  return save(loadRecent().filter((r) => r.path !== path));
}
