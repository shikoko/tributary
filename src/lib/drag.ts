/**
 * Dragging branch and tag labels onto commits, with pointer events. (The system's drag
 * and drop stays free for folders dropped onto the window.)
 *
 * Rows that accept a label carry a `data-drop-commit` attribute with their commit id.
 */

/** A label was dropped on the row of commit `targetId`, at window coordinates (x, y). */
type DropHandler = (revision: string, targetId: string, x: number, y: number) => void;

/** How far the pointer moves before a press becomes a drag, in pixels. */
const THRESHOLD = 5;

let dropHandler: DropHandler | null = null;

/** Handle labels dropped on commit rows. Returns a function that stops handling them. */
export function onLabelDrop(handler: DropHandler): () => void {
  dropHandler = handler;
  return () => {
    if (dropHandler === handler) dropHandler = null;
  };
}

/** A label was pressed: it becomes a drag once the pointer moves a little. */
export function pressLabel(event: { button: number; clientX: number; clientY: number }, revision: string) {
  if (event.button !== 0) return;
  const start = { x: event.clientX, y: event.clientY };
  let ghost: HTMLElement | null = null;
  let target: HTMLElement | null = null;

  const targetAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-commit]") ?? null;
  const setTarget = (next: HTMLElement | null) => {
    if (next === target) return;
    target?.classList.remove("drop-target");
    next?.classList.add("drop-target");
    target = next;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape, true);
    setTarget(null);
    ghost?.remove();
    document.body.classList.remove("dragging-label");
  };
  const move = (e: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = revision;
      document.body.appendChild(ghost);
      document.body.classList.add("dragging-label");
      window.getSelection()?.removeAllRanges();
    }
    ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    setTarget(targetAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    const dragged = ghost !== null;
    const dropOn = target?.dataset.dropCommit;
    stop();
    if (!dragged) return;
    // The press ends in a click on whatever is under the pointer; it isn't one.
    const swallow = (click: MouseEvent) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (dropOn) dropHandler?.(revision, dropOn, e.clientX, e.clientY);
  };
  const cancel = () => stop();
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !ghost) return;
    e.stopPropagation();
    stop();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape, true);
}
