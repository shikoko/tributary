const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
