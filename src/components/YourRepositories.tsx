import { useEffect, useMemo, useRef, useState } from "react";
import { gitHubRepositories, gitLabRepositories, type AccountRepo } from "../api";
import type { Accounts } from "../app/useAccounts";
import { relativeTime } from "../lib/format";
import { ChevronDownIcon, LockIcon, SearchIcon } from "./Icons";

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

/**
 * Your repositories to clone one from: a search field, with the matches in a list that opens
 * over the window (so the window keeps its size). ↑ ↓ move, Enter picks, Esc closes the list.
 */
export function YourRepositories({ accounts, picked, onPick }: { accounts: Accounts; picked: string; onPick: (repo: AccountRepo) => void }) {
  const { repos, errors } = useYourRepositories(accounts);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (repos ?? []).filter((repo) => !needle || `${repo.owner}/${repo.name} ${repo.description ?? ""}`.toLowerCase().includes(needle)),
    [repos, needle],
  );
  const chosen = (repos ?? []).find((repo) => repo.url === picked) ?? null;
  // Which site each is on, only when both are listed.
  const both = new Set((repos ?? []).map((repo) => repo.forge)).size > 1;
  const pick = (repo: AccountRepo) => {
    onPick(repo);
    setQuery("");
    setOpen(false);
  };
  // The highlighted one stays in view as ↑ ↓ move it.
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return (
    <div
      className="your-repos"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className={`your-repos-field${open ? " open" : ""}`}>
        <SearchIcon size={13} />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="your-repos-list"
          aria-activedescendant={open && shown[active] ? `your-repo-${active}` : undefined}
          aria-label="Find one of your repositories"
          value={open || !chosen ? query : `${chosen.owner}/${chosen.name}`}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) setOpen(true);
              else if (shown.length > 0) setActive((at) => (at + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
            } else if (event.key === "Enter" && open && shown[active]) {
              event.preventDefault();
              pick(shown[active]);
            } else if (event.key === "Escape" && open) {
              // Closes the list, not the window.
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder={repos === null ? "Getting your repositories…" : "Find one of your repositories"}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {chosen && !open && both && <span className="your-repo-forge">{chosen.forge}</span>}
        <button
          type="button"
          className="your-repos-toggle"
          tabIndex={-1}
          aria-label={open ? "Hide your repositories" : "Show your repositories"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>
      {open && (
        <ul ref={list} id="your-repos-list" className="your-repos-menu" role="listbox" aria-label="Your repositories">
          {repos === null && <li className="your-repos-note">Getting your repositories…</li>}
          {repos !== null && shown.length === 0 && (
            <li className="your-repos-note">{needle ? `None of your repositories matches “${query.trim()}”.` : "You don't have any repositories yet."}</li>
          )}
          {shown.map((repo, index) => (
            <li
              key={repo.url}
              id={`your-repo-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`your-repo${index === active ? " active" : ""}${picked === repo.url ? " picked" : ""}`}
              title={repo.url}
              // Keep the focus in the field.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(repo)}
            >
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
            </li>
          ))}
        </ul>
      )}
      {errors.map((error) => (
        <p key={error} className="hint warning">
          {error}
        </p>
      ))}
    </div>
  );
}
