import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_DRAFT, type CommitDraft } from "../components/WorktreeDetails";

/** Where the drafts are kept, so a restart (for an update, say) doesn't lose one. */
const KEY = "tributary.commitDrafts";

const isEmpty = (draft: CommitDraft) => !draft.summary.trim() && !draft.description.trim() && !draft.amend;

function load(): Map<string, CommitDraft> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, CommitDraft>;
    return new Map(Object.entries(saved).filter(([, draft]) => typeof draft?.summary === "string" && typeof draft?.description === "string"));
  } catch {
    return new Map();
  }
}

function save(drafts: Map<string, CommitDraft>) {
  try {
    const kept = [...drafts].filter(([, draft]) => !isEmpty(draft));
    if (kept.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not kept, then: it's still there until Tributary closes.
  }
}

/** The commit message being written, kept for each repository while switching tabs and across restarts. */
export function useDraft(repoPath: string | null) {
  const [draft, setDraft] = useState<CommitDraft>(EMPTY_DRAFT);
  const drafts = useRef<Map<string, CommitDraft> | null>(null);
  useEffect(() => {
    if (!repoPath) return;
    const map = (drafts.current ??= load());
    map.set(repoPath, draft);
    // Saved a moment after typing stops.
    const timer = setTimeout(() => save(map), 400);
    return () => clearTimeout(timer);
  }, [draft, repoPath]);
  /** A repository was opened: back to the message you were writing there. */
  const restore = useCallback((path: string) => {
    drafts.current ??= load();
    setDraft(drafts.current.get(path) ?? EMPTY_DRAFT);
  }, []);
  return { draft, setDraft, restore };
}

export type Draft = ReturnType<typeof useDraft>;
