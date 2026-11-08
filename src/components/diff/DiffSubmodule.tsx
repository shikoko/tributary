import type { SubmoduleChange } from "../../api";
import { plural, shortId } from "../../lib/format";
import { SubmoduleIcon } from "../Icons";

/** What a submodule's change was: the commit it moved from and to, and the commits in between. */
function headline(change: SubmoduleChange): string {
  const { before, after, commits, rewound } = change;
  if (!before && after) return "Submodule added";
  if (before && !after) return "Submodule removed";
  if (before === after) return change.dirty ? "Only its own files changed" : "No change";
  if (commits.length === 0) return "Moved to another commit";
  const count = `${plural(commits.length, "commit")}${change.more ? " or more" : ""}`;
  return rewound ? `Moved back by ${count}` : `Moved forward by ${count}`;
}

export function DiffSubmodule({ change }: { change: SubmoduleChange }) {
  const { before, after } = change;
  return (
    <div className="diff-submodule">
      <div className="diff-submodule-head">
        <SubmoduleIcon size={18} />
        <div>
          <strong>{headline(change)}</strong>
          <div className="diff-submodule-ids">
            {before && <code>{shortId(before)}</code>}
            {before && after && before !== after && <span aria-label="to"> → </span>}
            {after && after !== before && <code>{shortId(after)}</code>}
          </div>
        </div>
      </div>
      {change.commits.length > 0 && (
        <ul className={`diff-submodule-commits${change.rewound ? " rewound" : ""}`}>
          {change.commits.map((commit) => (
            <li key={commit.id}>
              <code>{shortId(commit.id)}</code>
              <span>{commit.summary}</span>
            </li>
          ))}
          {change.more && <li className="muted">and more</li>}
        </ul>
      )}
      {before && after && before !== after && change.commits.length === 0 && (
        <p className="muted">Its commits aren't downloaded here: update the submodule to see them.</p>
      )}
      {change.rewound && <p className="muted">These commits were in its history before, and aren't after.</p>}
      {change.dirty && <p className="diff-submodule-dirty">It also has uncommitted changes of its own: open it in a tab to see them.</p>}
    </div>
  );
}
