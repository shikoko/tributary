import { useEffect, useState } from "react";
import { branchesToPush, type BranchesToPush } from "../api";
import { compactTime } from "../lib/format";
import { Dialog } from "./Dialog";
import { BranchIcon } from "./Icons";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  repoPath: string;
  onCancel: () => void;
  onPush: (names: string[], remote: string) => void;
}

/** "main", "main and dev", or "main, dev and docs". */
const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * The branches here with commits the remote doesn't have, to push several at once. Those on
 * the remote already (only ahead of their branch there) are ticked; one never pushed isn't,
 * as pushing shares it with everyone. One behind its branch there isn't offered: the push
 * would be refused until it's pulled.
 */
export function PushBranchesDialog({ repoPath, onCancel, onPush }: Props) {
  const [found, setFound] = useState<BranchesToPush | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    branchesToPush(repoPath, null)
      .then((result) => {
        if (!live) return;
        setFound(result);
        setChosen(new Set(result.branches.filter((branch) => branch.onRemote).map((branch) => branch.name)));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [repoPath]);

  const branches = found?.branches ?? [];
  const remote = found?.remote ?? "the remote";
  const toggle = (name: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allChosen = branches.length > 0 && chosen.size === branches.length;
  // In the order they're listed: the newest first.
  const push = () => found && onPush(branches.filter((branch) => chosen.has(branch.name)).map((branch) => branch.name), found.remote);
  const behind = found?.behind ?? [];

  return (
    <Dialog
      title={found ? `Push branches to ${remote}` : "Push branches"}
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          {branches.length > 1 && (
            <Button kind="link" className="dialog-note" onClick={() => setChosen(new Set(allChosen ? [] : branches.map((branch) => branch.name)))}>
              {allChosen ? "Select none" : "Select all"}
            </Button>
          )}
          <Button kind="secondary" onClick={onCancel}>
            {branches.length === 0 ? "Close" : "Cancel"}
          </Button>
          {branches.length > 0 && (
            <Button kind="primary" disabled={chosen.size === 0} onClick={push}>
              {chosen.size === 1 ? "Push 1 branch" : `Push ${chosen.size} branches`}
            </Button>
          )}
        </>
      }
    >
      {!found ? (
        !error && <p className="hint">Looking for commits {remote} doesn't have…</p>
      ) : branches.length === 0 ? (
        <p className="hint">Every branch here is on {remote} as it is here (as of the last fetch).</p>
      ) : (
        <>
          <p className="hint">
            Branches with commits {remote} doesn't have yet (as of the last fetch). Those already on {remote} are ticked; one you've never pushed isn't, as
            pushing shares it with everyone who fetches.
          </p>
          <ul className="prune-list push-branches-list">
            {branches.map((branch) => (
              <li key={branch.name} className={`prune-row${chosen.has(branch.name) ? " chosen" : ""}`}>
                <label>
                  <input type="checkbox" checked={chosen.has(branch.name)} onChange={() => toggle(branch.name)} />
                  <span className="prune-main">
                    <span className="prune-top">
                      <span className="ref-pill">
                        <BranchIcon size={12} />
                        <span className="ref-name">{branch.name}</span>
                      </span>
                      {branch.onRemote ? (
                        <Chip className="prune-tag merged" title={`${branch.ahead} ${branch.ahead === 1 ? "commit" : "commits"} that ${branch.onRemote} doesn't have`}>
                          {`↑${branch.ahead} to push`}
                        </Chip>
                      ) : (
                        <Chip className="prune-tag idle" title={`Pushing makes ${remote}/${branch.name}, which it then pulls from and pushes to`}>
                          never pushed
                        </Chip>
                      )}
                    </span>
                    <span className="prune-summary">{branch.summary}</span>
                  </span>
                  <span className="prune-when">{compactTime(branch.time)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {behind.length > 0 && (
        <p className="dialog-note-line">
          {listed(behind)} {behind.length === 1 ? "is" : "are"} behind {remote}, so {behind.length === 1 ? "it isn't" : "they aren't"} offered: pull first, or
          the push would be refused.
        </p>
      )}
    </Dialog>
  );
}
