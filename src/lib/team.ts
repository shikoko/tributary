// The arithmetic behind Team activity's charts: which day each commit falls on, everyone's
// colour, and the scales.

/** Colours for people, in this order (theme.css: --series-1 to --series-8); the ninth person on is grey. */
export const SERIES_SLOTS = 8;

/** The local midnight before `ms`. */
export function dayStart(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The local midnight after the one at `day` (a day can be 23 or 25 hours long). */
export function nextDay(day: number): number {
  const next = new Date(day);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** The days a period covers, each as its midnight: from the day `since` (seconds) falls on to today. */
export function periodDays(since: number, now: number): number[] {
  const days: number[] = [];
  for (let day = dayStart(since * 1000); day <= now; day = nextDay(day)) days.push(day);
  return days;
}

/** How many of `times` (seconds since the epoch) fall on each of `days`. */
export function perDay(times: number[], days: number[]): number[] {
  const counts = days.map(() => 0);
  if (days.length === 0) return counts;
  const end = nextDay(days[days.length - 1]);
  for (const time of times) {
    const ms = time * 1000;
    if (ms < days[0] || ms >= end) continue;
    let index = days.length - 1;
    while (index > 0 && days[index] > ms) index--;
    counts[index]++;
  }
  return counts;
}

/**
 * Everyone's colour slot, 1 to 8 (0, grey, past that), in the order they're listed. Slots
 * already given stay, so changing the period never repaints someone.
 */
export function assignSlots(known: ReadonlyMap<string, number>, emails: string[]): Map<string, number> {
  const slots = new Map(known);
  const used = new Set(slots.values());
  for (const email of emails) {
    const key = email.toLowerCase();
    if (slots.has(key)) continue;
    let slot = 1;
    while (used.has(slot)) slot++;
    slots.set(key, slot <= SERIES_SLOTS ? slot : 0);
    used.add(slot);
  }
  return slots;
}

/** A slot's colour, as a CSS value. */
export function seriesColor(slot: number): string {
  return slot > 0 ? `var(--series-${slot})` : "var(--series-other)";
}

/** "Today", "Yesterday", or like "Tue 3". */
export function dayLabel(day: number, today: number): string {
  if (day === today) return "Today";
  if (nextDay(day) === today) return "Yesterday";
  const date = new Date(day);
  return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${date.getDate()}`;
}

/** Which days get a label on an axis: every day for a week, then sparser, always today. */
export function labelledDays(count: number): (index: number) => boolean {
  const step = count <= 8 ? 1 : count <= 15 ? 2 : 7;
  return (index) => (count - 1 - index) % step === 0;
}

/** A branch's name without its remote ("origin/feat/door" → "feat/door"). */
export function withoutRemote(name: string, remotes = ["origin"]): string {
  for (const remote of remotes) {
    if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
  }
  return name;
}

/**
 * A smooth line through `points` (x, y) that never bulges past them (a monotone cubic, so a
 * quiet day between busy ones stays at its value), as SVG path commands.
 */
export function smoothPath(points: [number, number][]): string {
  const f = (n: number) => Number(n.toFixed(2));
  if (points.length === 0) return "";
  if (points.length === 1) return `M${f(points[0][0])},${f(points[0][1])}`;
  const last = points.length - 1;
  const widths = points.slice(0, last).map(([x], i) => points[i + 1][0] - x);
  const slopes = points.slice(0, last).map(([, y], i) => (points[i + 1][1] - y) / widths[i]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === last) return slopes[last - 1];
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    const before = 2 * widths[i] + widths[i - 1];
    const after = widths[i] + 2 * widths[i - 1];
    return (before + after) / (before / slopes[i - 1] + after / slopes[i]);
  });
  let path = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < last; i++) {
    const third = widths[i] / 3;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    path += ` C${f(x0 + third)},${f(y0 + third * tangents[i])} ${f(x1 - third)},${f(y1 - third * tangents[i + 1])} ${f(x1)},${f(y1)}`;
  }
  return path;
}
