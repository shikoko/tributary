import { useEffect, useRef, useState } from "react";
import type { RequestCheck } from "../api";
import { checksVerdict, checkTime, describeCheckProgress } from "../lib/pullRequests";

type Props = { checks: RequestCheck[]; now: number; gitlab: boolean; openUrl: (url: string) => void };
type Tone = "success" | "failure" | "pending";

const stateOf = (check: RequestCheck): Tone => check.state ?? "success";
const queued = (check: RequestCheck) => check.state === "pending" && !check.startedAt;
const WORDS = { success: "passed", failure: "failed", pending: "running" };

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
 * light runs along them all and the braid glows once. Hovering a wave names it; clicking
 * opens its page.
 */
export function CheckTributaries({ checks: given, now, gitlab, openUrl }: Props) {
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
  const looks = JSON.stringify(checks.map((check) => [check.name, queued(check) ? "queued" : stateOf(check)]));
  const before = useRef<Map<string, string> | null>(null);
  const toneBefore = useRef<Tone | null>(null);
  const [settling, setSettling] = useState<Map<string, string>>(new Map());
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const current = new Map(JSON.parse(looks) as [string, string][]);
    const changed = new Map<string, string>();
    for (const [name, look] of current) {
      const was = before.current?.get(name);
      if (was && was !== look && (look === "success" || look === "failure")) changed.set(name, was);
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
  const wave = (index: number) => {
    const start = n === 1 ? middle : 12 + (index * (height - 24)) / (n - 1);
    const end = middle + (index - (n - 1) / 2) * 3.4;
    const phase = index * 1.1;
    return (x: number) => {
      const s = smooth(Math.min(1, x / (width * 0.82)));
      return start + (end - start) * s + 7 * (1 - 0.75 * s) * Math.sin((2 * Math.PI * x) / 190 + phase);
    };
  };
  return (
    <div className={`tributaries ${v.tone}${celebrating ? " celebrating" : ""}`}>
      <div className="tributaries-streams" ref={box}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
          {checks.map((check, index) => {
            const y = wave(index);
            let d = "";
            for (let x = 0; x <= width; x += 4) d += `${x === 0 ? "M" : " L"}${x} ${y(x).toFixed(1)}`;
            const state = stateOf(check);
            const waiting = queued(check);
            const dry = width * 0.7;
            const time = checkTime(check, now);
            const title = `${check.name}: ${waiting ? "queued" : WORDS[state]}${time ? ` · ${time}` : ""}`;
            const was = settling.get(check.name);
            return (
              <g key={`${check.name}-${index}`} className={`tributaries-stream ${state}${waiting ? " queued" : ""}${was ? " settling" : ""}`}>
                {was && <path className={`tributaries-stream-ghost ${was}`} d={d} pathLength={100} />}
                <path className="tributaries-stream-line" d={d} pathLength={100} />
                {state === "failure" && (
                  <>
                    <circle className="tributaries-stream-ripple" cx={dry} cy={y(dry)} r={3.5} />
                    <circle className="tributaries-stream-end" cx={dry} cy={y(dry)} r={3.5} />
                  </>
                )}
                {celebrating && <path className="tributaries-stream-sweep" d={d} pathLength={100} style={{ animationDelay: `${900 + index * 90}ms` }} />}
                <path className="tributaries-stream-hit" d={d} onClick={() => check.url && openUrl(check.url)}>
                  <title>{title}</title>
                </path>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={`tributaries-verdict ${v.tone}`}>
        <span className="tributaries-word">{v.word}</span>
        {line && <span className="tributaries-line">{line}</span>}
      </div>
    </div>
  );
}
