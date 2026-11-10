import { useState } from "react";
import { changeRequest, type RequestChange, type RequestDetails } from "../api";

/**
 * Changing an open request besides reviewing and merging: ready for review or back to a
 * draft, asking more people to review it, and merging by itself once its checks pass.
 * `change` says whether it worked.
 */
export function useRequestChange(repoPath: string, details: RequestDetails | null, onDone: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (what: RequestChange): Promise<boolean> => {
    if (!details) return false;
    setBusy(true);
    setError(null);
    try {
      onDone(await changeRequest(repoPath, details.number, what));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, change };
}

/** Who to ask for a review: usernames (or teams), apart by spaces or commas. */
export function AskForReview({
  gitlab,
  busy,
  onAsk,
  onCancel,
}: {
  gitlab: boolean;
  busy: boolean;
  onAsk: (reviewers: string[]) => void;
  onCancel: () => void;
}) {
  const [names, setNames] = useState("");
  const reviewers = names.split(/[\s,]+/).filter(Boolean);
  return (
    <form
      className="request-ask"
      onSubmit={(event) => {
        event.preventDefault();
        if (reviewers.length > 0) onAsk(reviewers);
      }}
    >
      <input
        className="text-input"
        value={names}
        onChange={(event) => setNames(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder={gitlab ? "Usernames, like maya, theo" : "Usernames or teams, like maya, @studio/art"}
        aria-label="Who to ask"
        autoFocus
        spellCheck={false}
        autoCapitalize="off"
      />
      <button type="button" className="link-button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className="primary-small-button" disabled={busy || reviewers.length === 0}>
        <span className="button-label">Ask</span>
      </button>
    </form>
  );
}
