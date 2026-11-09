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

/** A thin bar under the toolbar while a fetch, pull, push or checkout runs. */
export function ProgressStrip({ label, progress, onCancel }: Props) {
  const percent = progress?.percent ?? null;
  return (
    <div className="progress-strip" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <ProgressText label={label} progress={progress} />
      <ProgressBars progress={progress} />
      {onCancel && (
        <button className="secondary-button small" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
