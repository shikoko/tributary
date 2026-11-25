// A menu or panel joined to the button that opened it, the button opening out into it as a
// tab does into the page under it (see Joint.tsx): where it goes, and which of its top
// corners meet the button's sides.

/** How far below its button a joined panel starts: the button's foot, from its bottom edge
 *  down to the panel's. As tall as the curve where the foot meets the panel (.joint-flare), so
 *  the curve starts where the button ends. */
export const JOINT_GAP = 6;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A button's box on whole pixels: the outline drawn round it, and the panel's edge lined up
 *  with it, are sharp lines, not ones smeared across two rows of pixels. */
export const snap = (box: Box): Box => ({
  left: Math.round(box.left),
  top: Math.round(box.top),
  right: Math.round(box.right),
  bottom: Math.round(box.bottom),
});

/**
 * Where a panel `width` wide goes across the window (`room` wide) to hang from `button`:
 * its left edge on the button's left (`prefer` "left"), or its right edge on the button's
 * right ("right"), or the other one when that doesn't fit, and inside the window, `margin`
 * from its sides, whatever happens.
 */
export function hang(button: Box, width: number, room: number, prefer: "left" | "right", margin: number): number {
  const fromLeft = button.left;
  const fromRight = button.right - width;
  const fitsLeft = fromLeft + width <= room - margin;
  const fitsRight = fromRight >= margin;
  const wanted = prefer === "left" ? (fitsLeft || !fitsRight ? fromLeft : fromRight) : fitsRight || !fitsLeft ? fromRight : fromLeft;
  return Math.max(margin, Math.min(wanted, room - width - margin));
}

/** Which of a panel's top corners meet the button's sides: those are square, the button's
 *  outline running straight down into the panel's side. */
export function meets(button: Box, left: number, width: number): { left: boolean; right: boolean } {
  return { left: Math.abs(left - button.left) < 0.5, right: Math.abs(left + width - button.right) < 0.5 };
}

/** Whether a panel at `top` hangs from `button` (not pushed up the window to fit, or opened
 *  above it): only then are they drawn joined. */
export const hangsFrom = (button: Box, top: number) => Math.abs(top - (button.bottom + JOINT_GAP)) < 0.5;
