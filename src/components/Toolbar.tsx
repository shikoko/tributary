import { useRef, type RefObject } from "react";
import type { RepoSnapshot } from "../api";
import { plural, shortId } from "../lib/format";
import { modKey } from "../lib/platform";
import {
  BranchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CommitIcon,
  FetchIcon,
  FolderIcon,
  Logo,
  PullIcon,
  PushIcon,
  RefreshIcon,
  SearchIcon,
  SidebarIcon,
  ViewIcon,
} from "./Icons";
import { relativeTime } from "../lib/format";

export type RemoteAction = "fetch" | "pull" | "push";

export interface SearchState {
  query: string;
  /** How many commits match. */
  total: number;
  /** 1-based position of the selected commit among the matches, or 0. */
  current: number;
}

interface Props {
  snapshot: RepoSnapshot;
  refreshing: boolean;
  /** The remote action that is running, if any. */
  running: RemoteAction | null;
  /** Commits the checked-out branch has that its upstream doesn't, and the other way round. */
  ahead: number;
  behind: number;
  search: SearchState;
  searchInput: RefObject<HTMLInputElement | null>;
  onSearch: (query: string) => void;
  onSearchStep: (step: 1 | -1) => void;
  onRemote: (action: RemoteAction) => void;
  /** Open the push menu (with force push) under the given element. */
  onPushMenu: (anchor: HTMLElement) => void;
  /** When the last successful fetch finished, in milliseconds since the epoch. */
  lastFetch: number | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Open the recent repositories menu under the given element. */
  onRepoMenu: (anchor: HTMLElement) => void;
  onViewMenu: (anchor: HTMLElement) => void;
  onRefresh: () => void;
  onPick: () => void;
  onClose: () => void;
}

