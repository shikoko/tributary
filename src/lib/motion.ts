// Small, quick movements that make changes easier to follow: things grow into place,
// shrink away and fade in, rather than appearing and disappearing at once. None for people
// who ask their system for less motion.

/** The app's easing: quick to start, gentle to settle. */
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The system asks for less motion. */
export function lessMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** Element.animate, unless the system asks for less motion (or it isn't there). */
export function animate(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (lessMotion() || typeof element.animate !== "function") return null;
  return element.animate(keyframes, { easing: EASE, ...options });
}

/** A tab, or anything laid out in a row, growing from nothing to its own width. */
export function growIn(element: HTMLElement, duration = 200): Animation | null {
  const style = getComputedStyle(element);
  const width = element.getBoundingClientRect().width;
  const animation = animate(
    element,
    [
      { maxWidth: "0px", minWidth: "0px", paddingLeft: "0px", paddingRight: "0px", opacity: 0 },
      { maxWidth: `${width}px`, minWidth: `${width}px`, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, opacity: 1 },
    ],
    { duration },
  );
  if (animation) {
    const overflow = element.style.overflow;
    element.style.overflow = "hidden";
    const done = () => (element.style.overflow = overflow);
    animation.finished.then(done, done);
  }
  return animation;
}

/** The opposite: from its width to nothing. */
export function shrinkAway(element: HTMLElement, duration = 170): Animation | null {
  const style = getComputedStyle(element);
  const width = element.getBoundingClientRect().width;
  element.style.overflow = "hidden";
  return animate(
    element,
    [
      { maxWidth: `${width}px`, minWidth: `${width}px`, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, opacity: 1 },
      { maxWidth: "0px", minWidth: "0px", paddingLeft: "0px", paddingRight: "0px", opacity: 0 },
    ],
    { duration, fill: "forwards" },
  );
}
