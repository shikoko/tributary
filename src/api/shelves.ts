import { invoke } from "./invoke";
import type { Shelf, ShelfFile } from "./generated";
export type { Shelf, ShelfFile };

/** The shelves there are, newest first; with `fetch`, the remote's are fetched first. */
export function shelves(path: string, fetch: boolean): Promise<Shelf[]> {
  return invoke("shelves", { path, fetch });
}
