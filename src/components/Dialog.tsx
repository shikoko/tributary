import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  /** The buttons, right-aligned at the bottom. */
  buttons: ReactNode;
  error?: string | null;
  /** While true, clicking outside or pressing Esc doesn't close the dialog. */
  busy?: boolean;
  onCancel: () => void;
}

/** A modal dialog. Esc or a click outside cancels it. */
export function Dialog({ title, children, buttons, error, busy, onCancel }: Props) {
  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        className="dialog"
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
        {error && <div className="error-banner">{error}</div>}
        <div className="dialog-buttons">{buttons}</div>
      </div>
    </div>
  );
}
