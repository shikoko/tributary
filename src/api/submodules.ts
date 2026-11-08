// Submodules: other repositories kept inside this one, each at a commit it records.
import { invoke } from "@tauri-apps/api/core";

/** Where a submodule is, compared with the commit the repository records for it. */
export type SubmoduleState =
  /** Not cloned and checked out yet. */
  | "notSetUp"
  | "upToDate"
  /** Behind the recorded commit: a pull or checkout moved it, and it wasn't updated. */
  | "behind"
  /** New commits in the submodule, to record with a commit here. */
  | "ahead"
  /** Somewhere else entirely. */
  | "different"
  /** A merge or rebase changed the recorded commit on both sides. */
  | "conflicted";

export interface Submodule {
  /** Its name in .gitmodules (usually its path). */
  name: string;
  /** Its folder, relative to the repository's. */
  path: string;
  url: string | null;
  state: SubmoduleState;
  /** The commit the repository records, and the one checked out in it. */
  recorded: string | null;
  current: string | null;
  behind: number;
  ahead: number;
  /** It has uncommitted changes of its own. */
  changed: boolean;
}

export function submodules(path: string): Promise<Submodule[]> {
  return invoke<Submodule[]>("submodules", { path });
}
