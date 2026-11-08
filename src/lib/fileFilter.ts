import type { FileChange } from "../api";

/**
 * The files whose path (or old path, for a rename) has every word of `query` in it, like
 * "maps tavern" for Content/Maps/Tavern.umap. Case doesn't matter; an empty query keeps all.
 */
export function filterFiles<T extends Pick<FileChange, "path" | "oldPath">>(files: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return files;
  return files.filter((file) => {
    const path = `${file.path}\n${file.oldPath ?? ""}`.toLowerCase();
    return words.every((word) => path.includes(word));
  });
}

/** File lists longer than this get a filter. */
export const FILTER_FROM = 30;
