import { useEffect, useRef, useState } from "react";
import type { FileDiff, Media } from "../../api";
import { dataUrlBytes, formatDuration, missingSide } from "../../lib/media";

interface Decoded {
  peaks: Float32Array;
  duration: number;
  channels: number;
}

/** The loudest sample in each of `count` slices, for drawing a waveform. */
async function decode(url: string, count: number): Promise<Decoded | null> {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(dataUrlBytes(url));
    const data = buffer.getChannelData(0);
    const peaks = new Float32Array(count);
    const step = Math.max(1, Math.floor(data.length / count));
    for (let i = 0; i < count; i++) {
      let peak = 0;
      for (let j = i * step, end = Math.min(data.length, j + step); j < end; j++) peak = Math.max(peak, Math.abs(data[j]));
      peaks[i] = peak;
    }
    // (Its sample rate isn't the file's: decoding converts it to the computer's own.)
    return { peaks, duration: buffer.duration, channels: buffer.numberOfChannels };
  } catch {
    return null;
  } finally {
    context.close().catch(() => {});
  }
}

const SLICES = 600;

/** Both versions of a sound: a player and a waveform each, on the same time scale. */
export function DiffAudio({ diff, media }: { diff: FileDiff; media: Media }) {
  const [decoded, setDecoded] = useState<{ before: Decoded | null; after: Decoded | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([media.before ? decode(media.before, SLICES) : null, media.after ? decode(media.after, SLICES) : null]).then(
      ([before, after]) => live && setDecoded({ before, after }),
    );
    return () => {
      live = false;
    };
  }, [media.before, media.after]);
  // The longer one fills the width, so a shorter take looks shorter.
  const longest = Math.max(decoded?.before?.duration ?? 0, decoded?.after?.duration ?? 0);

  return (
    <div className="diff-media diff-audio">
      {(["before", "after"] as const).map((side) => {
        const url = media[side];
        const info = decoded?.[side] ?? null;
        return (
          <figure key={side} className="diff-media-side">
            <figcaption>
              {side === "before" ? "Before" : "After"}
              {info && (
                <span className="diff-media-facts">
                  {formatDuration(info.duration)} · {info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} channels`}
                </span>
              )}
            </figcaption>
            {url ? <Sound url={url} info={info} longest={longest} /> : <div className="diff-media-missing">{missingSide(diff, side)}</div>}
          </figure>
        );
      })}
    </div>
  );
}

function Sound({ url, info, longest }: { url: string; info: Decoded | null; longest: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !info) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const share = longest > 0 ? info.duration / longest : 1;
    const drawn = Math.max(1, Math.round(width * share));
    const middle = height / 2;
    const played = longest > 0 ? (position / longest) * width : 0;
    for (let x = 0; x < drawn; x++) {
      const peak = info.peaks[Math.min(info.peaks.length - 1, Math.floor((x / drawn) * info.peaks.length))];
      const half = Math.max(0.5, peak * (middle - 2));
      context.fillStyle = x < played ? "#1fb5ff" : "#596071";
      context.fillRect(x, middle - half, 1, half * 2);
    }
  }, [info, longest, position]);

  return (
    <div className="diff-sound">
      <canvas
        ref={canvas}
        className="diff-waveform"
        aria-hidden
        onClick={(event) => {
          // Click the waveform to play from there.
          const player = audio.current;
          if (!player || !longest) return;
          const rect = event.currentTarget.getBoundingClientRect();
          player.currentTime = Math.min(player.duration || longest, ((event.clientX - rect.left) / rect.width) * longest);
          player.play().catch(() => {});
        }}
      />
      <audio ref={audio} controls src={url} preload="metadata" onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} />
    </div>
  );
}
