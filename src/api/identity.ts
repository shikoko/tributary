// Who commits are made as in a repository.
import { invoke } from "./invoke";
import type { CommitTemplate, ProjectSetup, RemoteInfo, RepoIdentity, SetupCheck, SetupFix, SigningKey, SigningMode, SigningSettings } from "./generated";
export type { CommitTemplate, ProjectSetup, RemoteInfo, RepoIdentity, SetupCheck, SetupFix, SigningKey, SigningMode, SigningSettings };

export function repoIdentity(path: string): Promise<RepoIdentity> {
  return invoke("repo_identity", { path });
}

export function commitTemplate(path: string): Promise<CommitTemplate> {
  return invoke("commit_template", { path });
}

export function signingSettings(path: string): Promise<SigningSettings> {
  return invoke("signing_settings", { path });
}

export function remotes(path: string): Promise<RemoteInfo[]> {
  return invoke("remotes", { path });
}

export function projectSetup(path: string): Promise<ProjectSetup> {
  return invoke("project_setup", { path });
}
