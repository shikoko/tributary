import { useEffect, useRef, useState } from "react";
import type { RequestCheck } from "../api";
import { checkKey, checksVerdict, checkTime, describeCheckProgress } from "../lib/pullRequests";
import { ExternalLinkIcon } from "./Icons";

type Props = {
  checks: RequestCheck[];
  now: number;
  gitlab: boolean;
  openUrl: (url: string) => void;
  /** The check in the spotlight (its wave here, its row in the timeline, by its checkKey), and a way to change it. */
  lit: string | null;
  onLight: (key: string | null) => void;
};
type Tone = "success" | "failure" | "pending" | "cancelled";

const stateOf = (check: RequestCheck): Tone => check.state ?? "success";
const queued = (check: RequestCheck) => check.state === "pending" && !check.startedAt;
const WORDS = { success: "passed", failure: "failed", pending: "running", cancelled: "cancelled" };

const COLOURS: Record<Tone, string> = {
  success: "var(--success)",
  failure: "var(--danger)",
  pending: "var(--warning)",
  cancelled: "var(--text-faint)",
};

/** The colours of `states` mixed in proportion, as CSS (null for none). */
export function blend(states: Tone[]): string | null {
  let colour: string | null = null;
  let total = 0;
  for (const tone of ["success", "pending", "cancelled", "failure"] as Tone[]) {
    const count = states.filter((state) => state === tone).length;
    if (count === 0) continue;
    total += count;
    colour = colour ? `color-mix(in oklch, ${COLOURS[tone]} ${Math.round((count / total) * 100)}%, ${colour})` : COLOURS[tone];
  }
  return colour;
}

/** The width of an element, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Where a request's checks stand, as tributaries: each check that ran is a wave in its own
 * colour, starting apart and flowing together into one braid that ends in the verdict, so
 * once every check has passed it's a braid of green. A running one flows, a queued one is a
 * dotted trickle, and a failed one runs dry before the end, where a ripple keeps spreading.
 * When a check finishes, its wave refills in its new colour; when the last one passes, a
 * light runs along them all and the braid glows once. Hovering a wave (or its row in the
 * timeline, or tabbing to it) puts it in the spotlight, with a label that follows the
 * pointer; clicking it, or Enter, opens its page.
 */
/** How wide a wave is (its stroke, in the stylesheet too). */
const WAVE_WIDTH = 2.5;

