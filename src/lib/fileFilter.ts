import type { ActorName, FileChange } from "../api";

/**
 * The files whose path (or old path, for a rename) has every word of `query` in it, like
 * "maps tavern" for Content/Maps/Tavern.umap. Case doesn't matter; an empty query keeps all.
 * Unreal actors saved in their own files match by their names and classes too (`actors`).
 */
export function filterFiles<T extends Pick<FileChange, "path" | "oldPath">>(files: T[], query: string, actors?: ReadonlyMap<string, ActorName>): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return files;
  return files.filter((file) => {
    const actor = actors?.get(file.path);
    const path = `${file.path}\n${file.oldPath ?? ""}\n${actor?.label ?? ""}\n${actor?.class ?? ""}`.toLowerCase();
    return words.every((word) => path.includes(word));
  });
}

/** File lists longer than this get a filter. */
export const FILTER_FROM = 30;
