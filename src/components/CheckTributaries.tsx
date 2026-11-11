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

/**
 * How to mix a colour with `tone`'s: by how they look, going round the hues (so green to red
 * passes a bright amber, not a muddy brown), but straight towards cancelled's grey, which has
 * no hue to go round to. Its grey is a little blue, and going round to that would pass a
 * bright cyan that no check is.
 */
const mixing = (tone: Tone) => (tone === "cancelled" ? "oklab" : "oklch");

/** The colours of `states` mixed in proportion, as CSS (null for none). */
export function blend(states: Tone[]): string | null {
  let colour: string | null = null;
  let total = 0;
  for (const tone of ["success", "pending", "cancelled", "failure"] as Tone[]) {
    const count = states.filter((state) => state === tone).length;
    if (count === 0) continue;
    total += count;
    colour = colour ? `color-mix(in ${mixing(tone)}, ${COLOURS[tone]} ${Math.round((count / total) * 100)}%, ${colour})` : COLOURS[tone];
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
 * timeline, or tabbing to it) puts it in the spotlight, and names it under its wave, hanging
 * from it on a dotted line, where it hides none of them; clicking it, or Enter, opens its page.
 */
/** How wide a wave is (its stroke, in the stylesheet too). */
const WAVE_WIDTH = 2.5;
/** Where along the way to the river a failed wave runs dry. */
const DRY = 0.72;
/** The caption hangs this far under the waves (the grid's gap and its margin, in the stylesheet). */
const CAPTION_DROP = 24;
/** How far apart the dots of the line it hangs from are. */
const DOT = 4;

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
  // head and no end to see. It starts a little before the waves meet, under them, so its
  // glow comes in gently.
  const leadIn = 18;
  const narrowFrom = confluence + (riverEnd - confluence) * 0.45;
  const along = (x: number, from: number, to: number) => smooth(Math.max(0, Math.min(1, (x - from) / (to - from))));
  // The waves that reach the river (a failed one runs dry first).
  const reaching = checks.flatMap((check, index) => (check.state === "failure" ? [] : [index]));
  const river = (() => {
    const half = (x: number) =>
      x < confluence ? (wide / 2) * along(x, confluence - leadIn, confluence) : (wide / 2) * (1 - 0.6 * along(x, narrowFrom, riverEnd));
    // Before they meet, it's as wide as the waves that reach it, edge to edge, and it comes
    // to its own width where they meet, so they flow into it without a narrow waist or a
    // step where it starts.
    const edges = (x: number): [number, number] => {
      if (x >= confluence || reaching.length === 0) return [middle - half(x), middle + half(x)];
      const ys = reaching.map((index) => wave(index)(x));
      const k = along(x, confluence - leadIn, confluence);
      const top = Math.min(...ys) - WAVE_WIDTH / 2;
      const bottom = Math.max(...ys) + WAVE_WIDTH / 2;
      return [top + (middle - wide / 2 - top) * k, bottom + (middle + wide / 2 - bottom) * k];
    };
    const xs: number[] = [];
    for (let x = confluence - leadIn; x < confluence; x += 2) xs.push(x);
    for (let x = confluence; x < riverEnd; x += 6) xs.push(x);
    xs.push(riverEnd);
    const top = xs.map((x) => `${x} ${edges(x)[0].toFixed(2)}`);
    const bottom = [...xs].reverse().map((x) => `${x} ${edges(x)[1].toFixed(2)}`);
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  })();
  // Where they meet, the river is the colours of the waves that reach it (a failed one runs
  // dry first), and it turns into the verdict's colour on its way.
  const arriving = blend(checks.filter((check) => check.state !== "failure").map((check) => (queued(check) ? "pending" : stateOf(check))));
  // It keeps their colour for a while, then turns into the verdict's (mixed as `mixing`
  // says), before it fades.
  const from = arriving ?? "var(--river)";
  // On their last stretch, the waves take on the river's colour, so where they meet there's
  // no change of colour to see either.
  const taking = Math.round(confluence * 0.3);
  const litIndex = lit === null ? -1 : checks.findIndex((check) => checkKey(check) === lit);
  const litCheck = litIndex >= 0 ? checks[litIndex] : null;
  // A wave in the spotlight carries on along the river (where it ran, as the river narrows)
  // and fades out with it, instead of stopping where the waves meet. A failed one ran dry.
  const onward = (() => {
    if (!litCheck || stateOf(litCheck) === "failure") return null;
    const xs: number[] = [];
    for (let x = confluence; x < riverEnd; x += 6) xs.push(x);
    xs.push(riverEnd);
    const y = (x: number) => middle + (arrival(litIndex) - middle) * (1 - along(x, narrowFrom, riverEnd));
    // Its dashes as long as the wave's, which are measured along the wave (pathLength 100).
    const wavePoints: [number, number][] = [];
    const y0 = wave(litIndex);
    for (let x = 0; x < confluence; x += 4) wavePoints.push([x, y0(x)]);
    wavePoints.push([confluence, arrival(litIndex)]);
    const waveLength = wavePoints.slice(1).reduce((sum, [x, yy], i) => sum + Math.hypot(x - wavePoints[i][0], yy - wavePoints[i][1]), 0);
    return {
      d: `M${xs.map((x) => `${x} ${y(x).toFixed(2)}`).join(" L")}`,
      pathLength: (100 * (riverEnd - confluence)) / Math.max(1, waveLength),
      state: stateOf(litCheck),
      waiting: queued(litCheck),
    };
  })();
  // The check in the spotlight is named under its wave, hanging from it on a dotted line:
  // from where it ran dry if it failed, or else from the river where they all meet.
  const hang = (() => {
    if (!litCheck) return null;
    const dry = stateOf(litCheck) === "failure";
    const x = dry ? confluence * DRY : confluence;
    const y = dry ? wave(litIndex)(x) : middle;
    // From a little under the wave to a little over the caption, in whole dots, so it
    // starts and ends on one.
    const gaps = Math.max(1, Math.floor((height + CAPTION_DROP - 16 - y) / DOT));
    return { x, length: gaps * DOT };
  })();
  return (
    <div className={`tributaries ${v.tone}${celebrating ? " celebrating" : ""}${litCheck ? " lit" : ""}`}>
      <div className="tributaries-streams" ref={box}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
          <defs>
            <linearGradient id="tributaries-confluence" gradientUnits="userSpaceOnUse" x1={confluence} y1={middle} x2={riverEnd} y2={middle}>
              <stop offset="0" style={{ stopColor: from }} />
              <stop offset="0.12" style={{ stopColor: from }} />
              <stop offset="0.24" style={{ stopColor: `color-mix(in ${mixing(v.tone)}, ${from}, var(--river))` }} />
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
            {/* The river fades in under the waves, and then they fade into it, so where they meet
                has no seam: no brighter stretch where they lie on top of each other, no round
                ends, and no fainter one where both are fading. */}
            <linearGradient id="tributaries-joining" gradientUnits="userSpaceOnUse" x1={confluence - leadIn} y1={0} x2={confluence} y2={0}>
              <stop offset="0.4" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="tributaries-rising" gradientUnits="userSpaceOnUse" x1={confluence - leadIn} y1={0} x2={confluence} y2={0}>
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" />
            </linearGradient>
            <mask id="tributaries-rise" maskUnits="userSpaceOnUse" x={confluence - leadIn - 8} y={-8} width={riverEnd - confluence + leadIn + 16} height={height + 16}>
              <rect x={confluence - leadIn - 8} y={-8} width={riverEnd - confluence + leadIn + 16} height={height + 16} fill="url(#tributaries-rising)" />
            </mask>
            <mask id="tributaries-join" maskUnits="userSpaceOnUse" x={-8} y={-8} width={confluence + 16} height={height + 16}>
              <rect x={-8} y={-8} width={confluence + 16} height={height + 16} fill="url(#tributaries-joining)" />
            </mask>
            {checks.map((check, index) => (
              <linearGradient key={index} id={`tributaries-taking-${index}`} gradientUnits="userSpaceOnUse" x1={confluence - taking} y1={0} x2={confluence} y2={0}>
                <stop offset="0" style={{ stopColor: COLOURS[queued(check) ? "pending" : stateOf(check)] }} />
                <stop offset="1" style={{ stopColor: from }} />
              </linearGradient>
            ))}
            <mask id="tributaries-fade" maskUnits="userSpaceOnUse" x={confluence - leadIn - 12} y={0} width={riverEnd - confluence + leadIn + 24} height={height}>
              <rect x={confluence - leadIn - 12} y={0} width={riverEnd - confluence + leadIn + 24} height={height} fill="url(#tributaries-mouth)" />
            </mask>
          </defs>
          <g mask="url(#tributaries-fade)">
            <path className="tributaries-river" d={river} fill="url(#tributaries-confluence)" mask="url(#tributaries-rise)" />
            {v.tone === "pending" && <path className="tributaries-river-flow" d={`M${confluence} ${middle} L${riverEnd} ${middle}`} />}
            {onward && (
              <g className={`tributaries-stream lit onward ${onward.state}${onward.waiting ? " queued" : ""}`} aria-hidden>
                <path className="tributaries-stream-line" d={onward.d} pathLength={onward.pathLength} />
              </g>
            )}
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
            const dry = confluence * DRY;
            const time = checkTime(check, now);
            const title = `${check.name}: ${waiting ? "queued" : WORDS[state]}${time ? ` · ${time}` : ""}`;
            const was = settling.get(checkKey(check));
            // The one in the spotlight carries on along the river instead.
            const joining = checkKey(check) === lit ? undefined : "url(#tributaries-join)";
            const open = () => check.url && openUrl(check.url);
            return (
              <g key={`${check.name}-${index}`} className={`tributaries-stream ${state}${waiting ? " queued" : ""}${was ? " settling" : ""}${checkKey(check) === lit ? " lit" : ""}`}>
                {was && <path className={`tributaries-stream-ghost ${was}`} d={d} pathLength={100} mask={joining} />}
                <path
                  className="tributaries-stream-line"
                  d={d}
                  pathLength={100}
                  mask={joining}
                  // Into the river's colour (unless it runs dry, or carries on in the spotlight).
                  style={joining && state !== "failure" ? { stroke: `url(#tributaries-taking-${index})` } : undefined}
                />
                {state === "failure" && (
                  <>
                    <circle className="tributaries-stream-ripple" cx={dry} cy={y(dry)} r={3.5} />
                    <circle className="tributaries-stream-end" cx={dry} cy={y(dry)} r={3.5} />
                  </>
                )}
                {celebrating && <path className="tributaries-stream-sweep" d={d} pathLength={100} mask={joining} style={{ animationDelay: `${900 + index * 90}ms` }} />}
                <path
                  className="tributaries-stream-hit"
                  data-url={check.url ?? undefined}
                  d={d}
                  role={check.url ? "link" : undefined}
                  tabIndex={check.url ? 0 : -1}
                  aria-label={check.url ? `${title}: open its page` : title}
                  onMouseEnter={() => onLight(checkKey(check))}
                  onMouseLeave={() => onLight(null)}
                  onFocus={() => onLight(checkKey(check))}
                  onBlur={() => onLight(null)}
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
      </div>
      <div className={`tributaries-verdict ${v.tone}`}>
        <span className="tributaries-word">{v.word}</span>
        {line && <span className="tributaries-line">{line}</span>}
      </div>
      {/* Its room is kept, so nothing moves when it shows. */}
      <div className="tributaries-caption-row" aria-hidden>
        {litCheck && hang && (
          <div className={`tributaries-caption ${stateOf(litCheck)}`} style={{ left: hang.x }}>
            <svg className="tributaries-caption-line" width={4} height={hang.length + 2}>
              <line x1={2} y1={1} x2={2} y2={hang.length + 1} />
            </svg>
            <span className="tributaries-caption-name">{litCheck.name}</span>
            <span className="tributaries-caption-state">
              <span className="tributaries-caption-word">{queued(litCheck) ? "queued" : WORDS[stateOf(litCheck)]}</span>
              {checkTime(litCheck, now) ? ` · ${checkTime(litCheck, now)}` : ""}
            </span>
            {litCheck.url && <ExternalLinkIcon size={11} />}
          </div>
        )}
      </div>
    </div>
  );
}
