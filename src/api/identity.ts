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

/** How commits in a repository are signed. */
export type SigningMode = "usual" | "off" | "gpg" | "ssh";

export interface SigningKey {
  /** What git's user.signingkey takes: a GPG key id, or an SSH public key's file. */
  id: string;
  label: string;
  format: SigningMode;
}

export interface SigningSettings {
  /** What's set for this repository ("usual" when nothing is). */
  mode: SigningMode;
  /** Whether commits here end up signed, from every level of git's settings. */
  signs: boolean;
  /** "openpgp", "ssh" or "x509". */
  format: string;
  key: string | null;
  /** GPG's secret keys, and SSH public keys in ~/.ssh. */
  keys: SigningKey[];
}

export function signingSettings(path: string): Promise<SigningSettings> {
  return invoke<SigningSettings>("signing_settings", { path });
}
