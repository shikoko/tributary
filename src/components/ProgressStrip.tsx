import type { Progress } from "../api";

interface Props {
  /** Like "Pulling". */
  label: string;
  progress: Progress | null;
  onCancel: () => void;
}

/** A thin bar under the toolbar while a fetch, pull or push runs. */
export function ProgressStrip({ label, progress, onCancel }: Props) {
  const percent = progress?.percent ?? null;
  return (
    <div className="progress-strip" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <span className="progress-text">
        {label}…
        {progress && progress.phase !== "Connecting" && (
          <span className="muted">
            {" "}
            {progress.phase}
            {percent !== null ? ` ${percent}%` : ""}
          </span>
        )}
      </span>
      <div className="progress-track">
        <div
          className={`progress-fill${percent === null ? " indeterminate" : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <button className="secondary-button small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
