import { useState } from "react";
import type { Overlap } from "../../api";
import { overlapHeadline } from "../../lib/elsewhere";
import { relativeTime } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { BranchIcon } from "../Icons";

/** How many files are listed before "Show all". */
const SHOWN = 4;

interface Props {
  overlaps: Overlap[];
  /** Select a commit in the graph (another branch's change). */
  onShow: (commit: string) => void;
}

/**
 * Files you're changing that someone also changed on another branch. For assets that
 * can't be merged, it's a warning (one version will have to win); for code, a note.
 */
export function ElsewhereWarning({ overlaps, onShow }: Props) {
  const [all, setAll] = useState(false);
  if (overlaps.length === 0) return null;
  const assets = overlaps.some((overlap) => overlap.unmergeable);
  const shown = all ? overlaps : overlaps.slice(0, SHOWN);
  return (
    <div className={`file-warning elsewhere${assets ? " assets" : ""}`} role="status">
      <BranchIcon size={14} />
      <div>
        <div>
          {overlapHeadline(overlaps)}{" "}
          {assets
            ? "Files like these can't be merged, so one version will have to win: check with whoever changed them before you go further."
            : "Git can usually merge both changes, though you may get conflicts."}
        </div>
        <ul className="elsewhere-list">
          {shown.map((overlap) => {
            const [latest, ...more] = overlap.elsewhere;
            return (
              <li key={overlap.path} title={overlap.path}>
                <span className="elsewhere-file">{baseName(overlap.path)}</span>
                {!overlap.uncommitted && <span className="elsewhere-note">in your commits</span>}
                <button className="link-button elsewhere-branch" onClick={() => onShow(latest.commit)} title={`Show "${latest.summary}"`}>
                  {latest.branch}
                </button>
                <span className="elsewhere-who">
                  {latest.author}, {relativeTime(latest.time)}
                  {more.length > 0 && ` (+${more.length})`}
                </span>
              </li>
            );
          })}
        </ul>
        {overlaps.length > SHOWN && (
          <button className="link-button" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${overlaps.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
