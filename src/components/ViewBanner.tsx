import type { Focus } from "../app/constants";
import { baseName } from "../lib/paths";
import { plural } from "../lib/format";
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, FileHistoryIcon } from "./Icons";

interface Props {
  focus: Focus | null;
  /** Only the checked-out branch's own (first-parent) history is shown. */
  firstParent: boolean;
  /** The branches shown on their own, as full ref names. */
  solo: string[];
  /** The checked-out branch, or "HEAD". */
  branchLabel: string;
  /** Highlighting the user's own commits. */
  mine: boolean;
  /** How many loaded commits are highlighted. */
  focusedCount: number;
  /** For a file's history: the rows of the loaded commits that changed it. */
  pathMatches: number[];
  selectedIndex: number | undefined;
  onStep: (direction: -1 | 1) => void;
  /** Leave the highlight, or show every branch again. */
  onShowEverything: () => void;
}

/** Says what part of the history is highlighted or shown, with a way back to all of it. */
export function ViewBanner({ focus, firstParent, solo, branchLabel, mine, focusedCount, pathMatches, selectedIndex, onStep, onShowEverything }: Props) {
  return (
    <div className="view-banner" role="status">
      {focus?.kind === "path" ? <FileHistoryIcon size={14} /> : <EyeIcon size={14} />}
      {focus?.kind === "path" ? (
        <span>
          Highlighting the {plural(focus.ids.length, "commit")}
          {focus.truncated ? "+" : ""} that changed{" "}
          <strong title={focus.path}>
            {baseName(focus.path)}
            {focus.folder ? "/" : ""}
          </strong>
          {focus.ids.length > pathMatches.length && ` (${(focus.ids.length - pathMatches.length).toLocaleString()} not loaded)`}.
        </span>
      ) : focus?.kind === "history" ? (
        <span>
          Highlighting <strong>{focus.name}</strong>'s history.
        </span>
      ) : focus?.kind === "author" ? (
        <span>
          Highlighting <strong>{mine ? "your" : `${focus.name || focus.email}'s`}</strong> commits ({focusedCount} loaded).
        </span>
      ) : firstParent ? (
        <span>
          Showing only <strong>{branchLabel}</strong>'s own history.
        </span>
      ) : (
        <span>
          Showing only{" "}
          <strong>
            {solo
              .map((name) => name.replace(/^refs\/(heads|remotes|tags)\//, ""))
              .slice(0, 4)
              .join(", ")}
            {solo.length > 4 ? ` and ${solo.length - 4} more` : ""}
          </strong>{" "}
          (and {branchLabel}).
        </span>
      )}
      {focus?.kind === "path" && pathMatches.length > 0 && (
        <span className="banner-steps">
          <button className="icon-button" onClick={() => onStep(-1)} title="Newer change" aria-label="Newer change">
            <ChevronUpIcon size={13} />
          </button>
          <span className="banner-step-count">
            {selectedIndex !== undefined && pathMatches.includes(selectedIndex)
              ? `${pathMatches.indexOf(selectedIndex) + 1} of ${pathMatches.length}`
              : plural(pathMatches.length, "change")}
          </span>
          <button className="icon-button" onClick={() => onStep(1)} title="Older change" aria-label="Older change">
            <ChevronDownIcon size={13} />
          </button>
        </span>
      )}
      <button className="link-button" onClick={onShowEverything}>
        {focus ? "Show everything (Esc)" : "Show all branches"}
      </button>
    </div>
  );
}
