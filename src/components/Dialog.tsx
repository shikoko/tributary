import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

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

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

/** Tab and Shift+Tab go around the dialog's own controls, never behind it. */
function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
  const all = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hidden);
  if (all.length === 0) return;
  const first = all[0];
  const last = all[all.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A modal dialog. Esc or a click outside cancels it. The keyboard stays inside it while
 * it's open, and goes back to where it was when it closes.
 */
export function Dialog({ title, children, buttons, error, errorAction, busy, wide, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Unless a field asked for the focus (autoFocus), the dialog itself takes it.
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus();
    return () => {
      if (before?.isConnected) before.focus();
      // What had the focus is gone (a button that changed): the dialog underneath, if any.
      else document.querySelector<HTMLElement>(".dialog[aria-modal]")?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        ref={box}
        className={`dialog${wide ? " wide" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!busy) onCancel();
          } else if (event.key === "Tab") {
            keepFocusInside(event);
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
