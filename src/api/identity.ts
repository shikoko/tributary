// Who commits are made as in a repository.
import { invoke } from "@tauri-apps/api/core";

export interface RepoIdentity {
  /** Set for this repository only. */
  localName: string | null;
  localEmail: string | null;
  /** The usual one, for every repository. */
  globalName: string | null;
  globalEmail: string | null;
}

export function repoIdentity(path: string): Promise<RepoIdentity> {
  return invoke<RepoIdentity>("repo_identity", { path });
}
