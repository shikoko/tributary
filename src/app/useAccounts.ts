import { useCallback, useEffect, useState } from "react";
import { gitHubStatus, gitLabStatus, signOutOfGitHub, signOutOfGitLab, type GitHubStatus, type GitLabStatus } from "../api";
import { useStoredState } from "../lib/settings";
import type { ToastMessage } from "../components/Toast";

export type Forge = "github" | "gitlab";

/** The GitLab server people sign in to unless they choose another. */
export const GITLAB_COM = "gitlab.com";

export interface Accounts {
  github: { status: GitHubStatus | null; error: string | null };
  gitlab: { status: GitLabStatus | null; error: string | null; host: string; setHost: (host: string) => void };
  /** Ask again who's signed in (after signing in, say). */
  recheck: () => void;
  /** Sign out (git forgets the token too), and say so. */
  signOut: (forge: Forge) => void;
}

/**
 * Who's signed in to GitHub and to your GitLab server, going by the tokens git keeps. Asked
 * once `active` (the start screen, Settings or the clone dialog is showing), and again after
 * `recheck`. Null until known.
 */
export function useAccounts(active: boolean, notify: (toast: ToastMessage) => void): Accounts {
  const [host, setHost] = useStoredState<string>("accounts.gitlab.host", GITLAB_COM);
  const [github, setGitHub] = useState<Accounts["github"]>({ status: null, error: null });
  const [gitlab, setGitLab] = useState<{ status: GitLabStatus | null; error: string | null }>({ status: null, error: null });
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    gitHubStatus()
      .then((status) => live && setGitHub({ status, error: null }))
      .catch((e) => live && setGitHub({ status: null, error: String(e) }));
    gitLabStatus(host)
      .then((status) => live && setGitLab({ status, error: null }))
      .catch((e) => live && setGitLab({ status: null, error: String(e) }));
    return () => {
      live = false;
    };
  }, [active, checks, host]);
  const recheck = useCallback(() => setChecks((count) => count + 1), []);
  const signOut = useCallback(
    (forge: Forge) => {
      const name = forge === "github" ? "GitHub" : host === GITLAB_COM ? "GitLab" : host;
      (forge === "github" ? signOutOfGitHub() : signOutOfGitLab(host))
        .then(() => notify({ text: `Signed out of ${name}` }))
        .catch((e) => notify({ text: `Couldn't sign out: ${e}` }))
        .finally(recheck);
    },
    [host, notify, recheck],
  );
  return { github, gitlab: { ...gitlab, host, setHost }, recheck, signOut };
}
