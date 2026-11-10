import { useState } from "react";
import type { RepoSummary } from "../api";
import type { Accounts, Forge } from "../app/useAccounts";
import type { GitInstallState } from "../app/useGitInstall";
import type { RecentRepo } from "../lib/recent";
import { avatarColor } from "../lib/colors";
import { plural, relativeTime } from "../lib/format";
import { modKey } from "../lib/platform";
import { AccountChips } from "./AccountChips";
import { GitNeededCard, GitOldNote } from "./GitNeeded";
import { BranchIcon, CloneIcon, CloseIcon, FolderIcon, Logo, NewRepoIcon, PinIcon, SearchIcon } from "./Icons";

interface Props {
  recent: RecentRepo[];
  /** Where each one stands now, by path, as they come in. */
  summaries: Map<string, RepoSummary>;
  /** The path being opened, while it loads. */
  opening: string | null;
  error: string | null;
  onPick: () => void;
  onClone: () => void;
  onCreate: () => void;
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
  onPin: (path: string, pinned: boolean) => void;
  /** Who's signed in to GitHub and GitLab, for the chips under the buttons. */
  accounts: Accounts;
  onSignIn: (forge: Forge) => void;
  /** Where git is: when it isn't anywhere, that comes first. */
  git: GitInstallState;
}

/** Shown when no repository is open: open, clone or create one, or pick a recent one. */
export function Welcome({ recent, summaries, opening, error, onPick, onClone, onCreate, onOpen, onForget, onPin, accounts, onSignIn, git }: Props) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = recent.filter(
    (repo) => !needle || repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle),
  );
  const pinned = shown.filter((repo) => repo.pinned);
  const others = shown.filter((repo) => !repo.pinned);

  const row = (repo: RecentRepo) => {
    const summary = summaries.get(repo.path);
    const missing = summary !== undefined && !summary.found;
    // The branch checked out now, or (until that's known) when it was last opened.
    const branch = summary?.found ? summary.branch : missing ? null : repo.branch;
    return (
    <li key={repo.path} className={missing ? "missing" : undefined}>
      <button
        className="recent-item"
        onClick={() => onOpen(repo.path)}
        disabled={opening !== null}
        title={missing ? "The folder isn't there any more (or isn't a repository)" : repo.path}
      >
        <span className="recent-dot" style={{ background: avatarColor(repo.path) }} />
        <span className="recent-text">
          <span className="recent-name">
            {repo.name}
            {branch && (
              <span className="recent-branch">
                <BranchIcon size={11} />
                {branch}
              </span>
            )}
            {summary?.found && summary.branch === null && <span className="recent-branch">detached</span>}
          </span>
          <span className="recent-path">{repo.path}</span>
        </span>
        <span className="recent-state">
          {missing && <span className="recent-chip missing">Folder not found</span>}
          {summary?.found && summary.conflicts > 0 && <span className="recent-chip conflicts">{plural(summary.conflicts, "conflict")}</span>}
          {summary?.found && summary.changes > summary.conflicts && (
            <span className="recent-chip changes" title={`${plural(summary.changes, "file")} with uncommitted changes`}>
              {plural(summary.changes - summary.conflicts, "change")}
            </span>
          )}
          {summary?.found && (summary.ahead > 0 || summary.behind > 0) && (
            <span className="recent-chip sync" title={`${summary.ahead} to push, ${summary.behind} to pull (as of the last fetch) on ${summary.upstream}`}>
              {summary.ahead > 0 && <span>↑{summary.ahead}</span>}
              {summary.behind > 0 && <span>↓{summary.behind}</span>}
            </span>
          )}
          {repo.openedAt && <span className="recent-when">{relativeTime(repo.openedAt / 1000)}</span>}
        </span>
      </button>
      <button
        className={`icon-button recent-pin${repo.pinned ? " pinned" : ""}`}
        onClick={() => onPin(repo.path, !repo.pinned)}
        title={repo.pinned ? "Unpin" : "Pin to the top"}
        aria-label={repo.pinned ? `Unpin ${repo.name}` : `Pin ${repo.name}`}
      >
        <PinIcon size={14} />
      </button>
      <button
        className="icon-button"
        onClick={() => onForget(repo.path)}
        title="Remove from recent"
        aria-label={`Remove ${repo.name} from recent`}
      >
        <CloseIcon size={14} />
      </button>
    </li>
    );
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo size={92} tile />
        <h1>Tributary</h1>
        <p className="tagline">See the history of a git repository as a graph.</p>

        {git.missing && <GitNeededCard install={git} />}
        <div className="welcome-actions">
          <button className="primary-button" onClick={onPick} disabled={opening !== null}>
            <FolderIcon />
            Open repository…
            <kbd>{modKey}O</kbd>
          </button>
          <button className="secondary-button large" onClick={onClone} disabled={opening !== null}>
            <CloneIcon />
            Clone…
          </button>
          <button className="secondary-button large" onClick={onCreate} disabled={opening !== null}>
            <NewRepoIcon />
            New…
          </button>
        </div>
        <AccountChips accounts={accounts} onSignIn={onSignIn} />
        {git.install?.old && <GitOldNote install={git} />}
        <p className="welcome-hint">You can also drop a folder onto this window.</p>

        {opening && <div className="welcome-status">Opening {opening}…</div>}
        {error && <div className="error-banner">{error}</div>}

        {recent.length > 0 && (
          <section className="recent">
            <div className="recent-heading">
              <h2>Recent</h2>
              {recent.length > 5 && (
                <label className="recent-filter">
                  <SearchIcon size={12} />
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Find a repository"
                    spellCheck={false}
                    aria-label="Find a recent repository"
                  />
                </label>
              )}
            </div>
            {shown.length === 0 && <div className="muted recent-none">No recent repository matches “{filter}”.</div>}
            <ul>
              {pinned.map(row)}
              {pinned.length > 0 && others.length > 0 && <li className="recent-divider" role="separator" />}
              {others.map(row)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
