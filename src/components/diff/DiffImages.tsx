import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FileDiff, Media } from "../../api";
import { missingSide } from "../../lib/media";
import { comparePixels, describePixelChanges, type PixelChanges } from "../../lib/pixels";
import { useStoredState } from "../../lib/settings";

type Mode = "side" | "swipe" | "onion" | "pixels";
type Side = "before" | "after";
interface Size {
  width: number;
  height: number;
}

const MODES: { mode: Mode; label: string; title: string }[] = [
  { mode: "side", label: "Side by side", title: "Before and after next to each other" },
  { mode: "swipe", label: "Swipe", title: "One over the other: drag across the picture to wipe from before to after" },
  { mode: "onion", label: "Onion skin", title: "After laid over before, see-through: slide to fade from one to the other" },
  { mode: "pixels", label: "Changed pixels", title: "The pixels that changed, highlighted over a greyed-out picture" },
];

/** Changed pixels are painted in this (a vivid pink that stands out on grey). */
const HIGHLIGHT: [number, number, number] = [255, 43, 140];

/**
 * A picture before and after: side by side, one wiping over the other, faded over each
 * other (onion skin), or with the pixels that changed highlighted.
 */
export function DiffImages({ diff, media }: { diff: FileDiff; media: Media }) {
  const [stored, setMode] = useStoredState<Mode>("diff.imageMode", "side");
  const both = Boolean(media.before && media.after);
  const mode = both ? stored : "side";
  // How big the pictures shown are (previews of textures can be smaller than the files).
  const [shown, setShown] = useState<Partial<Record<Side, Size>>>({});
  useEffect(() => setShown({}), [media.before, media.after]);
  const loaded = (side: Side) => (event: { currentTarget: HTMLImageElement }) => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    setShown((current) => (current[side]?.width === width && current[side]?.height === height ? current : { ...current, [side]: { width, height } }));
  };

  /** "2048 × 2048", and whether it's shown smaller. */
  const facts = (side: Side): string | null => {
    const file = side === "before" ? media.beforeDimensions : media.afterDimensions;
    const picture = shown[side];
    const [width, height] = file ?? (picture ? [picture.width, picture.height] : []);
    if (!width || !height) return null;
    const smaller = file && picture && picture.width < file[0] ? ", shown smaller" : "";
    return `${width} × ${height}${smaller}`;
  };
  const missing = (side: Side) => (side === "before" ? media.beforeNote : media.afterNote) ?? missingSide(diff, side);

  return (
    <div className="diff-images-frame">
      {both && (
        <div className="diff-switch diff-image-modes" role="group" aria-label="Compare the pictures">
          {MODES.map(({ mode: each, label, title }) => (
            <button key={each} className={mode === each ? "selected" : undefined} aria-pressed={mode === each} onClick={() => setMode(each)} title={title}>
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "side" ? (
        <div className="diff-media diff-images">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="diff-media-side diff-image">
              <figcaption>
                {side === "before" ? "Before" : "After"}
                {facts(side) && <span className="diff-media-facts">{facts(side)}</span>}
              </figcaption>
              <div className="diff-image-frame">
                {media[side] ? <img src={media[side]!} alt={`${diff.path}, ${side}`} onLoad={loaded(side)} /> : <span className="diff-image-missing">{missing(side)}</span>}
              </div>
            </figure>
          ))}
        </div>
      ) : (
        <>
          <div className="diff-image-sizes">
            <span>Before {facts("before") && <span className="diff-media-facts">{facts("before")}</span>}</span>
            <span>After {facts("after") && <span className="diff-media-facts">{facts("after")}</span>}</span>
          </div>
          {mode === "pixels" ? (
            <ChangedPixels before={media.before!} after={media.after!} path={diff.path} />
          ) : (
            <Overlay mode={mode} before={media.before!} after={media.after!} path={diff.path} onLoad={loaded} size={shown.after ?? shown.before} />
          )}
        </>
      )}
    </div>
  );
}

