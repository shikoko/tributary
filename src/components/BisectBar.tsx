import type { Bisect, CommitRow } from "../api";
import { plural, shortId } from "../lib/format";
import { SearchIcon } from "./Icons";

interface Props {
  bisect: Bisect;
  /** The commit being tested: the one checked out. */
  testing: { id: string; commit: CommitRow | undefined } | null;
  /** The first bad commit, once found (when it's loaded). */
  found: CommitRow | undefined;
  busy: boolean;
  onMark: (verdict: "good" | "bad" | "skip") => void;
  onStop: () => void;
  onShow: (id: string) => void;
}

/** "Is this commit good or bad?" while bisecting, and the first bad commit once it's found. */
export function BisectBar({ bisect, testing, found, busy, onMark, onStop, onShow }: Props) {
  const back = bisect.start ? (/^[0-9a-f]{40}$/.test(bisect.start) ? shortId(bisect.start) : bisect.start) : null;
  const stop = (
    <button className="secondary-button" onClick={onStop} disabled={busy} title={back ? `Stop, and go back to ${back}` : "Stop bisecting"}>
      {bisect.found ? "Done" : "Stop"}
    </button>
  );
  if (bisect.found) {
    return (
      <div className="operation-bar bisect-bar found" role="status">
        <SearchIcon size={14} />
        <span className="operation-text">
          <span className="operation-title">Found it:</span>{" "}
          <button className="link-button mono" onClick={() => onShow(bisect.found!)}>
            {shortId(bisect.found)}
          </button>{" "}
          {found ? <>“{found.summary}”</> : null} is the first bad commit.
        </span>
        <span className="operation-buttons">
          <button className="primary-small-button" onClick={() => onShow(bisect.found!)}>
            Show it
          </button>
          {stop}
        </span>
      </div>
    );
  }
  const ready = bisect.bad !== null && bisect.good.length > 0;
  return (
    <div className="operation-bar bisect-bar" role="status">
      <SearchIcon size={14} />
      <span className="operation-text">
        {ready && testing ? (
          <>
            <span className="operation-title">Bisecting:</span> test{" "}
            <button className="link-button mono" onClick={() => onShow(testing.id)}>
              {shortId(testing.id)}
            </button>
            {testing.commit && <> “{testing.commit.summary}”</>}, then say whether it's good or bad.
            {bisect.left !== null && (
              <span className="bisect-left">
                {" "}
                {plural(bisect.left, "commit")} could be the one{bisect.steps !== null ? `, about ${plural(bisect.steps + 1, "test")} to go` : ""}.
              </span>
            )}
          </>
        ) : (
          <>
            <span className="operation-title">Bisecting:</span> mark a commit that works and one that doesn't (from their menus) to start.
          </>
        )}
      </span>
      <span className="operation-buttons">
        {ready && (
          <>
            <button className="bisect-button good" onClick={() => onMark("good")} disabled={busy} title="It works: the problem came later">
              Good
            </button>
            <button className="bisect-button bad" onClick={() => onMark("bad")} disabled={busy} title="It's broken: the problem is here or earlier">
              Bad
            </button>
            <button className="secondary-button" onClick={() => onMark("skip")} disabled={busy} title="Can't tell (it doesn't build, say): try another one">
              Skip
            </button>
          </>
        )}
        {stop}
      </span>
    </div>
  );
}
