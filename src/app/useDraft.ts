import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_DRAFT, type CommitDraft } from "../components/WorktreeDetails";

/** The commit message being written, kept for each repository while switching tabs. */
export function useDraft(repoPath: string | null) {
  const [draft, setDraft] = useState<CommitDraft>(EMPTY_DRAFT);
  const drafts = useRef(new Map<string, CommitDraft>());
  useEffect(() => {
    if (repoPath) drafts.current.set(repoPath, draft);
  }, [draft, repoPath]);
  /** A repository was opened: back to the message you were writing there. */
  const restore = useCallback((path: string) => setDraft(drafts.current.get(path) ?? EMPTY_DRAFT), []);
  return { draft, setDraft, restore };
}

export type Draft = ReturnType<typeof useDraft>;
