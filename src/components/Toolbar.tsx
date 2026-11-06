import type { RepoSnapshot } from "../api";
import { plural, shortId } from "../lib/format";
import { modKey } from "../lib/platform";
import { BranchIcon, CloseIcon, CommitIcon, FolderIcon, Logo, RefreshIcon } from "./Icons";

interface Props {
  snapshot: RepoSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
  onPick: () => void;
  onClose: () => void;
}

export function Toolbar({ snapshot, refreshing, onRefresh, onPick, onClose }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-repo">
        <Logo size={22} outline="#1a1d24" />
        <span className="repo-name">{snapshot.name}</span>
        <span className="repo-path" title={snapshot.path}>
          {snapshot.path}
        </span>
      </div>

      <div className="toolbar-info">
        {snapshot.headBranch ? (
          <span className="head-chip" title="Checked out branch">
            <BranchIcon size={14} />
            {snapshot.headBranch}
          </span>
        ) : snapshot.headCommit ? (
          <span className="head-chip detached" title="HEAD is detached">
            <CommitIcon size={14} />
            detached at {shortId(snapshot.headCommit)}
          </span>
        ) : null}
        <span className="commit-count">
          {plural(snapshot.commits.length, "commit")}
          {snapshot.truncated ? "+" : ""}
        </span>
      </div>

      <div className="toolbar-actions">
        <button className="tool-button" onClick={onRefresh} disabled={refreshing} title={`Refresh (${modKey}R)`}>
          <RefreshIcon className={refreshing ? "spin" : undefined} />
          Refresh
        </button>
        <button className="tool-button" onClick={onPick} title={`Open another repository (${modKey}O)`}>
          <FolderIcon />
          Open
        </button>
        <button className="icon-button" onClick={onClose} title="Close repository" aria-label="Close repository">
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
