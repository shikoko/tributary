// Who commits are made as in a repository.
import { invoke } from "@tauri-apps/api/core";
import type { CommitTemplate, ProjectSetup, RemoteInfo, RepoIdentity, SetupCheck, SetupFix, SigningKey, SigningMode, SigningSettings } from "./generated";
export type { CommitTemplate, ProjectSetup, RemoteInfo, RepoIdentity, SetupCheck, SetupFix, SigningKey, SigningMode, SigningSettings };

export function repoIdentity(path: string): Promise<RepoIdentity> {
  return invoke<RepoIdentity>("repo_identity", { path });
}

export function commitTemplate(path: string): Promise<CommitTemplate> {
  return invoke<CommitTemplate>("commit_template", { path });
}

export function signingSettings(path: string): Promise<SigningSettings> {
  return invoke<SigningSettings>("signing_settings", { path });
}

export function remotes(path: string): Promise<RemoteInfo[]> {
  return invoke<RemoteInfo[]>("remotes", { path });
}

export function projectSetup(path: string): Promise<ProjectSetup> {
  return invoke<ProjectSetup>("project_setup", { path });
}
