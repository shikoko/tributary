// Kinds of file, for what makes a repository big.

/** "*.psd" for "Art/Hero.psd" (the pattern Git LFS tracks them by), or the name itself. */
export function kindOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `*.${name.slice(dot + 1).toLowerCase()}` : name;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lays `items` out in `box` as a squarified treemap: each gets a rectangle whose area
 * matches its share of the total, as close to square as the rest allow. Biggest first;
 * items worth nothing are left out.
 */
export function squarify<T>(items: readonly T[], value: (item: T) => number, box: Box): (Box & { item: T })[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, value(item)), 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const queue = items
    .filter((item) => value(item) > 0)
    .map((item) => ({ item, area: value(item) * scale }))
    .sort((a, b) => b.area - a.area);
  const placed: (Box & { item: T })[] = [];
  let { x, y, w, h } = box;
  // How far from square the row's worst rectangle is, laid along a side this long.
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((total, entry) => total + entry.area, 0);
    const most = Math.max(...row.map((entry) => entry.area));
    const least = Math.min(...row.map((entry) => entry.area));
    return Math.max((side * side * most) / (sum * sum), (sum * sum) / (side * side * least));
  };
  const lay = (row: { item: T; area: number }[]) => {
    const sum = row.reduce((total, entry) => total + entry.area, 0);
    if (w >= h) {
      // A column down the left.
      const thickness = sum / h;
      let offset = y;
      for (const entry of row) {
        const length = entry.area / thickness;
        placed.push({ item: entry.item, x, y: offset, w: thickness, h: length });
        offset += length;
      }
      x += thickness;
      w -= thickness;
    } else {
      // A row along the top.
      const thickness = sum / w;
      let offset = x;
      for (const entry of row) {
        const length = entry.area / thickness;
        placed.push({ item: entry.item, x: offset, y, w: length, h: thickness });
        offset += length;
      }
      y += thickness;
      h -= thickness;
    }
  };
  let row: { item: T; area: number }[] = [];
  for (const entry of queue) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, entry], side) <= worst(row, side)) {
      row.push(entry);
      continue;
    }
    lay(row);
    row = [entry];
  }
  if (row.length) lay(row);
  return placed;
}
