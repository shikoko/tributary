import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useThemeColors } from "../app/useAppearance";
import { withAlpha } from "../lib/colors";
import { shownStops, type Tour, type TourId } from "../lib/tours";
import { DownloadIcon, RevertIcon, SparkleIcon, TeamIcon, ViewIcon } from "./Icons";
import { Button } from "./ui/Button";

/** Each tour's picture, and its graph colour (by place in the palette). */
export const TOUR_LOOKS: Record<TourId, { icon: (size: number) => ReactNode; lane: number }> = {
  start: { icon: (size) => <SparkleIcon size={size} />, lane: 0 },
  team: { icon: (size) => <TeamIcon size={size} />, lane: 1 },
  lfs: { icon: (size) => <DownloadIcon size={size} />, lane: 2 },
  safety: { icon: (size) => <RevertIcon size={size} />, lane: 3 },
  simple: { icon: (size) => <ViewIcon size={size} />, lane: 4 },
};

/** The parts of the window with this `data-tour` name, as one box (null when none is shown). */
function boxOf(name: string | null): DOMRect | null {
  if (!name) return null;
  const rects = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

const PAD = 6;
/** The highlight's corner radius, and how long it takes to move to the next stop. */
const RADIUS = 10;
const MOVE_MS = 280;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * `rect`, easing to each new place over MOVE_MS (or at once, with reduced motion), so the
 * dimming and the highlight move together.
 */
function useEasedRect(rect: Rect | null): Rect | null {
  const [shown, setShown] = useState<Rect | null>(rect);
  const from = useRef<Rect | null>(rect);
  const [left, top, width, height] = rect ? [rect.left, rect.top, rect.width, rect.height] : [NaN, NaN, NaN, NaN];
  useEffect(() => {
    const to = Number.isNaN(left) ? null : { left, top, width, height };
    const start = from.current;
    if (!to || !start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = to;
      setShown(to);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / MOVE_MS);
      const k = 1 - (1 - t) ** 3;
      const mix = (a: number, b: number) => a + (b - a) * k;
      const next = { left: mix(start.left, to.left), top: mix(start.top, to.top), width: mix(start.width, to.width), height: mix(start.height, to.height) };
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [left, top, width, height]);
  return shown;
}

/**
 * The window dimmed but for `hole`: a shape the size of the window with the hole cut out.
 * (A huge box-shadow around the hole looks the same, but WebKit on macOS paints all of it,
 * tens of thousands of pixels across, and gives up, leaving the window dark.)
 */
function Dimming({ hole }: { hole: Rect | null }) {
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  let d = `M0 0H${view.width}V${view.height}H0Z`;
  if (hole) {
    const { left: x, top: y, width: w, height: h } = hole;
    const r = Math.min(RADIUS, w / 2, h / 2);
    d += `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }
  return (
    <svg className="tour-dim" width={view.width} height={view.height} aria-hidden="true">
      <path d={d} fillRule="evenodd" />
    </svg>
  );
}
const GAP = 16;

/** Where the card goes: beside the box if there's room, else below or above; in the middle without one. */
function place(box: DOMRect | null, card: { width: number; height: number }): { left: number; top: number; side: string } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!box) return { left: (width - card.width) / 2, top: (height - card.height) / 2, side: "none" };
  const clampTop = (top: number) => Math.max(12, Math.min(height - card.height - 12, top));
  const clampLeft = (left: number) => Math.max(12, Math.min(width - card.width - 12, left));
  const middle = box.top + box.height / 2 - card.height / 2;
  if (box.right + PAD + GAP + card.width < width - 12) return { left: box.right + PAD + GAP, top: clampTop(middle), side: "right" };
  if (box.left - PAD - GAP - card.width > 12) return { left: box.left - PAD - GAP - card.width, top: clampTop(middle), side: "left" };
  const center = clampLeft(box.left + box.width / 2 - card.width / 2);
  if (box.bottom + PAD + GAP + card.height < height - 12) return { left: center, top: box.bottom + PAD + GAP, side: "below" };
  if (box.top - PAD - GAP - card.height > 12) return { left: center, top: box.top - PAD - GAP - card.height, side: "above" };
  // Too big to go beside: over its lower part.
  return { left: center, top: clampTop(box.bottom - card.height - 24), side: "inside" };
}

interface Props {
  tour: Tour;
  /** Ended: finished (or skipped). */
  onClose: () => void;
  /** Don't offer tours again. */
  onNever: () => void;
}

/**
 * A guided tour: the window dimmed but for the part being explained, with a card beside it.
 * Back and Next (or the arrow keys) step through; Esc or Skip ends it.
 */
export function TourOverlay({ tour, onClose, onNever }: Props) {
  const { lanes } = useThemeColors();
  const color = lanes[TOUR_LOOKS[tour.id].lane % lanes.length];
  const next = lanes[(TOUR_LOOKS[tour.id].lane + 1) % lanes.length];
  // Which stops: decided once, when it starts (what's on screen then).
  const stops = useMemo(() => shownStops(tour, (target) => boxOf(target) !== null), [tour]);
  const [at, setAt] = useState(0);
  const stop = stops[Math.min(at, stops.length - 1)];
  const last = at >= stops.length - 1;
  const [box, setBox] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ left: number; top: number; side: string } | null>(null);

  // Follow what it points at: it can move (a panel opening, the window resizing).
  useEffect(() => {
    const measure = () => {
      const found = boxOf(stop.target);
      setBox((before) =>
        before && found && before.x === found.x && before.y === found.y && before.width === found.width && before.height === found.height ? before : found,
      );
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [stop]);
  useLayoutEffect(() => {
    if (!card.current) return;
    setSpot(place(box, { width: card.current.offsetWidth, height: card.current.offsetHeight }));
  }, [box, at]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" || event.key === "Enter") {
        if (last) onClose();
        else setAt((now) => now + 1);
      }
      else if (event.key === "ArrowLeft") setAt((now) => Math.max(0, now - 1));
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last, onClose]);

  const style = {
    "--tour-color": color,
    "--tour-next": next,
    "--tour-soft": withAlpha(color, 0.18),
    "--tour-glow": withAlpha(color, 0.45),
  } as CSSProperties;
  const hole = useEasedRect(box ? { left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null);
  const arrow = box && spot && (spot.side === "right" || spot.side === "left") ? Math.max(18, Math.min(box.top + box.height / 2 - spot.top, (card.current?.offsetHeight ?? 200) - 18)) : null;

  return (
    <div className="tour" style={style} role="dialog" aria-modal="true" aria-label={`${tour.title}: ${stop.title}`}>
      <Dimming hole={hole} />
      {hole && <div className="tour-hole" style={hole} />}
      <div
        ref={card}
        className="tour-card"
        data-side={spot?.side ?? "none"}
        style={{ left: spot?.left ?? -9999, top: spot?.top ?? -9999, ...(arrow !== null ? { "--arrow": `${arrow}px` } : {}) } as CSSProperties}
        key={at}
      >
        <div className="tour-progress">
          <span style={{ width: `${((at + 1) / stops.length) * 100}%` }} />
        </div>
        <span className="tour-eyebrow">
          {TOUR_LOOKS[tour.id].icon(12)}
          {tour.title} · {at + 1} of {stops.length}
        </span>
        <h3>{stop.title}</h3>
        <p>{stop.text}</p>
        <div className="tour-buttons">
          <Button kind="link" className="tour-skip" onClick={onClose}>
            {last ? "Close" : "Skip tour"}
          </Button>
          <span className="spacer" />
          {at > 0 && (
            <Button kind="secondary" onClick={() => setAt(at - 1)}>
              Back
            </Button>
          )}
          <Button kind="primary" onClick={() => (last ? onClose() : setAt(at + 1))} autoFocus>
            {last ? "Done" : "Next"}
          </Button>
        </div>
        <Button kind="link" className="tour-never" onClick={onNever}>
          Don't show tours again
        </Button>
      </div>
    </div>
  );
}

/** A small offer in the corner: a tour of what you've just come across, once. */
export function TourOffer({ tour, onStart, onLater, onNever }: { tour: Tour; onStart: () => void; onLater: () => void; onNever: () => void }) {
  const { lanes } = useThemeColors();
  const color = lanes[TOUR_LOOKS[tour.id].lane % lanes.length];
  // It goes by itself after a while.
  useEffect(() => {
    const timer = window.setTimeout(onLater, 30_000);
    return () => window.clearTimeout(timer);
  }, [onLater]);
  const minutes = Math.max(1, Math.round(tour.stops.length * 0.2));
  return (
    <div className="tour-offer" role="status" style={{ "--tour-color": color, "--tour-soft": withAlpha(color, 0.18) } as CSSProperties}>
      <span className="tour-offer-tile">{TOUR_LOOKS[tour.id].icon(16)}</span>
      <div className="tour-offer-text">
        <strong>{tour.id === "start" ? "New here? A quick tour" : `${tour.title}: a quick tour`}</strong>
        <span>
          {tour.summary}, in {tour.stops.length} stops (about {minutes} minute{minutes === 1 ? "" : "s"}).
        </span>
        <div className="tour-offer-buttons">
          <Button kind="primary" onClick={onStart}>
            Show me
          </Button>
          <Button kind="secondary" onClick={onLater}>
            Not now
          </Button>
          <Button kind="link" onClick={onNever}>
            Don't show tours again
          </Button>
        </div>
      </div>
    </div>
  );
}
