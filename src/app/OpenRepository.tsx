// The open repository, and what can be done to it, for what's shown over it: RepositoryView
// provides it, so the dialogs and banners over a repository take what they need from here
// instead of each having it passed down.
import { createContext, useContext } from "react";
import type { Action, CommitDetails, CommitRow, PullRequest, RepoSnapshot, Worktree } from "../api";
import type { OpenDialog } from "../menus";
import type { ActOptions } from "./useActions";

export interface OpenRepository {
  snapshot: RepoSnapshot;
  /** The loaded commits, by id. */
  byId: Map<string, CommitRow>;
  /** The checked-out branch, or "HEAD". */
  branchLabel: string;
  /** The checked-out branch, if it's protected. */
  protectedHead: string | null;
  protectedBranches: string[];
  /** The branches pinned in the sidebar. */
  pins: string[];
  /** Local branch names. */
  localBranches: string[];
  worktrees: Worktree[];
  loadDetails: (id: string) => Promise<CommitDetails>;
  /** Run an action, reload, and say how it went: resolves to whether it worked. */
  act: (action: Action, options?: ActOptions) => Promise<boolean>;
  /** Push the checked-out branch: resolves to whether it worked. */
  push: () => Promise<boolean>;
  select: (id: string) => void;
  /** Select a commit, loading older history first when it isn't loaded. */
  goTo: (id: string) => void;
  openDialog: (dialog: OpenDialog) => void;
  closeDialog: () => void;
  /** A dialog did its own action: close it, show its message (with an undo), and reload. */
  finished: (message: string, undo?: Action) => void;
  /** Say something briefly, like "Copied the release notes". */
  notify: (text: string) => void;
  /** Locks were changed outside the usual actions. */
  locksChanged: () => void;
  /** Open a working tree in a tab. */
  openTab: (path: string) => void;
  requestCreated: (pr: PullRequest) => void;
  /** Sign in to GitHub, in Settings. */
  signIn: () => void;
  /** Open Settings, at a section. */
  openSettings: (section: string) => void;
}

export const OpenRepositoryContext = createContext<OpenRepository | null>(null);

/** The open repository, from RepositoryView. */
export function useOpenRepository(): OpenRepository {
  const repository = useContext(OpenRepositoryContext);
  if (!repository) throw new Error("useOpenRepository is only for what's shown over a repository.");
  return repository;
}
