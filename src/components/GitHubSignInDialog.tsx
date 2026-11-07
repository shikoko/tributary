import { useState } from "react";
import { signInToGitHub, signInToGitHubWithBrowser, type GitHubAccount, type GitHubStatus } from "../api";
import { openInBrowser } from "../lib/weblinks";
import { Dialog } from "./Dialog";

/** GitHub's page for making a classic token that can read and push private repositories. */
export const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?description=Tributary&scopes=repo";
const CREDENTIAL_MANAGER_URL = "https://gh.io/gcm";

interface Props {
  status: GitHubStatus | null;
  onCancel: () => void;
  onDone: (account: GitHubAccount) => void;
}

/** Sign in to GitHub: in the browser with Git Credential Manager, or with a token. */
export function GitHubSignInDialog({ status, onCancel, onDone }: Props) {
  const [token, setToken] = useState("");
  const [running, setRunning] = useState<"browser" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (how: "browser" | "token") => {
    if (running || (how === "token" && !token.trim())) return;
    setRunning(how);
    setError(null);
    try {
      onDone(how === "browser" ? await signInToGitHubWithBrowser() : await signInToGitHub(token));
    } catch (e) {
      setError(String(e));
      setRunning(null);
    }
  };

  return (
    <Dialog
      title="Sign in to GitHub"
      error={error}
      busy={running !== null}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running !== null}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={() => signIn("token")} disabled={running !== null || !token.trim()}>
            {running === "token" ? "Checking…" : "Sign in"}
          </button>
        </>
      }
    >
      <p>
        With your GitHub sign-in, Tributary shows pull requests and their checks for private repositories too, and git uses it to
        push. Git's credential helper keeps it, not Tributary.
      </p>
      {status?.browserSignIn && (
        <div className="sign-in-browser">
          <button className="outline-button" onClick={() => signIn("browser")} disabled={running !== null}>
            <span className="button-label">{running === "browser" ? "Waiting for the browser…" : "Sign in with browser"}</span>
          </button>
          <span className="hint">With Git Credential Manager.</span>
        </div>
      )}
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          signIn("token");
        }}
      >
        <label className="field">
          <span>{status?.browserSignIn ? "Or a personal access token" : "Personal access token"}</span>
          <input
            className="text-input"
            type="password"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setError(null);
            }}
            placeholder="ghp_… or github_pat_…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            autoFocus={!status?.browserSignIn}
            disabled={running !== null}
          />
        </label>
        <p className="hint">
          <button type="button" className="link-button" onClick={() => openInBrowser(NEW_TOKEN_URL)}>
            Make a token on GitHub
          </button>{" "}
          with the “repo” scope. A fine-grained token works too, with read and write access to contents and read access to pull
          requests and commit statuses.
        </p>
        {status && !status.canKeepToken && (
          <p className="hint warning">
            Git has no credential helper, so there's nowhere safe to keep a token.{" "}
            <button type="button" className="link-button" onClick={() => openInBrowser(CREDENTIAL_MANAGER_URL)}>
              Install Git Credential Manager
            </button>{" "}
            first.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
