import { lazy, Suspense } from "react";
import type { FileDiff, Media } from "../../api";
import { describeSizes, missingSide } from "../../lib/media";
import { DiffAudio } from "./DiffAudio";
import { DiffVideo } from "./DiffVideo";

/** The 3D viewer brings three.js with it: it's loaded only when a model is shown. */
const ModelViewer = lazy(() => import("./ModelViewer"));

/** A picture, sound, video or 3D model, before and after, shown as what it is. */
export function DiffMedia({ diff, media }: { diff: FileDiff; media: Media }) {
  return (
    <div className="diff-media-frame">
      {media.kind === "image" ? (
        <div className="diff-media diff-images">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="diff-media-side diff-image">
              <figcaption>{side === "before" ? "Before" : "After"}</figcaption>
              <div className="diff-image-frame">
                {media[side] ? <img src={media[side]!} alt={`${diff.path}, ${side}`} /> : <span className="diff-image-missing">{missingSide(diff, side)}</span>}
              </div>
            </figure>
          ))}
        </div>
      ) : media.kind === "audio" ? (
        <DiffAudio diff={diff} media={media} />
      ) : media.kind === "video" ? (
        <DiffVideo diff={diff} media={media} />
      ) : (
        <Suspense fallback={<div className="diff-message muted">Loading the 3D viewer…</div>}>
          <ModelViewer diff={diff} media={media} />
        </Suspense>
      )}
      <p className="diff-binary-sizes">{describeSizes(diff)}</p>
    </div>
  );
}
