// Get latest on a schedule: a pull of every open repository at a set time (07:00, say), so
// a big update is waiting in the morning.

/** On which days. */
export type ScheduleDays = "off" | "daily" | "weekdays";

/** How a repository's scheduled pull went. */
export interface ScheduledResult {
  name: string;
  ok: boolean;
  message: string;
}

/** The last scheduled run: when, and how each repository's pull went. */
export interface ScheduledRun {
  /** Milliseconds since the epoch. */
  time: number;
  results: ScheduledResult[];
}

/** How long after the set time a run still starts (a computer woken from sleep): after that, the day is skipped. */
export const GRACE_MINUTES = 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's run at `time` ("07:00"), as a key, when it's due at `now`: on a scheduled day, no earlier than the time and not long after. */
export function dueRun(days: ScheduleDays, time: string, now: Date, grace = GRACE_MINUTES): string | null {
  if (days === "off") return null;
  const at = timeOn(now, time);
  if (!at || now < at || now.getTime() - at.getTime() > grace * 60_000) return null;
  if (days === "weekdays" && (at.getDay() === 0 || at.getDay() === 6)) return null;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
}

/** When it runs next, after `now`. */
export function nextRun(days: ScheduleDays, time: string, now: Date): Date | null {
  if (days === "off") return null;
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const at = timeOn(day, time);
    if (!at || at <= now) continue;
    if (days === "weekdays" && (at.getDay() === 0 || at.getDay() === 6)) continue;
    return at;
  }
  return null;
}

/** "07:00" on `day`. */
function timeOn(day: Date, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2]));
}

/** "Got the latest of 3 repositories", "… of 2 of 3; notebook didn't". */
export function describeRun(run: ScheduledRun): string {
  const done = run.results.filter((result) => result.ok);
  const failed = run.results.filter((result) => !result.ok);
  const total = run.results.length;
  if (total === 0) return "No repositories were open to get the latest of";
  if (failed.length === 0) return total === 1 ? `Got the latest of ${run.results[0].name}` : `Got the latest of ${total} repositories`;
  const names = failed.map((result) => result.name).join(", ");
  return done.length === 0 ? `Couldn't get the latest of ${names}` : `Got the latest of ${done.length} of ${total} repositories; not ${names}`;
}
