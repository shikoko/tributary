import type { PointerEvent } from "react";

interface Props {
  /** Called while dragging, with how far the pointer moved since the drag started. */
  onResize: (delta: number) => void;
  onResizeStart: () => void;
  /** Double-click: go back to the default size. */
  onReset?: () => void;
  className?: string;
  title?: string;
}

/** A thin vertical bar that can be dragged sideways to resize what's next to it. */
export function ResizeHandle({ onResize, onResizeStart, onReset, className, title }: Props) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    const startX = event.clientX;
    element.setPointerCapture(event.pointerId);
    onResizeStart();
    document.body.classList.add("resizing");
    const move = (moveEvent: globalThis.PointerEvent) => onResize(moveEvent.clientX - startX);
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing");
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  };

  return (
    <div
      className={`resize-handle${className ? ` ${className}` : ""}`}
      onPointerDown={start}
      onDoubleClick={onReset}
      title={title ?? (onReset ? "Drag to resize, double-click to reset" : "Drag to resize")}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
