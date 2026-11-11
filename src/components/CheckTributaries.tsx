import { useEffect, useRef, useState } from "react";
import type { RequestCheck } from "../api";
import { checksVerdict, checkTime, describeCheckProgress } from "../lib/pullRequests";
import { ExternalLinkIcon } from "./Icons";

type Props = {
  checks: RequestCheck[];
  now: number;
  gitlab: boolean;
  openUrl: (url: string) => void;
  /** The check in the spotlight (its wave here, its row in the timeline), and a way to change it. */
  lit: string | null;
  onLight: (name: string | null) => void;
};
type Tone = "success" | "failure" | "pending" | "cancelled";

const stateOf = (check: RequestCheck): Tone => check.state ?? "success";
const queued = (check: RequestCheck) => check.state === "pending" && !check.startedAt;
const WORDS = { success: "passed", failure: "failed", pending: "running", cancelled: "cancelled" };

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
  const looks = JSON.stringify(checks.map((check) => [check.name, queued(check) ? "queued" : stateOf(check)]));
  const before = useRef<Map<string, string> | null>(null);
  const toneBefore = useRef<Tone | null>(null);
  const [settling, setSettling] = useState<Map<string, string>>(new Map());
  const [celebrating, setCelebrating] = useState(false);
  // Where along the lit wave the label sits: under the pointer, or a third of the way along.
  const [labelAt, setLabelAt] = useState<number | null>(null);
  useEffect(() => {
    const current = new Map(JSON.parse(looks) as [string, string][]);
    const changed = new Map<string, string>();
    for (const [name, look] of current) {
      const was = before.current?.get(name);
      if (was && was !== look && (look === "success" || look === "failure" || look === "cancelled")) changed.set(name, was);
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
  const litIndex = lit === null ? -1 : checks.findIndex((check) => check.name === lit);
  const litCheck = litIndex >= 0 ? checks[litIndex] : null;
  const labelX = Math.min(width - 90, Math.max(90, labelAt ?? width * 0.3));
  const across = (event: { clientX: number }) => event.clientX - (box.current?.getBoundingClientRect().left ?? 0);
  const light = (name: string | null, x: number | null = null) => {
    onLight(name);
    setLabelAt(x);
  };
  return (
    <div className={`tributaries ${v.tone}${celebrating ? " celebrating" : ""}${litCheck ? " lit" : ""}`}>
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
            const open = () => check.url && openUrl(check.url);
            return (
              <g key={`${check.name}-${index}`} className={`tributaries-stream ${state}${waiting ? " queued" : ""}${was ? " settling" : ""}${check.name === lit ? " lit" : ""}`}>
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
                  onMouseEnter={(event) => light(check.name, across(event))}
                  onMouseMove={(event) => setLabelAt(across(event))}
                  onMouseLeave={() => light(null)}
                  onFocus={() => light(check.name)}
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
