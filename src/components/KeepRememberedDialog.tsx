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
 * After a fetch: branches the remote no longer has, whose work isn't on any branch here, and
 * branches a remote's new address doesn't have (it was pointed there outside Tributary), even
 * with no commits of their own, which the fetch set aside rather than forget. Keep them as
 * branches here, or forget them (Restore keeps a copy). Closed without choosing, they're asked
 * about again after the next fetch.
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
  const one = list.length === 1;
  const moved = list.filter((branch) => branch.moved).length;
  // Why they were kept: not at the remote's new address, or holding work found nowhere else.
  const why =
    moved === list.length
      ? `${remotes.length === 1 ? `${remote}'s new address doesn't` : "The remotes' new addresses don't"} have ${one ? "this branch" : "these branches"} from the old one, so the fetch kept ${one ? "it" : "them"} aside`
      : moved === 0
        ? `${remotes.length === 1 ? remote : "The remotes"} ${remotes.length === 1 ? "doesn't" : "don't"} have ${one ? "this" : "these"} any more, and ${one ? "its" : "their"} work isn't on any branch here, so the fetch kept ${one ? "it" : "them"} aside`
        : "Some of these aren't at the remote's new address, and the rest hold work found nowhere else here, so the fetch kept them aside";
  return (
    <Dialog
      title={
        !found
          ? "Branches the remote no longer has"
          : list.length > 0 && list.every((branch) => branch.moved)
            ? `Keep ${plural(list.length, "branch", "branches")} ${remotes.length === 1 ? `${remote}'s new address doesn't` : "the remotes' new addresses don't"} have?`
            : `Keep ${plural(list.length, "branch", "branches")} ${remotes.length === 1 ? remote : "the remotes"} no longer ${remotes.length === 1 ? "has" : "have"}?`
      }
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
              {`${why}. Keep ${one ? "it as a branch" : "them as branches"} here${moved > 0 ? ` (Push branches then puts ${one ? "it" : "them"} at the new address)` : ""}, or forget ${one ? "it" : "them"}: Restore keeps a copy for 30 days.`}
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
                        {branch.commits > 0 ? (
                          <Chip className="prune-tag idle" title={`${plural(branch.commits, "commit")} not on any branch, tag or remote branch here`}>
                            {`${plural(branch.commits, "commit")} only there`}
                          </Chip>
                        ) : (
                          <Chip className="prune-tag idle" title="Its commits are all on other branches here too: keeping it keeps the branch">
                            Commits on other branches too
                          </Chip>
                        )}
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
