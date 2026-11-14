/** `list` with the item at `from` taken out and put back at `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Where something is along a row: its left and right edges. */
export interface Slot {
  left: number;
  right: number;
}

/**
 * Where an item dragged along a row goes, as in a browser's tab strip: past each neighbour
 * whose middle its leading edge has crossed. `slots` are the items' places before the drag,
 * `from` the dragged one's, and `offset` how far it's been dragged (left is negative).
 */
export function dropIndex(slots: readonly Slot[], from: number, offset: number): number {
  let to = from;
  if (offset > 0) {
    const edge = slots[from].right + offset;
    for (let i = from + 1; i < slots.length && edge > (slots[i].left + slots[i].right) / 2; i++) to = i;
  } else if (offset < 0) {
    const edge = slots[from].left + offset;
    for (let i = from - 1; i >= 0 && edge < (slots[i].left + slots[i].right) / 2; i--) to = i;
  }
  return to;
}
