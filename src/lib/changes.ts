import type { FileChange, WorktreeStatus } from "../api";

export interface ChangeCounts {
  added: number;
  modified: number;
  deleted: number;
  conflicted: number;
}

/** How many files are added, modified, deleted or conflicted, counting each path once. */
export function countChanges(status: WorktreeStatus): ChangeCounts {
  const byPath = new Map<string, FileChange["status"]>();
  for (const file of [...status.unstaged, ...status.staged]) {
    if (!byPath.has(file.path)) byPath.set(file.path, file.status);
  }
  const counts: ChangeCounts = { added: 0, modified: 0, deleted: 0, conflicted: 0 };
  for (const status of byPath.values()) {
    if (status === "added" || status === "untracked" || status === "copied") counts.added++;
    else if (status === "deleted") counts.deleted++;
    else if (status === "conflicted") counts.conflicted++;
    else counts.modified++;
  }
  return counts;
}
