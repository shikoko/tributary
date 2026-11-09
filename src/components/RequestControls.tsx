import { useState } from "react";
import { changeRequest, type MergeMethod, type RequestChange, type RequestDetails } from "../api";

/**
 * An open request's controls besides reviewing and merging: ready for review or back to a
 * draft, asking more people to review it, and merging by itself once its checks pass.
 */
export function RequestControls({
  repoPath,
  details,
  methods,
  onDone,
}: {
  repoPath: string;
  details: RequestDetails;
  /** The ways the repository allows merging (for auto-merge, the first). */
  methods: MergeMethod[];
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [names, setNames] = useState("");
  const gitlab = details.forge === "gitlab";
  const change = async (what: RequestChange) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await changeRequest(repoPath, details.number, what));
      setAsking(false);
      setNames("");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };
  const draft = details.state === "draft";
  return (
    <div className="request-controls">
      <div className="request-control-buttons">
        <button className="outline-button" disabled={busy} onClick={() => void change({ kind: "draft", draft: !draft })}>
          <span className="button-label">{draft ? "Ready for review" : "Back to draft"}</span>
        </button>
        <button className={`outline-button${asking ? " active" : ""}`} disabled={busy} onClick={() => setAsking(!asking)} aria-expanded={asking}>
          <span className="button-label">Ask for review…</span>
        </button>
        {!draft && (
          <button
            className={`outline-button${details.autoMerge ? " active" : ""}`}
            disabled={busy}
            title={
              details.autoMerge
                ? "It merges by itself once its checks pass: click to stop that"
                : gitlab
                  ? "Merge it by itself when its pipeline succeeds"
                  : "Merge it by itself once its checks pass and reviews allow (the repository must allow auto-merge)"
            }
            onClick={() => void change({ kind: "autoMerge", on: !details.autoMerge, method: methods[0] })}
          >
            <span className="button-label">{details.autoMerge ? "Auto-merge is on" : gitlab ? "Merge when the pipeline succeeds" : "Merge when checks pass"}</span>
          </button>
        )}
      </div>
      {asking && (
        <form
          className="request-ask"
          onSubmit={(event) => {
            event.preventDefault();
            const reviewers = names.split(/[\s,]+/).filter(Boolean);
            if (reviewers.length > 0) void change({ kind: "reviewers", reviewers });
          }}
        >
          <input
            className="text-input"
            value={names}
            onChange={(event) => setNames(event.target.value)}
            placeholder={gitlab ? "Usernames, like maya, theo" : "Usernames or teams, like maya, @studio/art"}
            aria-label="Who to ask"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
          />
          <button type="submit" className="primary-small-button" disabled={busy || !names.trim()}>
            Ask
          </button>
        </form>
      )}
      {error && <p className="review-error">{error}</p>}
    </div>
  );
}
