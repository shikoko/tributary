// Moving Tributary's settings to another computer: everything kept in local storage,
// except what only makes sense here (open tabs, places in lists, folders, commit messages
// being written, notices dismissed). Repository settings (pins, protected and hidden branches, the issue tracker)
// go along, and land on the repository with the same folder name there.

const PREFIX = "tributary.";
/** Kept here only. */
const LOCAL_ONLY = [/^tabs\./, /^place\./, /^speed\.offered$/, /^clone\.parent$/, /^recentRepositories$/, /^commitDrafts$/, /Dismissed$/];

export interface SettingsFile {
  app: "Tributary";
  version: 1;
  /** When they were saved (ISO 8601). */
  exported: string;
  /** Each setting's key (without "tributary.") and its stored text (JSON). */
  settings: Record<string, string>;
}

/** The settings in `storage`, to save as a file. */
export function collectSettings(storage: Storage, now = new Date()): SettingsFile {
  const settings: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    if (LOCAL_ONLY.some((pattern) => pattern.test(name))) continue;
    const value = storage.getItem(key);
    if (value !== null) settings[name] = value;
  }
  return { app: "Tributary", version: 1, exported: now.toISOString(), settings };
}

/** A repository setting's key ("pins:/Users/maya/feast") as its name and folder. */
function repoKey(key: string): { name: string; path: string } | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const path = key.slice(at + 1);
  return /^([a-zA-Z]:)?[\\/]/.test(path) ? { name: key.slice(0, at), path } : null;
}

const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

/**
 * Put the settings of `file` in `storage`. Repository settings go to the repository with
 * the same folder name among `repositories` (the ones known here) when their folder isn't
 * there; those with no match are kept as they were saved.
 */
export function applySettings(file: unknown, storage: Storage, repositories: string[]): { settings: number; repositories: number } {
  const parsed = file as Partial<SettingsFile> | null;
  if (!parsed || parsed.app !== "Tributary" || parsed.version !== 1 || typeof parsed.settings !== "object" || !parsed.settings) {
    throw new Error("That isn't a file of Tributary's settings.");
  }
  const known = new Set(repositories);
  const byName = new Map(repositories.map((path) => [folderName(path), path]));
  let settings = 0;
  const moved = new Set<string>();
  for (const [key, value] of Object.entries(parsed.settings)) {
    if (typeof value !== "string" || LOCAL_ONLY.some((pattern) => pattern.test(key))) continue;
    try {
      JSON.parse(value);
    } catch {
      continue;
    }
    const repo = repoKey(key);
    let target = key;
    if (repo && !known.has(repo.path)) {
      const here = byName.get(folderName(repo.path));
      if (here) {
        target = `${repo.name}:${here}`;
        moved.add(here);
      }
    }
    storage.setItem(PREFIX + target, value);
    settings++;
  }
  return { settings, repositories: moved.size };
}
