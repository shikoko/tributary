import { useEffect, useState } from "react";
import { upstreamChoices, type Action, type UpstreamChoices } from "../api";
import { relativeTime } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

interface Props {
  repoPath: string;
  /** The local branch whose remote branch is gone. */
  branch: string;
  /** The local branches there are, so renaming doesn't take a name that's used. */
  localBranches: string[];
  onCancel: () => void;
  /** Go ahead: the dialog closes, and the branch goes with the chosen one. */
  onChoose: (action: Action) => void;
}

/** A remote branch's name without its remote: "main" for "origin/main". */
const shortName = (name: string, remote: string) => (name.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name);

/**
 * Which of the remote's branches a branch goes with, now that the one it went with is gone
 * (renamed or deleted on the remote): the likely one first, and a box to rename the branch to
 * match.
 */
export function ChooseUpstreamDialog({ repoPath, branch, localBranches, onCancel, onChoose }: Props) {
  const [choices, setChoices] = useState<UpstreamChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  // Renamed on the remote (the local branch still has the name it had there): rename it to match.
  const [rename, setRename] = useState(true);

  useEffect(() => {
    let live = true;
    upstreamChoices(repoPath, branch)
      .then((found) => {
        if (!live) return;
        setChoices(found);
        setChosen(found.suggested ?? found.branches[0]?.name ?? null);
        setRename(shortName(found.gone, found.remote) === branch);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [repoPath, branch]);

  const remote = choices?.remote ?? "the remote";
  const newName = chosen && choices ? shortName(chosen, choices.remote) : null;
  // The box shows when the chosen one has another name, and that name isn't taken here.
  const canRename = newName !== null && newName !== branch && !localBranches.includes(newName);

  return (
    <Dialog
      title={`Which branch on ${remote} does ${branch} go with?`}
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={!chosen}
            onClick={() => chosen && onChoose({ kind: "setUpstream", branch, upstream: chosen, renameTo: canRename && rename ? newName : null })}
          >
            {chosen ? `Use ${chosen}` : "Use it"}
          </Button>
        </>
      }
    >
      <p>
        Pull and Sync take commits from it, and Push sends {branch}'s to it. {choices && <>{choices.gone} was renamed or deleted on {remote}.</>}
      </p>
      {choices && choices.branches.length === 0 && <p className="hint">{remote} has no branches to choose from. Push {branch} to put it back there.</p>}
      {choices && choices.branches.length > 0 && (
        <div className="merge-methods upstream-choices" role="radiogroup" aria-label={`${remote}'s branches`}>
          {choices.branches.map((choice) => (
            <label key={choice.name} className={`merge-method${chosen === choice.name ? " selected" : ""}`}>
              <input type="radio" name="upstream" checked={chosen === choice.name} onChange={() => setChosen(choice.name)} />
              <span className="merge-method-label">
                <span className="mono">{choice.name}</span>
                {choice.name === choices.defaultBranch && <span className="upstream-choice-tag">{remote}'s main branch</span>}
              </span>
              <span className="merge-method-hint">
                {choice.summary} · {choice.author}, {relativeTime(choice.time)}
              </span>
            </label>
          ))}
        </div>
      )}
      {canRename && (
        <label className="checkbox upstream-rename">
          <input type="checkbox" checked={rename} onChange={(event) => setRename(event.target.checked)} />
          <span>
            Also rename {branch} to <strong>{newName}</strong>, so it has the same name here as on {remote}.
          </span>
        </label>
      )}
    </Dialog>
  );
}
