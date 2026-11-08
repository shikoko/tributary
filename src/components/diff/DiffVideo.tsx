import { useRef, useState } from "react";
import type { FileDiff, Media } from "../../api";
import { formatDuration, missingSide } from "../../lib/media";

/** Both versions of a video side by side, with a button to play them together. */
export function DiffVideo({ diff, media }: { diff: FileDiff; media: Media }) {
  const players = { before: useRef<HTMLVideoElement>(null), after: useRef<HTMLVideoElement>(null) };
  const [facts, setFacts] = useState<Record<"before" | "after", string>>({ before: "", after: "" });
  const both = Boolean(media.before && media.after);

  const playBoth = () => {
    const videos = [players.before.current, players.after.current].filter((video): video is HTMLVideoElement => Boolean(video));
    const playing = videos.some((video) => !video.paused);
    for (const video of videos) {
      if (playing) video.pause();
      else {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    }
  };

  return (
    <div className="diff-media diff-video">
      {(["before", "after"] as const).map((side) => (
        <figure key={side} className="diff-media-side">
          <figcaption>
            {side === "before" ? "Before" : "After"}
            {facts[side] && <span className="diff-media-facts">{facts[side]}</span>}
          </figcaption>
          {media[side] ? (
            <video
              ref={players[side]}
              src={media[side]!}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setFacts((current) => ({ ...current, [side]: `${formatDuration(video.duration)} · ${video.videoWidth}×${video.videoHeight}` }));
              }}
            />
          ) : (
            <div className="diff-media-missing">{missingSide(diff, side)}</div>
          )}
        </figure>
      ))}
      {both && (
        <div className="diff-media-actions">
          <button className="outline-button" onClick={playBoth}>
            <span className="button-label">Play both</span>
          </button>
        </div>
      )}
    </div>
  );
}
