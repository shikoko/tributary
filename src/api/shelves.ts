import { invoke } from "@tauri-apps/api/core";
import type { Shelf, ShelfFile } from "./generated";
export type { Shelf, ShelfFile };

/** The shelves there are, newest first; with `fetch`, the remote's are fetched first. */
export function shelves(path: string, fetch: boolean): Promise<Shelf[]> {
  return invoke<Shelf[]>("shelves", { path, fetch });
}
