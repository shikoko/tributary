import { useEffect, useState } from "react";
import { setAsideBranches, type RememberedBranch } from "../api";
import { compactTime, plural } from "../lib/format";
import { Dialog } from "./Dialog";
import { BranchIcon } from "./Icons";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  repoPath: string;
  onCancel: () => void;
  onKeep: (references: string[]) => void;
  onForget: (references: string[]) => void;
}

/**
 * After a fetch: branches the remote no longer has, whose work isn't on any branch here, which
 * the fetch set aside rather than forget. Keep them as branches here, or forget them (Restore
 * keeps a copy). Closed without choosing, they're asked about again after the next fetch.
 */
export function KeepRememberedDialog({ repoPath, onCancel, onKeep, onForget }: Props) {
  const [found, setFound] = useState<RememberedBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setAsideBranches(repoPath)
      .then((list) => live && setFound(list))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [repoPath]);

  const list = found ?? [];
  const remotes = [...new Set(list.map((branch) => branch.remote))];
  const remote = remotes.length === 1 ? remotes[0] : "The remotes";
  const references = list.map((branch) => branch.reference);
  return (
    <Dialog
      title={found ? `Keep ${plural(list.length, "branch", "branches")} ${remotes.length === 1 ? remote : "the remotes"} no longer ${remotes.length === 1 ? "has" : "have"}?` : "Branches the remote no longer has"}
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        list.length === 0 ? (
          <Button kind="secondary" onClick={onCancel}>
            Close
          </Button>
        ) : (
          <>
            <Button kind="secondary" onClick={() => onForget(references)}>
              {list.length === 1 ? "Forget it" : "Forget them"}
            </Button>
            <Button kind="primary" onClick={() => onKeep(references)}>
              {list.length === 1 ? "Keep it as a branch" : "Keep them as branches"}
            </Button>
          </>
        )
      }
    >
      {found && list.length === 0 ? (
        <p className="hint">There's nothing to keep: their work is on a branch here now.</p>
      ) : (
        found && (
          <>
            <p>
              {remotes.length === 1 ? remote : "The remotes"} {remotes.length === 1 ? "doesn't" : "don't"} have {list.length === 1 ? "this" : "these"} any more,
              and {list.length === 1 ? "its" : "their"} work isn't on any branch here, so the fetch kept {list.length === 1 ? "it" : "them"} aside. Keep{" "}
              {list.length === 1 ? "it as a branch" : "them as branches"} here, or forget {list.length === 1 ? "it" : "them"}: Restore keeps a copy for 30 days.
            </p>
            <ul className="prune-list keep-remembered-list">
              {list.map((branch) => (
                <li key={branch.reference} className="prune-row">
                  <div className="prune-line">
                    <span className="prune-main">
                      <span className="prune-top">
                        <span className="ref-pill">
                          <BranchIcon size={12} />
                          <span className="ref-name">{`${branch.remote}/${branch.name}`}</span>
                        </span>
                        <Chip className="prune-tag idle" title={`${plural(branch.commits, "commit")} not on any branch, tag or remote branch here`}>
                          {`${plural(branch.commits, "commit")} only there`}
                        </Chip>
                      </span>
                      <span className="prune-summary">{branch.summary}</span>
                    </span>
                    <span className="prune-when">{compactTime(branch.time)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </Dialog>
  );
}
