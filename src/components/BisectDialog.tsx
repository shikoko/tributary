import { useState } from "react";
import type { CommitRow } from "../api";
import { shortId } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

/** A commit before the checked-out one that may have worked, named by its tag when it has one. */
export interface GoodChoice {
  commit: CommitRow;
  tag: string | null;
}

interface Props {
  /** The commit that worked (chosen from a commit's menu), or the ones to choose from. */
  good: CommitRow | GoodChoice[];
  /** The checked-out one, which doesn't. */
  bad: { id: string; label: string; summary: string };
  /** How many commits lie between the good one and the bad one. */
  between: (good: CommitRow) => number;
  onCancel: () => void;
  onStart: (good: CommitRow) => void;
}

/** Start bisecting: find the first bad commit between one that worked and the checked-out one. */
export function BisectDialog({ good, bad, between, onCancel, onStart }: Props) {
  const choices = Array.isArray(good) ? good : null;
  // From the menu bar: the newest tag before the checked-out commit, else the oldest commit offered.
  const [chosen, setChosen] = useState(() => (choices ? (choices.find((choice) => choice.tag) ?? choices[choices.length - 1])?.commit.id : undefined));
  const worked = choices ? choices.find((choice) => choice.commit.id === chosen)?.commit : (good as CommitRow);
  const count = worked ? between(worked) : 0;
  const tests = Math.max(1, Math.ceil(Math.log2(count + 1)));
  return (
    <Dialog
      title="Find the commit that broke it"
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="primary" onClick={() => worked && onStart(worked)} disabled={!worked} autoFocus>
            Start bisecting
          </Button>
        </>
      }
    >
      <dl className="bisect-ends">
        <dt className="good">{choices ? <label htmlFor="bisect-good">Worked</label> : "Worked"}</dt>
        <dd>
          {choices ? (
            <select id="bisect-good" className="text-input bisect-good" value={chosen} onChange={(event) => setChosen(event.target.value)}>
              {choices.some((choice) => choice.tag) && (
                <optgroup label="Tags">
                  {choices
                    .filter((choice) => choice.tag)
                    .map(({ commit, tag }) => (
                      <option key={commit.id} value={commit.id}>
                        {tag} · {commit.summary}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Commits">
                {choices
                  .filter((choice) => !choice.tag)
                  .map(({ commit }) => (
                    <option key={commit.id} value={commit.id}>
                      {shortId(commit.id)} · {commit.summary}
                    </option>
                  ))}
              </optgroup>
            </select>
          ) : (
            <>
              <span className="mono">{shortId(worked!.id)}</span> {worked!.summary}
            </>
          )}
        </dd>
        <dt className="bad">Broken</dt>
        <dd>
          <span className="mono">{bad.label}</span> {bad.summary}
        </dd>
      </dl>
      <p className="dialog-note-line">
        Tributary checks out the commit halfway between them. Try it (build it, run it), then say whether it's <strong>good</strong> or <strong>bad</strong>, and
        it halves what's left, until it finds the first bad commit: about {tests === 1 ? "1 test" : `${tests} tests`} for these {count} commits. <strong>Stop</strong>{" "}
        takes you back to where you are now.
      </p>
    </Dialog>
  );
}
