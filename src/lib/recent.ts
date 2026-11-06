/** Recently opened repositories, remembered in the webview's local storage. */

export interface RecentRepo {
  path: string;
  name: string;
}

const KEY = "tributary.recentRepositories";
const MAX = 8;

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
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable; the list just won't survive a restart.
  }
  return list;
}

export function rememberRepo(path: string, name: string): RecentRepo[] {
  const rest = loadRecent().filter((r) => r.path !== path);
  return save([{ path, name }, ...rest].slice(0, MAX));
}

export function forgetRepo(path: string): RecentRepo[] {
  return save(loadRecent().filter((r) => r.path !== path));
}
