import type { Progress } from "../api";

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

/** A thin bar under the toolbar while a fetch, pull, push or checkout runs. */
export function ProgressStrip({ label, progress, onCancel }: Props) {
  const percent = progress?.percent ?? null;
  return (
    <div className="progress-strip" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <ProgressText label={label} progress={progress} />
      <div className="progress-track">
        <div
          className={`progress-fill${percent === null ? " indeterminate" : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {onCancel && (
        <button className="secondary-button small" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
