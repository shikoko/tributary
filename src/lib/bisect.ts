// Commits marked while bisecting, for their rows in the list.
import { createContext } from "react";
import type { Bisect } from "../api";

export type BisectMark = "good" | "bad" | "skipped" | "found";

/** What each marked commit is, by id. */
export const BisectMarksContext = createContext<Map<string, BisectMark>>(new Map());

/** The marks of a bisect under way: the first bad commit once found, the others as marked. */
export function bisectMarks(bisect: Bisect | null | undefined): Map<string, BisectMark> {
  const marks = new Map<string, BisectMark>();
  if (!bisect) return marks;
  for (const id of bisect.good) marks.set(id, "good");
  for (const id of bisect.skipped) marks.set(id, "skipped");
  if (bisect.bad) marks.set(bisect.bad, "bad");
  if (bisect.found) marks.set(bisect.found, "found");
  return marks;
}