export function Toolbar(props: Props) {
  const { snapshot, refreshing, running, ahead, behind, search, searchInput } = props;
  const pushMenuButton = useRef<HTMLButtonElement>(null);
  const repoButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const commitCount = snapshot.commits.filter((c) => c.kind === "commit").length;

  const hasRemotes = snapshot.remotes.length > 0 && !snapshot.bare;
  const onBranch = snapshot.headBranch !== null && !snapshot.bare;
  const fetchDisabled = running !== null || !hasRemotes;
  const pullDisabled = running !== null || !onBranch || !snapshot.upstream;
  const pushDisabled = running !== null || !onBranch || !hasRemotes;
  const pullTitle = !onBranch
    ? "Check out a branch to pull"
    : !snapshot.upstream
      ? `${snapshot.headBranch} has no upstream branch yet. Push it first.`
      : `Pull ${snapshot.upstream.name} into ${snapshot.headBranch}`;
  const pushTitle = !onBranch
    ? "Check out a branch to push"
    : !hasRemotes
      ? "This repository has no remotes"
      : snapshot.upstream
        ? `Push ${snapshot.headBranch} to ${snapshot.upstream.name}`
        : `Push ${snapshot.headBranch} and set its upstream`;

  return (
    <header className="toolbar">
      <div className="toolbar-repo">
        <button
          className={`icon-button${props.sidebarOpen ? " active" : ""}`}
          onClick={props.onToggleSidebar}
          title={`${props.sidebarOpen ? "Hide" : "Show"} branches (${modKey}B)`}
          aria-label="Toggle the branches sidebar"
          aria-pressed={props.sidebarOpen}
        >
          <SidebarIcon />
        </button>
        <Logo size={22} outline="#1a1d24" />
        <button
          ref={repoButton}
          className="repo-name"
          onClick={() => repoButton.current && props.onRepoMenu(repoButton.current)}
          title={`${snapshot.path}\nClick to switch repository`}
        >
          <span>{snapshot.name}</span>
          <ChevronDownIcon size={12} />
        </button>
        {snapshot.headBranch ? (
          <span className="head-chip" title="Checked out branch">
            <BranchIcon size={14} />
            <span className="head-chip-name">{snapshot.headBranch}</span>
          </span>
        ) : snapshot.headCommit ? (
          <span className="head-chip detached" title="HEAD is detached">
            <CommitIcon size={14} />
            <span className="head-chip-name">detached at {shortId(snapshot.headCommit)}</span>
          </span>
        ) : null}
      </div>

      <div className="search" role="search">
        <SearchIcon size={14} />
        <input
          ref={searchInput}
          value={search.query}
          onChange={(event) => props.onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              props.onSearchStep(event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1);
            } else if (event.key === "Escape") {
              event.stopPropagation();
              if (search.query) props.onSearch("");
              else event.currentTarget.blur();
            }
          }}
          placeholder={`Search ${plural(commitCount, "commit")}${snapshot.truncated ? "+" : ""}`}
          title={`Message, author, branch, tag or SHA (${modKey}F)`}
          spellCheck={false}
          aria-label="Search commits"
        />
        {search.query && (
          <>
            <span className="search-count" title={snapshot.truncated ? "Only the loaded commits are searched" : undefined}>
              {search.total === 0
                ? "No matches"
                : search.current > 0
                  ? `${search.current} of ${search.total}`
                  : plural(search.total, "match", "matches")}
            </span>
            <button
              className="icon-button small"
              onClick={() => props.onSearchStep(-1)}
              disabled={search.total === 0}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              <ChevronUpIcon size={14} />
            </button>
            <button
              className="icon-button small"
              onClick={() => props.onSearchStep(1)}
              disabled={search.total === 0}
              title="Next match (Enter)"
              aria-label="Next match"
            >
              <ChevronDownIcon size={14} />
            </button>
            <button
              className="icon-button small"
              onClick={() => props.onSearch("")}
              title="Clear search (Esc)"
              aria-label="Clear search"
            >
              <CloseIcon size={13} />
            </button>
          </>
        )}
      </div>

      <div className="toolbar-actions">
        <button
          className="tool-button"
          onClick={() => props.onRemote("fetch")}
          disabled={fetchDisabled}
          title={
            !hasRemotes
              ? "This repository has no remotes"
              : `Fetch from all remotes${props.lastFetch ? ` (last fetched ${relativeTime(props.lastFetch / 1000)})` : ""}`
          }
        >
          <FetchIcon className={running === "fetch" ? "pulse" : undefined} />
          <span className="label">Fetch</span>
        </button>
        <button className="tool-button" onClick={() => props.onRemote("pull")} disabled={pullDisabled} title={pullTitle}>
          <PullIcon className={running === "pull" ? "pulse" : undefined} />
          <span className="label">Pull</span>
          {behind > 0 && <span className="count">{behind}</span>}
        </button>
        <div className="split-button">
          <button className="tool-button" onClick={() => props.onRemote("push")} disabled={pushDisabled} title={pushTitle}>
            <PushIcon className={running === "push" ? "pulse" : undefined} />
            <span className="label">Push</span>
            {ahead > 0 && <span className="count">{ahead}</span>}
          </button>
          <button
            ref={pushMenuButton}
            className="tool-button menu-toggle"
            onClick={() => pushMenuButton.current && props.onPushMenu(pushMenuButton.current)}
            disabled={pushDisabled}
            title="More push options"
            aria-label="More push options"
          >
            <ChevronDownIcon size={14} />
          </button>
        </div>

        <span className="toolbar-divider" />

        <button
          ref={viewButton}
          className="icon-button"
          onClick={() => viewButton.current && props.onViewMenu(viewButton.current)}
          title="View options"
          aria-label="View options"
        >
          <ViewIcon />
        </button>
        <button
          className="icon-button"
          onClick={props.onRefresh}
          disabled={refreshing}
          title={`Refresh (${modKey}R)`}
          aria-label="Refresh"
        >
          <RefreshIcon className={refreshing ? "spin" : undefined} />
        </button>
        <button
          className="icon-button"
          onClick={props.onPick}
          title={`Open another repository (${modKey}O)`}
          aria-label="Open another repository"
        >
          <FolderIcon />
        </button>
        <button className="icon-button" onClick={props.onClose} title="Close repository" aria-label="Close repository">
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
