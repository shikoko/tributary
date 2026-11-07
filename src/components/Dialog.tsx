import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  /** The buttons, right-aligned at the bottom. */
  buttons: ReactNode;
  error?: string | null;
  /** A button shown with the error, like "Stash changes and retry". */
  errorAction?: { label: string; onClick: () => void } | null;
  /** While true, clicking outside or pressing Esc doesn't close the dialog. */
  busy?: boolean;
  /** Room for a list, like the commits of an interactive rebase. */
  wide?: boolean;
  onCancel: () => void;
}

/** A modal dialog. Esc or a click outside cancels it. */
export function Dialog({ title, children, buttons, error, errorAction, busy, wide, onCancel }: Props) {
  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        className={`dialog${wide ? " wide" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!busy) onCancel();
          }
        }}
      >
        <h2>{title}</h2>
        {children}
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            {errorAction && (
              <button className="error-action" onClick={errorAction.onClick} disabled={busy}>
                {errorAction.label}
              </button>
            )}
          </div>
        )}
        <div className="dialog-buttons">{buttons}</div>
      </div>
    </div>
  );
}
