import { useEffect, useState } from "react";
import type { RepoSnapshot } from "../api";
import { plural, relativeTime } from "../lib/format";
import { isMac } from "../lib/platform";
import { ActivityIcon, BranchIcon, BroomIcon, CloseIcon, CloudIcon, CommitIcon, EyeOffIcon, FolderIcon, TeamIcon } from "./Icons";

interface Props {
  snapshot: RepoSnapshot;
  ahead: number;
  behind: number;
  /** What's running, like "Fetching". */
  running: string | null;
  /** Hidden (or, while soloing, shown) branches. */
  hiddenCount: number;
  soloing: boolean;
  onShowAll: () => void;
  onFetch: (() => void) | null;
  activityOpen: boolean;
  /** The last git command failed. */
  activityFailed: boolean;
  onToggleActivity: () => void;
  /** Who committed this week, on any branch; opens team activity. */
  pulse: { people: number; commits: number } | null;
  teamOpen: boolean;
  onToggleTeam: () => void;
  onReveal: () => void;
  /** Local branches gone from the remote, to offer cleaning up. */
  pruneHint: { count: number; remote: string } | null;
  /** Files you're changing that other branches also changed (some can't be merged: `assets`). */
  elsewhere: { count: number; assets: boolean } | null;
  /** Show the branches and files, in a panel over `anchor`. */
  onElsewhere: (anchor: HTMLElement) => void;
  onPrune: (() => void) | null;
  onDismissPruneHint: () => void;
}

/** A thin bar at the bottom of the window: where the branch stands, and the repository's folder. */
export function StatusBar(props: Props) {
  const { snapshot, ahead, behind, running, hiddenCount, soloing, onFetch, activityOpen, activityFailed } = props;
  // Re-render every half minute so "Fetched 2 minutes ago" stays right.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const commits = snapshot.commits.filter((commit) => commit.kind === "commit").length;
  const fetched = snapshot.lastFetched ? `Fetched ${relativeTime(snapshot.lastFetched)}` : "Never fetched";
  return (
    <footer className="status-bar">
      <span className="status-item strong" title={snapshot.headBranch ? `On ${snapshot.headBranch}` : "Detached HEAD"}>
        {snapshot.headBranch ? <BranchIcon size={12} /> : <CommitIcon size={12} />}
        {snapshot.headBranch ?? `HEAD at ${snapshot.headCommit?.slice(0, 7) ?? "nothing"}`}
      </span>
      {snapshot.headBranch &&
        (snapshot.upstream ? (
          <span className="status-item" title={`${ahead} to push, ${behind} to pull`}>
            <CloudIcon size={12} />
            {snapshot.upstream.name}
            {ahead > 0 && <span className="status-count">↑{ahead}</span>}
            {behind > 0 && <span className="status-count">↓{behind}</span>}
            {ahead === 0 && behind === 0 && <span className="muted">up to date</span>}
          </span>
        ) : (
          snapshot.remotes.length > 0 && <span className="status-item muted">Not pushed yet</span>
        ))}
      {snapshot.remotes.length > 0 &&
        (onFetch ? (
          <button className="status-item status-button" onClick={onFetch} title="Fetch now">
            {fetched}
          </button>
        ) : (
          <span className="status-item muted">{fetched}</span>
        ))}
      {props.pruneHint && props.onPrune && (
        <span className="status-item status-hint">
          <button
            className="status-button"
            onClick={props.onPrune}
            title="Their remote branches were deleted, usually because their pull requests were merged"
          >
            <BroomIcon size={12} />
            {props.pruneHint.count} {props.pruneHint.count === 1 ? "branch" : "branches"} gone from {props.pruneHint.remote}
            <span className="status-hint-action">Clean up</span>
          </button>
          <button className="status-hint-close" onClick={props.onDismissPruneHint} aria-label="Hide this" title="Hide this until another branch goes">
            <CloseIcon size={10} />
          </button>
        </span>
      )}
      {props.elsewhere && (
        <button
          className={`status-item status-button elsewhere${props.elsewhere.assets ? " assets" : ""}`}
          onClick={(event) => props.onElsewhere(event.currentTarget)}
          title="Files you're changing that someone also changed recently on another branch: click to see the branches"
          aria-haspopup="dialog"
        >
          <BranchIcon size={12} />
          {props.elsewhere.count} {props.elsewhere.count === 1 ? "file" : "files"} also changed elsewhere
        </button>
      )}
      {running && <span className="status-item running">{running}…</span>}
      {snapshot.operation && (
        <span className="status-item warning">
          {{ merge: "Merge", rebase: "Rebase", cherryPick: "Cherry-pick", revert: "Revert", applyPatches: "Applying patches", other: "Git operation" }[snapshot.operation.kind]}
          {snapshot.operation.kind === "applyPatches" ? "" : " in progress"}
        </span>
      )}
      <span className="status-fill" />
      {hiddenCount > 0 && (
        <button className="status-item status-button" onClick={props.onShowAll} title="Show every branch">
          <EyeOffIcon size={12} />
          {soloing ? `Showing ${hiddenCount} soloed` : `${hiddenCount} hidden`}
        </button>
      )}
      {props.pulse && props.pulse.people > 0 && (
        <button
          className={`status-item status-button${props.teamOpen ? " active" : ""}`}
          onClick={props.onToggleTeam}
          title={`${plural(props.pulse.commits, "commit")} on any branch in the last 7 days: show team activity`}
        >
          <TeamIcon size={12} />
          {props.pulse.people === 1 ? "1 person" : `${props.pulse.people} people`} this week
        </button>
      )}
      <span className="status-item muted">
        {commits.toLocaleString()}
        {snapshot.truncated ? "+" : ""} {commits === 1 ? "commit" : "commits"}
      </span>
      <button
        className={`status-item status-button${activityOpen ? " active" : ""}`}
        onClick={props.onToggleActivity}
        title="Show the git commands Tributary ran"
      >
        <ActivityIcon size={12} />
        Activity
        {activityFailed && <span className="status-dot" aria-label="The last command failed" />}
      </button>
      <button className="status-item status-button path" onClick={props.onReveal} title={isMac ? "Show in Finder" : "Show in Explorer"}>
        <FolderIcon size={12} />
        <span className="status-path">{snapshot.path}</span>
      </button>
    </footer>
  );
}
