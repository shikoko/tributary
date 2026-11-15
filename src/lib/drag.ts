/**
 * Dragging with pointer events: branch and tag labels onto commits, and commits onto
 * branch labels. (The system's drag and drop stays free for folders dropped onto the
 * window.)
 *
 * Rows that accept a label carry a `data-drop-commit` attribute with their commit id, and
 * labels that accept a commit a `data-drop-branch` attribute with their branch's name.
 */

/** A label was dropped on the row of commit `targetId`, at window coordinates (x, y). */
type DropHandler = (revision: string, targetId: string, x: number, y: number) => void;
/** Commit `id` was dropped on the label of local branch `branch`. */
type CommitDropHandler = (id: string, branch: string) => void;

/** How far the pointer moves before a press becomes a drag, in pixels. */
const THRESHOLD = 5;

let dropHandler: DropHandler | null = null;
let commitDropHandler: CommitDropHandler | null = null;

/** Handle labels dropped on commit rows. Returns a function that stops handling them. */
export function onLabelDrop(handler: DropHandler): () => void {
  dropHandler = handler;
  return () => {
    if (dropHandler === handler) dropHandler = null;
  };
}

/** Handle commits dropped on branch labels. Returns a function that stops handling them. */
export function onCommitDrop(handler: CommitDropHandler): () => void {
  commitDropHandler = handler;
  return () => {
    if (commitDropHandler === handler) commitDropHandler = null;
  };
}

type Press = { button: number; clientX: number; clientY: number };

/** A label was pressed: it becomes a drag once the pointer moves a little. */
export function pressLabel(event: Press, revision: string) {
  drag(event, revision, "dropCommit", "dragging-label", (target, x, y) => dropHandler?.(revision, target, x, y));
}

/**
 * A commit was pressed: it becomes a drag once the pointer moves a little, shown as `text`
 * (its short id and summary).
 */
export function pressCommit(event: Press, id: string, text: string) {
  drag(event, text, "dropBranch", "dragging-commit", (branch) => commitDropHandler?.(id, branch));
}

/**
 * A press that becomes a drag once the pointer moves a little: a ghost showing `text`
 * follows the pointer, the element under it with the `data-*` attribute `accepts` (its
 * dataset name) is marked as the target, and a release on one calls `drop` with the
 * attribute's value. Esc stops it. `bodyClass` is on the body while it's dragging.
 */
function drag(event: Press, text: string, accepts: "dropCommit" | "dropBranch", bodyClass: string, drop: (target: string, x: number, y: number) => void) {
  if (event.button !== 0) return;
  const start = { x: event.clientX, y: event.clientY };
  let ghost: HTMLElement | null = null;
  let target: HTMLElement | null = null;

  const targetAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(`[data-${accepts === "dropCommit" ? "drop-commit" : "drop-branch"}]`) ?? null;
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
    document.body.classList.remove(bodyClass);
  };
  const move = (e: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = text;
      document.body.appendChild(ghost);
      document.body.classList.add(bodyClass);
      window.getSelection()?.removeAllRanges();
    }
    ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    setTarget(targetAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    const dragged = ghost !== null;
    const dropOn = target?.dataset[accepts];
    stop();
    if (!dragged) return;
    // The press ends in a click on whatever is under the pointer; it isn't one.
    const swallow = (click: MouseEvent) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (dropOn) drop(dropOn, e.clientX, e.clientY);
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
