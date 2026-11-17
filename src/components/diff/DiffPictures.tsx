import { useMemo, useState } from "react";
import type { Media } from "../../api";
import { pictureFormat, type EmbeddedPicture, type PictureChange } from "../../lib/embeddedPictures";
import { formatBytes } from "../../lib/format";
import { DiffImages } from "./DiffImages";

/** The picture change as media, for the picture comparison (side by side, swipe…). */
function pictureMedia(change: PictureChange): Media {
  const type = (change.after ?? change.before)!.type;
  return {
    kind: "image",
    format: type === "image/svg+xml" ? "svg" : type.replace(/^image\//, ""),
    before: change.before?.url ?? null,
    after: change.after?.url ?? null,
    beforeDimensions: null,
    afterDimensions: null,
    beforeNote: null,
    afterNote: null,
  };
}

/** "PNG, line 3": what the picture is and where (where it was, for one taken out). */
export function describePicture(change: PictureChange): string {
  const picture = (change.after ?? change.before)!;
  const where = change.after ? `line ${change.after.line}` : `was line ${change.before!.line}`;
  return `${pictureFormat(picture.type)}, ${where}`;
}

/** "412 bytes → 431 bytes", "Added, 431 bytes" or "Taken out (it was 412 bytes)". */
export function describePictureSizes(change: PictureChange): string {
  const { before, after } = change;
  if (!before && after) return `Added, ${formatBytes(after.bytes)}`;
  if (before && !after) return `Taken out (it was ${formatBytes(before.bytes)})`;
  return before!.bytes === after!.bytes ? `${formatBytes(after!.bytes)}, the same size` : `${formatBytes(before!.bytes)} → ${formatBytes(after!.bytes)}`;
}

/** One side's picture, small, on the checkerboard (or a dash where there's none). */
function Thumb({ picture, side }: { picture: EmbeddedPicture | null; side: "before" | "after" }) {
  const name = side === "before" ? "Before" : "After";
  return (
    <span className={`diff-picture-thumb${picture ? "" : " missing"}`} title={picture ? name : `${name}: none`}>
      {picture ? <img src={picture.url} alt={name} draggable={false} /> : <span aria-label={`${name}: none`}>—</span>}
    </span>
  );
}

/** Before → after, small. */
export function PictureThumbs({ change }: { change: PictureChange }) {
  return (
    <span className="diff-picture-thumbs">
      <Thumb picture={change.before} side="before" />
      <span className="diff-picture-arrow" aria-hidden>
        →
      </span>
      <Thumb picture={change.after} side="after" />
    </span>
  );
}

/** The full comparison of a picture change (side by side, swipe, onion skin, changed pixels). */
export function PictureComparison({ change, path }: { change: PictureChange; path: string }) {
  const media = useMemo(() => pictureMedia(change), [change]);
  return (
    <div className="diff-picture-compare">
      <DiffImages diff={{ path: `${path}, ${describePicture(change)}`, sizeBefore: null, sizeAfter: null }} media={media} />
      <p className="diff-binary-sizes">{describePictureSizes(change)}</p>
    </div>
  );
}

/**
 * A picture written into the text that changed, under the lines it changed in: before →
 * after, small, opening to compare them in full.
 */
export function InlinePicture({ change, path, split = false }: { change: PictureChange; path: string; split?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`diff-picture-inline${split ? " split" : ""}`} role="row">
      <div className="diff-picture-inline-bar" role="cell">
        <PictureThumbs change={change} />
        <span className="diff-picture-card-text">
          <span className="diff-picture-card-name">{describePicture(change)}</span>
          <span className="diff-picture-card-sizes">{describePictureSizes(change)}</span>
        </span>
        <button className="hunk-button" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? "Close the comparison" : "Compare them side by side, wiped, faded, or pixel by pixel"}>
          <span className="button-label">{open ? "Close" : "Compare"}</span>
        </button>
      </div>
      {open && <PictureComparison change={change} path={path} />}
    </div>
  );
}
