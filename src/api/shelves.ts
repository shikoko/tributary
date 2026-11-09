import { invoke } from "@tauri-apps/api/core";

/** A shelf: unfinished work shared through the remote without a branch. */
export interface Shelf {
  /** Its ref, under refs/tributary/shelves/. */
  reference: string;
  id: string;
  description: string;
  author: string;
  email: string;
  /** When it was shelved, in seconds since the epoch. */
  time: number;
  /** The branch it was shelved on, and the commit its files were changed from. */
  branch: string | null;
  base: string | null;
  mine: boolean;
  files: ShelfFile[];
}

export interface ShelfFile {
  path: string;
  change: "added" | "modified" | "deleted";
}

/** The shelves there are, newest first; with `fetch`, the remote's are fetched first. */
export function shelves(path: string, fetch: boolean): Promise<Shelf[]> {
  return invoke<Shelf[]>("shelves", { path, fetch });
}
