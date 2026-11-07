const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const relativeShort = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
const dayInYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5 minutes ago" for the last week, a plain date after that. */
export function relativeTime(seconds: number, now = Date.now() / 1000): string {
  const diff = seconds - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return relative.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return relative.format(Math.round(diff / DAY), "day");
  return shortDate.format(new Date(seconds * 1000));
}

/**
 * Like {@link relativeTime}, but shorter, for the commit list: "5 min. ago", "21 hr. ago",
 * "yesterday", then "Oct 31" this year and "Oct 31, 2025" before.
 */
export function compactTime(seconds: number, now = Date.now() / 1000): string {
  const diff = seconds - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return relativeShort.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return relativeShort.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return relativeShort.format(Math.round(diff / DAY), "day");
  const date = new Date(seconds * 1000);
  return date.getFullYear() === new Date(now * 1000).getFullYear() ? dayInYear.format(date) : shortDate.format(date);
}

const longDateUtc = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function fullDate(seconds: number): string {
  return longDate.format(new Date(seconds * 1000));
}

/** The date and time on the clock of whoever made the commit, given their UTC offset in seconds. */
export function dateInZone(seconds: number, offset: number): string {
  return longDateUtc.format(new Date((seconds + offset) * 1000));
}

/** A timezone offset in seconds as "UTC+02:00". */
export function utcOffset(offset: number): string {
  const sign = offset < 0 ? "−" : "+";
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / HOUR)).padStart(2, "0");
  const minutes = String(Math.floor((abs % HOUR) / MINUTE)).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export function shortId(id: string): string {
  return id.slice(0, 7);
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : pluralWord}`;
}

/** "48 MB", like Git LFS shows sizes (powers of 1000). */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
}
