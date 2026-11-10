import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useThemeColors } from "../app/useAppearance";
import { withAlpha } from "../lib/colors";
import { readSetting } from "../lib/settings";
import { shownStops, type Tour, type TourId } from "../lib/tours";
import { DownloadIcon, RevertIcon, SparkleIcon, TeamIcon, ViewIcon } from "./Icons";

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

/** Which look, while one is being chosen. */
function readLook(): "spotlight" | "glow" | "card" {
  const look = readSetting<string>("tours.look", "spotlight");
  return look === "glow" || look === "card" ? look : "spotlight";
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
  const look = readLook();
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
  }, [box, at, look]);

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
  const hole = box ? { left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const arrow = box && spot && (spot.side === "right" || spot.side === "left") ? Math.max(18, Math.min(box.top + box.height / 2 - spot.top, (card.current?.offsetHeight ?? 200) - 18)) : null;

  return (
    <div className={`tour tour-look-${look}`} style={style} role="dialog" aria-modal="true" aria-label={`${tour.title}: ${stop.title}`}>
      {hole ? <div className="tour-hole" style={hole} /> : <div className="tour-backdrop" />}
      <div
        ref={card}
        className="tour-card"
        data-side={spot?.side ?? "none"}
        style={{ left: spot?.left ?? -9999, top: spot?.top ?? -9999, ...(arrow !== null ? { "--arrow": `${arrow}px` } : {}) } as CSSProperties}
        key={at}
      >
        {look === "card" ? (
          <div className="tour-card-head">
            <span className="tour-tile">{TOUR_LOOKS[tour.id].icon(18)}</span>
            <span className="tour-card-head-text">
              <span className="tour-eyebrow">{tour.title}</span>
              <span className="tour-step-count">
                {at + 1} of {stops.length}
              </span>
            </span>
          </div>
        ) : (
          <>
            {look === "glow" && (
              <div className="tour-progress">
                <span style={{ width: `${((at + 1) / stops.length) * 100}%` }} />
              </div>
            )}
            <span className="tour-eyebrow">
              {TOUR_LOOKS[tour.id].icon(12)}
              {tour.title} · {at + 1} of {stops.length}
            </span>
          </>
        )}
        <h3>{stop.title}</h3>
        <p>{stop.text}</p>
        <div className="tour-buttons">
          {look === "spotlight" && (
            <span className="tour-dots" aria-hidden="true">
              {stops.map((each, index) => (
                <span key={each.title + index} className={index === at ? "on" : index < at ? "past" : undefined} />
              ))}
            </span>
          )}
          <button className="link-button tour-skip" onClick={onClose}>
            {last ? "Close" : "Skip tour"}
          </button>
          <span className="spacer" />
          {at > 0 && (
            <button className="secondary-button" onClick={() => setAt(at - 1)}>
              Back
            </button>
          )}
          <button className="primary-small-button" onClick={() => (last ? onClose() : setAt(at + 1))} autoFocus>
            {last ? "Done" : "Next"}
          </button>
        </div>
        <button className="link-button tour-never" onClick={onNever}>
          Don't show tours again
        </button>
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
          <button className="primary-small-button" onClick={onStart}>
            Show me
          </button>
          <button className="secondary-button" onClick={onLater}>
            Not now
          </button>
          <button className="link-button" onClick={onNever}>
            Don't show tours again
          </button>
        </div>
      </div>
    </div>
  );
}
