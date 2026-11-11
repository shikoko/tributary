import { useState } from "react";
import { signInToGitLab, signInToGitLabWithBrowser, type GitLabAccount, type GitLabStatus } from "../api";
import { openInBrowser } from "../lib/weblinks";
import { Dialog } from "./Dialog";

const CREDENTIAL_MANAGER_URL = "https://gh.io/gcm";

/** "https://GitLab.example.com/" → "gitlab.example.com" (the server checks it properly). */
const cleanHost = (text: string) =>
  text
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/** GitLab's page for making a token that can use the API and push. */
export const newGitLabTokenUrl = (host: string) => `https://${host}/-/user_settings/personal_access_tokens?name=Tributary&scopes=api,write_repository`;

interface Props {
  /** The server signed in to before (or gitlab.com). */
  host: string;
  status: GitLabStatus | null;
  onCancel: () => void;
  onDone: (account: GitLabAccount, host: string) => void;
}

/** Sign in to gitlab.com or your own GitLab: in the browser with Git Credential Manager, or with a token. */
export function GitLabSignInDialog({ host: startHost, status, onCancel, onDone }: Props) {
  const [host, setHost] = useState(startHost);
  const [token, setToken] = useState("");
  const [running, setRunning] = useState<"browser" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const server = cleanHost(host);

  const signIn = async (how: "browser" | "token") => {
    if (running || !server || (how === "token" && !token.trim())) return;
    setRunning(how);
    setError(null);
    try {
      const account = how === "browser" ? await signInToGitLabWithBrowser(server) : await signInToGitLab(server, token);
      onDone(account, server);
    } catch (e) {
      setError(String(e));
      setRunning(null);
    }
  };

  return (
    <Dialog
      title="Sign in to GitLab"
      error={error}
      busy={running !== null}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running !== null}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={() => signIn("token")} disabled={running !== null || !server || !token.trim()}>
            {running === "token" ? "Checking…" : "Sign in"}
          </button>
        </>
      }
    >
      <p>
        With your GitLab sign-in, Tributary lists your projects to clone, shows merge requests and their pipelines for private projects
        too, and git uses it to push. Git's credential helper keeps it, not Tributary.
      </p>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          signIn("token");
        }}
      >
        <label className="field">
          <span>Server</span>
          <input
            className="text-input"
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
              setError(null);
            }}
            placeholder="gitlab.com, or your company's, like gitlab.example.com"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={running !== null}
          />
        </label>
        {status?.browserSignIn && (
          <div className="sign-in-browser">
            <button type="button" className="outline-button" onClick={() => signIn("browser")} disabled={running !== null || !server}>
              <span className="button-label">{running === "browser" ? "Waiting for the browser…" : "Sign in with browser"}</span>
            </button>
            <span className="hint">With Git Credential Manager.</span>
          </div>
        )}
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
            placeholder="glpat-…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            autoFocus={!status?.browserSignIn}
            disabled={running !== null}
          />
        </label>
        <p className="hint">
          <button type="button" className="link-button" onClick={() => server && openInBrowser(newGitLabTokenUrl(server))} disabled={!server} data-url={server ? newGitLabTokenUrl(server) : undefined}>
            Make a token on {server || "GitLab"}
          </button>{" "}
          with the “api” and “write_repository” scopes.
        </p>
        {status && !status.canKeepToken && (
          <p className="hint warning">
            Git has no credential helper, so there's nowhere safe to keep a token.{" "}
            <button type="button" className="link-button" onClick={() => openInBrowser(CREDENTIAL_MANAGER_URL)} data-url={CREDENTIAL_MANAGER_URL}>
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
