import type { Hunk, LineSide, RequestComment } from "../api";

/** A thread of a pull request's comments on a line of its changes: its first comment says where. */
export interface ReviewThread {
  id: string;
  comments: RequestComment[];
  side: LineSide;
  line: number | null;
  /** The lines it was on have changed since it was written. */
  outdated: boolean;
}

/** Where on the changes a line is: its side and number. */
export const lineAt = (side: LineSide, line: number) => `${side}:${line}`;

/**
 * The threads on `path`, in the order they were started, each with its replies: a thread
 * is on the file its first comment is on, and a reply in it is in it whatever it says.
 */
export function threadsOn(comments: RequestComment[], path: string): ReviewThread[] {
  const threads = new Map<string, ReviewThread>();
  for (const comment of comments) {
    const id = comment.thread ?? comment.id;
    const thread = threads.get(id);
    if (thread) thread.comments.push(comment);
    else if (comment.path === path && !comment.reply) threads.set(id, { id, comments: [comment], side: comment.side ?? "after", line: comment.line, outdated: comment.outdated });
  }
  return [...threads.values()];
}

/** How many comments each file has on its lines. */
export function commentsByFile(comments: RequestComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) if (comment.path) counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
  return counts;
}

/**
 * Where the threads go in these changes: under their lines (by `lineAt`), or, for those on
 * lines that have changed since or that these changes don't show, elsewhere.
 */
export function placeThreads(threads: ReviewThread[], hunks: Hunk[]): { at: Map<string, ReviewThread[]>; elsewhere: ReviewThread[] } {
  const shown = new Set<string>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.old !== null) shown.add(lineAt("before", line.old));
      if (line.new !== null) shown.add(lineAt("after", line.new));
    }
  }
  const at = new Map<string, ReviewThread[]>();
  const elsewhere: ReviewThread[] = [];
  for (const thread of threads) {
    const where = thread.line === null ? null : lineAt(thread.side, thread.line);
    if (thread.outdated || where === null || !shown.has(where)) elsewhere.push(thread);
    else at.set(where, [...(at.get(where) ?? []), thread]);
  }
  return { at, elsewhere };
}

/** The threads under a line, by its numbers before and after the changes. */
export function threadsAtLine(at: ReadonlyMap<string, ReviewThread[]>, old: number | null, after: number | null): ReviewThread[] {
  return [...(old !== null ? (at.get(lineAt("before", old)) ?? []) : []), ...(after !== null ? (at.get(lineAt("after", after)) ?? []) : [])];
}