export function CheckTributaries({ checks: given, now, gitlab, openUrl, lit, onLight }: Props) {
  // Each check keeps its lane however it's doing, so a wave changes colour where it is.
  const checks = [...given].sort((a, b) => a.name.localeCompare(b.name));
  const [box, width] = useWidth<HTMLDivElement>();
  // Taller for many checks, so their waves don't crowd.
  const height = Math.min(160, Math.max(96, 24 + given.length * 9));
  const n = checks.length;
  const middle = height / 2;
  const v = checksVerdict(checks);
  const line = describeCheckProgress(checks, gitlab);
  // What each check looked like last time, so one that has just finished can settle into
  // its new look, and the moment the last one passes can be marked.
  const looks = JSON.stringify(checks.map((check) => [checkKey(check), queued(check) ? "queued" : stateOf(check)]));
  const before = useRef<Map<string, string> | null>(null);
  const toneBefore = useRef<Tone | null>(null);
  const [settling, setSettling] = useState<Map<string, string>>(new Map());
  const [celebrating, setCelebrating] = useState(false);
  // Where along the lit wave the label sits: under the pointer, or a third of the way along.
  const [labelAt, setLabelAt] = useState<number | null>(null);
  useEffect(() => {
    const current = new Map(JSON.parse(looks) as [string, string][]);
    const changed = new Map<string, string>();
    for (const [key, look] of current) {
      const was = before.current?.get(key);
      if (was && was !== look && (look === "success" || look === "failure" || look === "cancelled")) changed.set(key, was);
    }
    const passedNow = toneBefore.current !== null && toneBefore.current !== "success" && v.tone === "success";
    before.current = current;
    toneBefore.current = v.tone;
    const timers: number[] = [];
    if (changed.size > 0) {
      timers.push(window.setTimeout(() => setSettling(changed), 0));
      timers.push(window.setTimeout(() => setSettling(new Map()), 1600));
    }
    if (passedNow) {
      timers.push(window.setTimeout(() => setCelebrating(true), 0));
      timers.push(window.setTimeout(() => setCelebrating(false), 3200));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [looks, v.tone]);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // Where the tributaries meet: from there on they're one river, flowing into the verdict.
  const confluence = Math.round(width * 0.66);
  // The river: a little wider the more waves feed it. The waves arrive side by side across
  // it, so where they meet they're exactly as wide as the river, which keeps that width.
  const wide = n === 1 ? WAVE_WIDTH : Math.min(5.5, WAVE_WIDTH + (n - 1) * 0.4);
  const arrival = (index: number) => (n === 1 ? middle : middle - (wide - WAVE_WIDTH) / 2 + (index * (wide - WAVE_WIDTH)) / (n - 1));
  const wave = (index: number) => {
    const start = n === 1 ? middle : 12 + (index * (height - 24)) / (n - 1);
    const end = arrival(index);
    const phase = index * 1.1;
    return (x: number) => {
      const s = smooth(Math.min(1, x / confluence));
      return start + (end - start) * s + 7 * (1 - s) * Math.sin((2 * Math.PI * x) / 190 + phase);
    };
  };
  const riverEnd = width - 4;
  // Its second half narrows a little and it fades out well before the verdict, so it has no
  // head and no end to see. It
  // starts a little before the waves meet, under them, so its glow comes in gently.
  const leadIn = 18;
  const river = (() => {
    const narrowFrom = confluence + (riverEnd - confluence) * 0.45;
    const along = (x: number, from: number, to: number) => smooth(Math.max(0, Math.min(1, (x - from) / (to - from))));
    const half = (x: number) =>
      x < confluence ? (wide / 2) * along(x, confluence - leadIn, confluence) : (wide / 2) * (1 - 0.6 * along(x, narrowFrom, riverEnd));
    const xs: number[] = [];
    for (let x = confluence - leadIn; x < riverEnd; x += 6) xs.push(x);
    xs.push(riverEnd);
    const top = xs.map((x) => `${x} ${(middle - half(x)).toFixed(2)}`);
    const bottom = [...xs].reverse().map((x) => `${x} ${(middle + half(x)).toFixed(2)}`);
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  })();
  // Where they meet, the river is the colours of the waves that reach it (a failed one runs
  // dry first), and it turns into the verdict's colour on its way.
  const arriving = blend(checks.filter((check) => check.state !== "failure").map((check) => (queued(check) ? "pending" : stateOf(check))));
  // It keeps their colour for a while, then turns into the verdict's through a bright middle
  // (mixed by how colours look, not through a muddy brown), before it fades.
  const from = arriving ?? "var(--river)";
  const litIndex = lit === null ? -1 : checks.findIndex((check) => checkKey(check) === lit);
  const litCheck = litIndex >= 0 ? checks[litIndex] : null;
  const labelX = Math.min(confluence - 40, Math.max(90, labelAt ?? width * 0.3));
  const across = (event: { clientX: number }) => event.clientX - (box.current?.getBoundingClientRect().left ?? 0);
  const light = (key: string | null, x: number | null = null) => {
    onLight(key);
    setLabelAt(x);
  };
  return (
    <div className={`tributaries ${v.tone}${celebrating ? " celebrating" : ""}${litCheck ? " lit" : ""}`}>
      <div className="tributaries-streams" ref={box}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
          <defs>
            <linearGradient id="tributaries-confluence" gradientUnits="userSpaceOnUse" x1={confluence} y1={middle} x2={riverEnd} y2={middle}>
              <stop offset="0" style={{ stopColor: from }} />
              <stop offset="0.12" style={{ stopColor: from }} />
              <stop offset="0.24" style={{ stopColor: `color-mix(in oklch, ${from}, var(--river))` }} />
              <stop offset="0.36" style={{ stopColor: "var(--river)" }} />
            </linearGradient>
            <linearGradient id="tributaries-mouth" gradientUnits="userSpaceOnUse" x1={confluence} y1={middle} x2={riverEnd} y2={middle}>
              {/* Fading out soon and slowly, so where it ends can't be made out. */}
              <stop offset="0.3" stopColor="#fff" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0.75" />
              <stop offset="0.58" stopColor="#fff" stopOpacity="0.45" />
              <stop offset="0.7" stopColor="#fff" stopOpacity="0.2" />
              <stop offset="0.8" stopColor="#fff" stopOpacity="0.07" />
              <stop offset="0.9" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="tributaries-fade" maskUnits="userSpaceOnUse" x={confluence - leadIn - 12} y={0} width={riverEnd - confluence + leadIn + 24} height={height}>
              <rect x={confluence - leadIn - 12} y={0} width={riverEnd - confluence + leadIn + 24} height={height} fill="url(#tributaries-mouth)" />
            </mask>
          </defs>
          <g mask="url(#tributaries-fade)">
            <path className="tributaries-river" d={river} fill="url(#tributaries-confluence)" />
            {v.tone === "pending" && <path className="tributaries-river-flow" d={`M${confluence} ${middle} L${riverEnd} ${middle}`} />}
            {celebrating && (
              <path className="tributaries-river-sweep" d={`M${confluence} ${middle} L${riverEnd} ${middle}`} pathLength={100} style={{ animationDelay: `${1900 + n * 90}ms` }} />
            )}
          </g>
          {checks.map((check, index) => {
            const y = wave(index);
            let d = "";
            for (let x = 0; x < confluence; x += 4) d += `${x === 0 ? "M" : " L"}${x} ${y(x).toFixed(1)}`;
            d += ` L${confluence} ${arrival(index).toFixed(2)}`;
            const state = stateOf(check);
            const waiting = queued(check);
            const dry = confluence * 0.72;
            const time = checkTime(check, now);
            const title = `${check.name}: ${waiting ? "queued" : WORDS[state]}${time ? ` · ${time}` : ""}`;
            const was = settling.get(checkKey(check));
            const open = () => check.url && openUrl(check.url);
            return (
              <g key={`${check.name}-${index}`} className={`tributaries-stream ${state}${waiting ? " queued" : ""}${was ? " settling" : ""}${checkKey(check) === lit ? " lit" : ""}`}>
                {was && <path className={`tributaries-stream-ghost ${was}`} d={d} pathLength={100} />}
                <path className="tributaries-stream-line" d={d} pathLength={100} />
                {state === "failure" && (
                  <>
                    <circle className="tributaries-stream-ripple" cx={dry} cy={y(dry)} r={3.5} />
                    <circle className="tributaries-stream-end" cx={dry} cy={y(dry)} r={3.5} />
                  </>
                )}
                {celebrating && <path className="tributaries-stream-sweep" d={d} pathLength={100} style={{ animationDelay: `${900 + index * 90}ms` }} />}
                <path
                  className="tributaries-stream-hit"
                  d={d}
                  role={check.url ? "link" : undefined}
                  tabIndex={check.url ? 0 : -1}
                  aria-label={check.url ? `${title}: open its page` : title}
                  onMouseEnter={(event) => light(checkKey(check), across(event))}
                  onMouseMove={(event) => setLabelAt(across(event))}
                  onMouseLeave={() => light(null)}
                  onFocus={() => light(checkKey(check))}
                  onBlur={() => light(null)}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open();
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
        {litCheck && (
          // Above its wave, or below it when the wave runs along the top.
          <div
            className={`tributaries-label ${stateOf(litCheck)}${wave(litIndex)(labelX) < 44 ? " below" : ""}`}
            style={{ left: labelX, top: wave(litIndex)(labelX) }}
            aria-hidden
          >
            <span className="tributaries-label-dot" />
            <span className="tributaries-label-name">{litCheck.name}</span>
            <span className="tributaries-label-state">
              {queued(litCheck) ? "queued" : WORDS[stateOf(litCheck)]}
              {checkTime(litCheck, now) ? ` · ${checkTime(litCheck, now)}` : ""}
            </span>
            {litCheck.url && <ExternalLinkIcon size={11} />}
          </div>
        )}
      </div>
      <div className={`tributaries-verdict ${v.tone}`}>
        <span className="tributaries-word">{v.word}</span>
        {line && <span className="tributaries-line">{line}</span>}
      </div>
    </div>
  );
}
