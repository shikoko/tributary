import { useState } from "react";
import type { RebasedCommit, RebasedUpstream } from "../api";
import { plural, shortId } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  found: RebasedUpstream;
  onCancel: () => void;
  /** Keep the branch as it is. */
  onKeepMine: () => void;
  /** Take the remote branch's version, with `keep` (its commits that version hasn't got, oldest first) on top. */
  onTake: (keep: string[]) => void;
  /** What changed in the remote branch when it was rebased. */
  onShowChanges: () => void;
}

/**
 * A branch whose remote branch was rebased elsewhere (on another computer, or by someone
 * else) while it still has the old commits. When all of them are in the remote branch's
 * version, that version is offered in their place: nothing is lost, and Restore keeps the old
 * one. When some aren't, they're offered on top of it instead.
 */
export function TakeUpstreamDialog({ found, onCancel, onKeepMine, onTake, onShowChanges }: Props) {
  const [showThere, setShowThere] = useState(false);
  const remote = found.upstream.split("/")[0];
  const there = found.commits.filter((commit) => commit.now);
  const onlyHere = found.commits.filter((commit) => !commit.now);
  const all = onlyHere.length === 0;
  const row = (commit: RebasedCommit) => (
    <li key={commit.id} className={`rebased-row${commit.now ? "" : " only-here"}`}>
      <span className="rebased-id">{shortId(commit.id)}</span>
      {commit.now && (
        <>
          <span className="rebased-arrow" aria-label="is now">
            →
          </span>
          <span className="rebased-id">{commit.now}</span>
        </>
      )}
      <span className="rebased-summary" title={commit.summary}>
        {commit.summary}
      </span>
      {!commit.now ? (
        <Chip className="prune-tag gone" title={`${remote}'s version hasn't got this commit`}>
          Only here
        </Chip>
      ) : commit.changed ? (
        <Chip className="prune-tag idle" title="Its changes differ a little there, as when the rebase had to fit it to the commits under it">
          Changed there
        </Chip>
      ) : (
        <Chip className="prune-tag merged" title={`The same changes, in ${remote}'s version`}>
          {`In ${remote}'s`}
        </Chip>
      )}
    </li>
  );
  return (
    <Dialog
      title={
        all
          ? `Use ${remote}'s ${found.branch}?`
          : `${onlyHere.length} of your commits ${onlyHere.length === 1 ? "isn't" : "aren't"} in ${remote}'s version`
      }
      wide
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="link" className="dialog-note" onClick={onShowChanges}>
            See what changed
          </Button>
          <Button kind="secondary" onClick={onKeepMine}>
            Keep mine
          </Button>
          <Button kind="primary" onClick={() => onTake(onlyHere.map((commit) => commit.id))}>
            {all ? `Use ${remote}'s version` : `Put ${plural(onlyHere.length, "commit")} on top`}
          </Button>
        </>
      }
    >
      {all ? (
        <p>
          <strong>{found.branch}</strong> was rebased on {remote}.{" "}
          {there.length === 1 ? "Your commit is" : `All ${there.length} of your commits are`} in its version, so nothing is lost by taking it:
        </p>
      ) : (
        <p>
          <strong>{found.branch}</strong> was rebased on {remote}. It has {there.length} of your commits, but not{" "}
          {onlyHere.length === 1 ? "this one" : `these ${onlyHere.length}`}:
        </p>
      )}
      <ul className="prune-list rebased-list">
        {all ? (
          found.commits.map(row)
        ) : (
          <>
            {onlyHere.map(row)}
            {showThere ? (
              there.map(row)
            ) : (
              <li className="rebased-row rebased-more">
                <span>{`And ${plural(there.length, "commit")} that ${there.length === 1 ? "is" : "are"} in ${remote}'s version.`}</span>
                <Button kind="link" onClick={() => setShowThere(true)}>
                  Show
                </Button>
              </li>
            )}
          </>
        )}
      </ul>
      {!all && (
        <p>
          {`Put ${onlyHere.length === 1 ? "it" : "them"} on top of ${remote}'s version, and ${found.branch} will be its commits and then yours, ready to push.`}
        </p>
      )}
      <p className="safe-note">Your version is kept: Undo puts it back, or find it in Restore for 30 days.</p>
    </Dialog>
  );
}
