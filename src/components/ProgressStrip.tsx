import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Progress } from "../api";
import { formatBytes } from "../lib/format";
import { smoothPath } from "../lib/team";
import { Button } from "./ui/Button";

interface Props {
  /** Like "Pulling". */
  label: string;
  progress: Progress | null;
  /** Without it, there's no Cancel (a checkout can't stop halfway). */
  onCancel?: () => void;
}

/** "Uploading LFS files 44%", and what's known about it, like "1 of 3 files · 44 MB of 98 MB". */
export function ProgressText({ label, progress }: { label: string; progress: Progress | null }) {
  const percent = progress?.percent ?? null;
  return (
    <span className="progress-text" title={progress?.detail}>
      {label}…
      {progress && progress.phase !== "Connecting" && (
        <span className="muted">
          {" "}
          {progress.phase}
          {percent !== null ? ` ${percent}%` : ""}
        </span>
      )}
      {progress?.detail && <span className="progress-detail"> · {progress.detail}</span>}
    </span>
  );
}

/**
 * The bar: how far it is. When there are files to count (Git LFS getting them), a second,
 * thinner bar under it counts them, so a pull through thousands of small files shows how
 * many are left, not just that the one being downloaded is done.
 */
export function ProgressBars({ progress }: { progress: Progress | null }) {
  const percent = progress?.percent ?? null;
  const files = progress?.files && progress.files.total > 1 ? progress.files : null;
  return (
    <div className={`progress-bars${files ? " with-files" : ""}`}>
      <div className="progress-track" title={files && percent !== null ? `${progress?.phase} ${percent}%` : undefined}>
        <div
          className={`progress-fill${percent === null ? " indeterminate" : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {files && (
        <div
          className="progress-track progress-files"
          role="progressbar"
          aria-label="Files"
          aria-valuenow={files.done}
          aria-valuemin={0}
          aria-valuemax={files.total}
          title={`${files.done.toLocaleString()} of ${files.total.toLocaleString()} files, ${(files.total - files.done).toLocaleString()} to go`}
        >
          <div className="progress-fill progress-files-fill" style={{ width: `${Math.min(100, (files.done / files.total) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** What a Git LFS transfer has done lately: its speed over time, and the files it finished. */
interface History {
  rates: number[];
  recent: string[];
}

/** How many speeds the graph shows (a few a second: the last half minute or so). */
const RATES_KEPT = 90;

/** Hovering the bar: the download's speed over time, what it's on, and what's still to come. */
function TransferPanel({ progress, history, anchor }: { progress: Progress; history: History; anchor: DOMRect }) {
  const { rates, recent } = history;
  const top = Math.max(1, ...rates);
  const width = 300;
  const height = 54;
  const points: [number, number][] = rates.map((rate, index) => [(index / Math.max(1, rates.length - 1)) * width, height - 3 - (rate / top) * (height - 8)]);
  const line = smoothPath(points);
  const left = Math.min(Math.max(12, anchor.right - 340), window.innerWidth - 352);
  return createPortal(
    <div className="transfer-panel" style={{ top: anchor.bottom + 6, left }} role="tooltip">
      {rates.length > 1 && (
        <div className="transfer-speed">
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
            <defs>
              <linearGradient id="transfer-wash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.4 }} />
                <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path d={`${line} L${width},${height} L0,${height} Z`} fill="url(#transfer-wash)" />
            <path d={line} className="transfer-speed-line" />
          </svg>
          <span className="transfer-speed-figures">
            <strong>{formatBytes(progress.rate ?? rates[rates.length - 1])}/s</strong>
            <span className="muted">fastest {formatBytes(top)}/s</span>
          </span>
        </div>
      )}
      {progress.current && (
        <div className="transfer-row">
          <span className="muted">Now</span>
          <span className="transfer-file" title={progress.current}>
            <span className="mono">{progress.current.split("/").pop()}</span>
            <span className="muted">{progress.current.split("/").slice(0, -1).join("/")}</span>
          </span>
        </div>
      )}
      {recent.length > 0 && (
        <div className="transfer-row">
          <span className="muted">Just done</span>
          <span className="transfer-recent">
            {recent.map((file) => (
              <span key={file} className="mono" title={file}>
                {file.split("/").pop()}
              </span>
            ))}
          </span>
        </div>
      )}
      {progress.biggestLeft && (
        <div className="transfer-row">
          <span className="muted">Biggest to come</span>
          <span className="transfer-file" title={progress.biggestLeft.name}>
            <span className="mono">{progress.biggestLeft.name.split("/").pop()}</span>
            <span className="transfer-size">{formatBytes(progress.biggestLeft.size)}</span>
          </span>
        </div>
      )}
      {progress.remaining !== undefined && (
        <div className="transfer-row">
          <span className="muted">Left</span>
          <span>{timeLeft(progress.remaining)}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** "About 3 minutes", like the bar's text, without the "left". */
function timeLeft(seconds: number): string {
  if (seconds < 10) return "A few seconds";
  if (seconds < 55) return `About ${Math.ceil(seconds / 5) * 5} seconds`;
  if (seconds < 90) return "About a minute";
  if (seconds < 3570) return `About ${Math.round(seconds / 60)} minutes`;
  const minutes = Math.round(seconds / 60);
  return `About ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A thin bar under the toolbar while a fetch, pull, push or checkout runs. */
export function ProgressStrip({ label, progress, onCancel }: Props) {
  const percent = progress?.percent ?? null;
  // The transfer's speed and files over time, for the panel shown on hover.
  const history = useRef<History>({ rates: [], recent: [] });
  const [hovered, setHovered] = useState<DOMRect | null>(null);
  const last = useRef<{ current?: string; at: number }>({ at: 0 });
  useEffect(() => {
    if (!progress) return;
    const now = Date.now();
    if (progress.rate !== undefined && now - last.current.at >= 300) {
      history.current.rates = [...history.current.rates, progress.rate].slice(-RATES_KEPT);
      last.current.at = now;
    }
    // The file it was on is done once it moves to the next.
    const previous = last.current.current;
    if (progress.current && previous && previous !== progress.current && !history.current.recent.includes(previous)) {
      history.current.recent = [previous, ...history.current.recent].slice(0, 3);
    }
    last.current.current = progress.current;
  }, [progress]);
  const detailed = Boolean(progress && (progress.rate !== undefined || progress.current));

  return (
    <div
      className="progress-strip"
      role="progressbar"
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      onMouseEnter={(event) => setHovered(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setHovered(null)}
    >
      <ProgressText label={label} progress={progress} />
      <ProgressBars progress={progress} />
      {onCancel && (
        <Button kind="secondary" size="small" onClick={onCancel}>
          Cancel
        </Button>
      )}
      {hovered && detailed && progress && <TransferPanel progress={progress} history={history.current} anchor={hovered} />}
    </div>
  );
}
