/** Where two pictures of the same size differ, pixel by pixel. */
export interface PixelChanges {
  /** How many pixels changed. */
  changed: number;
  total: number;
  /** The smallest rectangle holding every changed pixel, if any did. */
  area: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Compare two RGBA pictures of `width` × `height` and paint `out` (same size): the after
 * picture greyed and dimmed, with the changed pixels in `highlight` ([r, g, b]). A pixel
 * counts as changed when any of its channels does (transparent pixels count as the same
 * whatever their colour).
 */
export function comparePixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
  out: Uint8ClampedArray,
  highlight: [number, number, number],
): PixelChanges {
  let changed = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const clear = before[i + 3] === 0 && after[i + 3] === 0;
      const differs = !clear && (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2] || before[i + 3] !== after[i + 3]);
      if (differs) {
        changed++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        out[i] = highlight[0];
        out[i + 1] = highlight[1];
        out[i + 2] = highlight[2];
        out[i + 3] = 255;
      } else {
        // Grey, under half as bright, so the changes stand out.
        const grey = (after[i] * 0.299 + after[i + 1] * 0.587 + after[i + 2] * 0.114) * 0.45;
        out[i] = out[i + 1] = out[i + 2] = grey;
        out[i + 3] = after[i + 3];
      }
    }
  }
  return {
    changed,
    total: width * height,
    area: right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
  };
}

/** "1,204 pixels changed (0.8%), in a 120 × 80 area" or that none did. */
export function describePixelChanges({ changed, total, area }: PixelChanges): string {
  if (changed === 0 || !area) return "No pixels changed: only the file did (like its settings or how it's saved).";
  const share = (changed / total) * 100;
  const percent = share < 0.1 ? "under 0.1%" : share >= 99.95 ? "all of them" : `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
  const noun = changed === 1 ? "pixel" : "pixels";
  if (changed === total) return `Every pixel changed (${total.toLocaleString("en-US")}).`;
  return `${changed.toLocaleString("en-US")} ${noun} changed (${percent}), in a ${area.width} × ${area.height} area at ${area.x}, ${area.y}.`;
}
