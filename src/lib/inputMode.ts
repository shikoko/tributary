/**
 * Whether the last thing the user did was press a key (rather than point and click), so
 * a menu opened from the keyboard can put the focus on its first item, while one opened
 * with the mouse doesn't show a focus ring nobody asked for.
 */
let keyboard = false;

if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (keyboard = true), true);
  window.addEventListener("pointerdown", () => (keyboard = false), true);
}

export function usingKeyboard(): boolean {
  return keyboard;
}

/**
 * The element to move to from `current` among `items` with an arrow key (or Home and
 * End), wrapping around at the ends. Null for other keys.
 */
export function stepFocus<T>(items: T[], current: T | null, key: string): T | null {
  if (items.length === 0) return null;
  const index = current === null ? -1 : items.indexOf(current);
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return items[(index + 1) % items.length];
    case "ArrowUp":
    case "ArrowLeft":
      return items[index <= 0 ? items.length - 1 : index - 1];
    case "Home":
      return items[0];
    case "End":
      return items[items.length - 1];
    default:
      return null;
  }
}
