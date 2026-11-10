import { useEffect, useMemo, useState } from "react";
import { gitHubRepositories, gitLabRepositories, type AccountRepo } from "../api";
import type { Accounts } from "../app/useAccounts";
import { relativeTime } from "../lib/format";
import { LockIcon, SearchIcon } from "./Icons";

/** The repositories of the accounts you're signed in to, newest first, and what went wrong asking. */
function useYourRepositories(accounts: Accounts) {
  const github = accounts.github.status?.account?.login ?? null;
  const gitlab = accounts.gitlab.status?.account?.username ?? null;
  const host = accounts.gitlab.host;
  const [repos, setRepos] = useState<AccountRepo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!github && !gitlab) {
      setRepos([]);
      return;
    }
    let live = true;
    setRepos(null);
    const asks = [github ? gitHubRepositories() : Promise.resolve([]), gitlab ? gitLabRepositories(host) : Promise.resolve([])];
    Promise.allSettled(asks).then((answers) => {
      if (!live) return;
      const found = answers.flatMap((answer) => (answer.status === "fulfilled" ? answer.value : []));
      setRepos(found.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)));
      setErrors(answers.flatMap((answer) => (answer.status === "rejected" ? [String(answer.reason)] : [])));
    });
    return () => {
      live = false;
    };
  }, [github, gitlab, host]);
  return { repos, errors };
}

/** Your repositories to clone one from, with a search; a click picks one. */
export function YourRepositories({ accounts, picked, onPick }: { accounts: Accounts; picked: string; onPick: (repo: AccountRepo) => void }) {
  const { repos, errors } = useYourRepositories(accounts);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (repos ?? []).filter((repo) => !needle || `${repo.owner}/${repo.name} ${repo.description ?? ""}`.toLowerCase().includes(needle)),
    [repos, needle],
  );
  // Which site each is on, only when both are listed.
  const both = new Set((repos ?? []).map((repo) => repo.forge)).size > 1;
  return (
    <div className="your-repos">
      <label className="your-repos-search">
        <SearchIcon size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find one of your repositories"
          aria-label="Find one of your repositories"
          spellCheck={false}
          autoFocus
        />
      </label>
      <ul aria-label="Your repositories">
        {repos === null && <li className="your-repos-note">Getting your repositories…</li>}
        {repos !== null && shown.length === 0 && errors.length === 0 && (
          <li className="your-repos-note">{needle ? `None of your repositories matches “${query.trim()}”.` : "You don't have any repositories yet."}</li>
        )}
        {shown.map((repo) => (
          <li key={repo.url}>
            <button type="button" className={`your-repo${picked === repo.url ? " picked" : ""}`} onClick={() => onPick(repo)} title={repo.url}>
              <span className="your-repo-text">
                <span className="your-repo-name">
                  <span className="your-repo-owner">{repo.owner}/</span>
                  {repo.name}
                  {repo.private && <LockIcon size={11} />}
                  {both && <span className="your-repo-forge">{repo.forge}</span>}
                </span>
                {repo.description && <span className="your-repo-desc">{repo.description}</span>}
              </span>
              <span className="your-repo-when">{relativeTime(Date.parse(repo.updated) / 1000)}</span>
            </button>
          </li>
        ))}
      </ul>
      {errors.map((error) => (
        <p key={error} className="hint warning">
          {error}
        </p>
      ))}
    </div>
  );
}
