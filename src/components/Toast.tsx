import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "./Icons";

export interface ToastMessage {
  text: string;
  /** An optional button, like "Undo". */
  action?: { label: string; onClick: () => void };
  /** Instead of the check mark, like a bell for news. */
  icon?: ReactNode;
}

/** A short confirmation at the bottom of the window that goes away by itself. */
export function Toast({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (hovered) return;
    // Leave more time when there's a button to press.
    const timer = setTimeout(onDone, toast.action ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast, onDone, hovered]);

  return (
    <div
      className="toast"
      role="status"
      title="Click to dismiss"
      onClick={onDone}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {toast.icon ?? <CheckIcon size={14} />}
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="toast-button"
          onClick={(event) => {
            event.stopPropagation();
            onDone();
            toast.action!.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
