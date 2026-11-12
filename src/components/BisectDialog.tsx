import type { CommitRow } from "../api";
import { shortId } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

interface Props {
  /** The commit that worked, and the checked-out one, which doesn't. */
  good: CommitRow;
  bad: { id: string; label: string; summary: string };
  /** How many commits lie between them. */
  between: number;
  onCancel: () => void;
  onStart: () => void;
}

/** Start bisecting: find the first bad commit between one that worked and the checked-out one. */
export function BisectDialog({ good, bad, between, onCancel, onStart }: Props) {
  const tests = Math.max(1, Math.ceil(Math.log2(between + 1)));
  return (
    <Dialog
      title="Find the commit that broke it"
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="primary" onClick={onStart} autoFocus>
            Start bisecting
          </Button>
        </>
      }
    >
      <dl className="bisect-ends">
        <dt className="good">Worked</dt>
        <dd>
          <span className="mono">{shortId(good.id)}</span> {good.summary}
        </dd>
        <dt className="bad">Broken</dt>
        <dd>
          <span className="mono">{bad.label}</span> {bad.summary}
        </dd>
      </dl>
      <p className="dialog-note-line">
        Tributary checks out the commit halfway between them. Try it (build it, run it), then say whether it's <strong>good</strong> or <strong>bad</strong>, and
        it halves what's left, until it finds the first bad commit: about {tests === 1 ? "1 test" : `${tests} tests`} for these {between} commits. <strong>Stop</strong>{" "}
        takes you back to where you are now.
      </p>
    </Dialog>
  );
}
