import type { CommitRow } from "../api";

/** A period of time commits are grouped into, like "Yesterday" or "October". */
export interface DayBucket {
  /** Larger is longer ago. */
  order: number;
  label: string;
}

const monthName = new Intl.DateTimeFormat(undefined, { month: "long" });
const monthAndYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Today, Yesterday, Earlier this week, Last week, Earlier this month, then by month. */
export function dayBucket(seconds: number, now = new Date()): DayBucket {
  const date = new Date(seconds * 1000);
  const days = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY);
  if (days <= 0) return { order: 0, label: "Today" };
  if (days === 1) return { order: 1, label: "Yesterday" };
  // Weeks start on Monday.
  const intoWeek = (now.getDay() + 6) % 7;
  if (days <= intoWeek) return { order: 2, label: "Earlier this week" };
  if (days <= intoWeek + 7) return { order: 3, label: "Last week" };
  const months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth();
  if (months <= 0) return { order: 4, label: "Earlier this month" };
  return {
    order: 4 + months,
    label: date.getFullYear() === now.getFullYear() ? monthName.format(date) : monthAndYear.format(date),
  };
}

/** A row in the commit list: a commit (its index), or a divider before a new period. */
export type Slot = number | { day: string; before: number };

/**
 * The rows of the commit list, with a divider wherever a new period starts. Periods only
 * ever get older going down, so commits with skewed clocks don't add extra dividers.
 */
export function slotsFor(commits: CommitRow[], separators: boolean, now = new Date()): Slot[] {
  if (!separators) return commits.map((_, index) => index);
  const slots: Slot[] = [];
  let current = -1;
  commits.forEach((commit, index) => {
    if (commit.kind !== "worktree") {
      const bucket = dayBucket(commit.commitTime, now);
      if (bucket.order > current) {
        slots.push({ day: bucket.label, before: index });
        current = bucket.order;
      }
    }
    slots.push(index);
  });
  return slots;
}