/** After over before: wiped across with a handle (swipe) or faded (onion skin). */
function Overlay({
  mode,
  before,
  after,
  path,
  onLoad,
  size,
}: {
  mode: "swipe" | "onion";
  before: string;
  after: string;
  path: string;
  onLoad: (side: Side) => (event: { currentTarget: HTMLImageElement }) => void;
  size: Size | undefined;
}) {
  const [swipe, setSwipe] = useState(50);
  const [fade, setFade] = useState(50);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const follow = (event: ReactPointerEvent) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSwipe(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
  };
  const ratio = size ? size.width / size.height : 1;
  return (
    <div className="diff-overlay">
      <div className="diff-image-frame diff-overlay-frame">
        <div
          ref={stage}
          className={`diff-overlay-stage ${mode}`}
          style={{ aspectRatio: size ? `${size.width} / ${size.height}` : undefined, width: `min(100%, calc(60vh * ${ratio}))` }}
          onPointerDown={(event) => {
            if (mode !== "swipe") return;
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            follow(event);
          }}
          onPointerMove={(event) => dragging.current && follow(event)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <img src={before} alt={`${path}, before`} onLoad={onLoad("before")} draggable={false} />
          <img
            src={after}
            alt={`${path}, after`}
            onLoad={onLoad("after")}
            draggable={false}
            style={mode === "swipe" ? { clipPath: `inset(0 0 0 ${swipe}%)` } : { opacity: fade / 100 }}
          />
          {mode === "swipe" && (
            <div className="diff-swipe-handle" style={{ left: `${swipe}%` }} aria-hidden>
              <span />
            </div>
          )}
        </div>
      </div>
      <label className="diff-overlay-slider">
        <span>Before</span>
        <input
          type="range"
          min={0}
          max={100}
          value={mode === "swipe" ? 100 - swipe : fade}
          onChange={(event) => (mode === "swipe" ? setSwipe(100 - Number(event.target.value)) : setFade(Number(event.target.value)))}
          aria-label={mode === "swipe" ? "How much of the after picture shows" : "How strongly the after picture shows"}
        />
        <span>After</span>
      </label>
    </div>
  );
}

/** Loads a picture from a data: URL. */
function loadPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error("Couldn't load the picture"));
    picture.src = url;
  });
}

/** The after picture greyed out, with the pixels that changed since before highlighted. */
function ChangedPixels({ before, after, path }: { before: string; after: string; path: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<{ changes: PixelChanges; size: Size; scaled: boolean } | { error: string } | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    Promise.all([loadPicture(before), loadPicture(after)])
      .then(([first, second]) => {
        const target = canvas.current;
        if (!current || !target) return;
        // Pictures of different sizes are compared at the after picture's size.
        const width = second.naturalWidth;
        const height = second.naturalHeight;
        const differentSize = first.naturalWidth !== width || first.naturalHeight !== height;
        const read = (picture: HTMLImageElement) => {
          const scratch = document.createElement("canvas");
          scratch.width = width;
          scratch.height = height;
          const context = scratch.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Couldn't compare the pictures");
          context.drawImage(picture, 0, 0, width, height);
          return context.getImageData(0, 0, width, height).data;
        };
        target.width = width;
        target.height = height;
        const context = target.getContext("2d");
        if (!context) throw new Error("Couldn't compare the pictures");
        const out = context.createImageData(width, height);
        const changes = comparePixels(read(first), read(second), width, height, out.data, HIGHLIGHT);
        context.putImageData(out, 0, 0);
        setResult({ changes, size: { width, height }, scaled: differentSize });
      })
      .catch((error: unknown) => current && setResult({ error: error instanceof Error ? error.message : String(error) }));
    return () => {
      current = false;
    };
  }, [before, after]);
  return (
    <div className="diff-overlay">
      <div className="diff-image-frame diff-overlay-frame">
        <canvas
          ref={canvas}
          className="diff-pixels"
          // As big as the other views: small textures are scaled up, pixel by pixel.
          style={result && "size" in result ? { width: `min(100%, calc(60vh * ${result.size.width / result.size.height}))` } : undefined}
          aria-label={`${path}: the pixels that changed`}
        />
      </div>
      <p className="diff-pixels-summary">
        {!result
          ? "Comparing…"
          : "error" in result
            ? result.error
            : `${describePixelChanges(result.changes)}${result.scaled ? ` The sizes differ: compared at ${result.size.width} × ${result.size.height}.` : ""}`}
      </p>
    </div>
  );
}
