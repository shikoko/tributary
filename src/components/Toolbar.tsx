import { useRef, type RefObject } from "react";
import type { SearchMode } from "../app/useSearch";
import type { RepoSnapshot } from "../api";
import { plural, shortId } from "../lib/format";
import { isMac, modKey } from "../lib/platform";
import {
  BranchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CommitIcon,
  FetchIcon,
  ExternalLinkIcon,
  GearIcon,
  PullIcon,
  PushIcon,
  RefreshIcon,
  SearchIcon,
  SidebarIcon,
  TeamIcon,
  ViewIcon,
} from "./Icons";
import { relativeTime } from "../lib/format";

export type RemoteAction = "fetch" | "pull" | "push";

export interface SearchState {
  query: string;
  /** Messages (and authors, branches, SHAs), files' paths, or code added or removed. */
  mode: SearchMode;
  /** How many commits match. */
  total: number;
  /** 1-based position of the selected commit among the matches, or 0. */
  current: number;
  /** A file or code search git hasn't answered yet. */
  searching: boolean;
  /** Matching commits that aren't loaded. */
  notLoaded: number;
  truncated: boolean;
  error: string | null;
}

const MODES: { mode: SearchMode; label: string; placeholder: string; title: string }[] = [
  { mode: "message", label: "Messages", placeholder: "", title: "Message, author, branch, tag or SHA, among the loaded commits" },
  { mode: "files", label: "Files", placeholder: "Commits that changed a file, like store.ts or *.psd", title: "Commits in any branch that changed a file whose path contains this (or matches a pattern like *.psd)" },
  { mode: "code", label: "Code", placeholder: "Commits that added or removed some code", title: "Commits in any branch that added or removed this exact text" },
];

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
  onSearchMode: (mode: SearchMode) => void;
  onRemote: (action: RemoteAction) => void;
  /** Open the push menu (with force push) under the given element. */
  onPushMenu: (anchor: HTMLElement) => void;
  /** When the last successful fetch finished, in milliseconds since the epoch. */
  lastFetch: number | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onViewMenu: (anchor: HTMLElement) => void;
  onRefresh: () => void;
  /** Team activity: who's been working on what. */
  teamOpen: boolean;
  onToggleTeam: () => void;
  /** The Open menu: the repository on its website, in Finder or Explorer, in an editor or terminal. */
  onOpenMenu: (anchor: HTMLElement) => void;
  /** This repository's own settings. */
  onSettings: () => void;
  onClose: () => void;
}

export function Toolbar(props: Props) {
  const { snapshot, refreshing, running, ahead, behind, search, searchInput } = props;
  const pushMenuButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
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
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar-repo" data-tauri-drag-region>
        <button
          className={`icon-button${props.sidebarOpen ? " active" : ""}`}
          onClick={props.onToggleSidebar}
          title={`${props.sidebarOpen ? "Hide" : "Show"} branches (${modKey}B)`}
          aria-label="Toggle the branches sidebar"
          aria-pressed={props.sidebarOpen}
        >
          <SidebarIcon />
        </button>
        {snapshot.headBranch ? (
          <span className="head-chip" title="Checked out branch" data-tour="head">
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
        <select
          className="search-mode"
          value={search.mode}
          onChange={(event) => props.onSearchMode(event.target.value as SearchMode)}
          title={MODES.find((entry) => entry.mode === search.mode)?.title}
          aria-label="Search in"
        >
          {MODES.map((entry) => (
            <option key={entry.mode} value={entry.mode}>
              {entry.label}
            </option>
          ))}
        </select>
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
          placeholder={
            search.mode === "message"
              ? `Search ${plural(commitCount, "commit")}${snapshot.truncated ? "+" : ""}`
              : (MODES.find((entry) => entry.mode === search.mode)?.placeholder ?? "")
          }
          title={`${MODES.find((entry) => entry.mode === search.mode)?.title} (${modKey}F)`}
          spellCheck={false}
          aria-label="Search commits"
        />
        {search.query && (
          <>
            <span
              className="search-count"
              title={
                search.error ??
                (search.notLoaded > 0
                  ? `${plural(search.notLoaded, "more commit")} further back match${search.notLoaded === 1 ? "es" : ""}: scroll down to load ${search.notLoaded === 1 ? "it" : "them"}`
                  : search.mode === "message" && snapshot.truncated
                    ? "Only the loaded commits are searched"
                    : undefined)
              }
            >
              {search.searching
                ? "Searching…"
                : search.error
                  ? "Couldn't search"
                  : search.total === 0
                    ? search.notLoaded > 0
                      ? `${search.notLoaded}${search.truncated ? "+" : ""} further back`
                      : "No matches"
                    : search.current > 0
                      ? `${search.current} of ${search.total}${search.notLoaded > 0 ? "+" : ""}`
                      : plural(search.total, "match", "matches") + (search.notLoaded > 0 ? "+" : "")}
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
          data-tour="remote"
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
        <button className="tool-button" data-tour="remote" onClick={() => props.onRemote("pull")} disabled={pullDisabled} title={pullTitle}>
          <PullIcon className={running === "pull" ? "pulse" : undefined} />
          <span className="label">Pull</span>
          {behind > 0 && (
            <span className="count">
              <span>{behind}</span>
            </span>
          )}
        </button>
        <div className="split-button" data-tour="remote">
          <button className="tool-button" onClick={() => props.onRemote("push")} disabled={pushDisabled} title={pushTitle}>
            <PushIcon className={running === "push" ? "pulse" : undefined} />
            <span className="label">Push</span>
            {ahead > 0 && (
              <span className="count">
                <span>{ahead}</span>
              </span>
            )}
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
          className={`icon-button${props.teamOpen ? " active" : ""}`}
          onClick={props.onToggleTeam}
          title={`Team activity: who's been working on what (${isMac ? "⇧⌘T" : "Ctrl+Shift+T"})`}
          aria-label="Team activity"
          data-tour="team"
          aria-pressed={props.teamOpen}
        >
          <TeamIcon />
        </button>
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
          onClick={props.onSettings}
          title={`Settings for ${snapshot.name}: who you commit as, protected branches, Git LFS`}
          aria-label="Repository settings"
        >
          <GearIcon />
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
          ref={openButton}
          className="icon-button"
          onClick={() => openButton.current && props.onOpenMenu(openButton.current)}
          title={`Open ${snapshot.name}: on its website, in ${isMac ? "Finder" : "Explorer"}, in your editor or terminal`}
          aria-label="Open the repository elsewhere"
        >
          <ExternalLinkIcon />
        </button>
        <button className="icon-button" onClick={props.onClose} title="Close repository" aria-label="Close repository">
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
