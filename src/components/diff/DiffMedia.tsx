import { lazy, Suspense } from "react";
import type { FileDiff, Media } from "../../api";
import { describeSizes } from "../../lib/media";
import { DiffAudio } from "./DiffAudio";
import { DiffImages } from "./DiffImages";
import { DiffVideo } from "./DiffVideo";
import { Loader } from "../Loader";

/** The 3D viewer brings three.js with it: it's loaded only when a model is shown. */
const ModelViewer = lazy(() => import("./ModelViewer"));

/** A picture, sound, video or 3D model, before and after, shown as what it is. */
export function DiffMedia({ diff, media }: { diff: FileDiff; media: Media }) {
  return (
    <div className="diff-media-frame">
      {media.kind === "image" ? (
        <DiffImages diff={diff} media={media} />
      ) : media.kind === "audio" ? (
        <DiffAudio diff={diff} media={media} />
      ) : media.kind === "video" ? (
        <DiffVideo diff={diff} media={media} />
      ) : (
        <Suspense fallback={<Loader size={88} title="Loading the 3D viewer" />}>
          <ModelViewer diff={diff} media={media} />
        </Suspense>
      )}
      <p className="diff-binary-sizes">{describeSizes(diff)}</p>
    </div>
  );
}
