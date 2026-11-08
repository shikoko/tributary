import { createContext } from "react";
import { plural } from "./format";

/** How far a local branch is ahead of and behind the remote branch it tracks. */
export interface BranchSync {
  ahead: number;
  behind: number;
  /** Like "origin/main". */
  upstream: string;
}

/** Local branches' counts by name, for their labels in the graph. */
export const BranchSyncContext = createContext<Map<string, BranchSync>>(new Map());

/** "1 commit behind origin/main", "2 commits ahead of and 3 behind origin/main", or null when level. */
export function describeSync({ ahead, behind, upstream }: BranchSync): string | null {
  if (ahead > 0 && behind > 0) return `${plural(ahead, "commit")} ahead of and ${behind} behind ${upstream}`;
  if (ahead > 0) return `${plural(ahead, "commit")} ahead of ${upstream} (not pushed yet)`;
  if (behind > 0) return `${plural(behind, "commit")} behind ${upstream} (pull to bring them in)`;
  return null;
}
