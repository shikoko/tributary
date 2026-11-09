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

/** The message new commits start from: git's commit.template (shared by a team, or this repository's own). */
export interface CommitTemplate {
  text: string | null;
  /** The file, as configured. */
  file: string | null;
  /** It's this repository's own, kept by Tributary (so it can be edited here). */
  ours: boolean;
}

export function commitTemplate(path: string): Promise<CommitTemplate> {
  return invoke<CommitTemplate>("commit_template", { path });
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

/** A remote and where it is. */
export interface RemoteInfo {
  name: string;
  /** Its address, without a password or token in it. */
  url: string;
  /** Where pushes go, when it's another address. */
  pushUrl: string | null;
  /** Its address has a password or token in it (left out of `url`). */
  hasCredentials: boolean;
}

export function remotes(path: string): Promise<RemoteInfo[]> {
  return invoke<RemoteInfo[]>("remotes", { path });
}

/** A change that puts a project setup check right. */
export type SetupFix =
  | { kind: "ignore"; patterns: string[] }
  | { kind: "untrack"; folders: string[] }
  | { kind: "track"; patterns: string[] }
  | { kind: "lockable"; patterns: string[] }
  | { kind: "textAuto" }
  | { kind: "longPaths" }
  | { kind: "installLfs" };

export interface SetupCheck {
  id: string;
  status: "good" | "warning" | "problem";
  title: string;
  detail: string;
  examples: string[];
  fix: SetupFix | null;
  fixLabel: string | null;
}

/** How a repository is set up for a game project, check by check. */
export interface ProjectSetup {
  engine: "unreal" | "unity" | null;
  /** The project's folder in the repository ("" for the top). */
  project: string | null;
  checks: SetupCheck[];
}

export function projectSetup(path: string): Promise<ProjectSetup> {
  return invoke<ProjectSetup>("project_setup", { path });
}
