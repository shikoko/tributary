import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CommitRow } from "../../api";
import type { CanvasColors } from "../../lib/appearance";
import { marksNear, scrollMarks, useScrollMarkers } from "./canvases";

/** Where the strip beside the scrollbar is on screen. */
export interface Strip {
  top: number;
  right: number;
  bottom: number;
  width: number;
}

interface Input {
  commits: CommitRow[];
  /** The list row of each commit. */
  slotOf: number[];
  indexById: Map<string, number>;
  rowHeight: number;
  /** The height of everything in the list. */
  contentHeight: number;
  viewport: { height: number; scrollbar: number };
  matchIds: Set<string> | null;
  headId: string | null;
  /** The selected commits. */
  marked: Set<string>;
  colors: CanvasColors;
  /** The tips of the branch whose lanes are lit. */
  tipIds: string[];
}

/**
 * The marks beside the scrollbar (branch tips, search matches, the checked-out commit and
 * the selection), drawn on `canvas`. The pointer on them (`markAt`, from the list's pointer
 * events) makes the ones near it stand out, and a card say what they are; a lit branch's
 * tips light up too, over the strip by `body` (the list's body).
 */
export function useMarkStrip(canvas: RefObject<HTMLCanvasElement | null>, input: Input) {
  const { commits, slotOf, indexById, rowHeight, contentHeight, viewport, matchIds, headId, marked, colors, tipIds } = input;
  const marks = useMemo(
    () => scrollMarks({ commits, slotOf, indexById, rowHeight, contentHeight, height: viewport.height, matchIds, headId, selectedIds: marked, colors }),
    [commits, slotOf, indexById, rowHeight, contentHeight, viewport.height, matchIds, headId, marked, colors],
  );
  const [markAt, setMarkAt] = useState<{ y: number; strip: Strip } | null>(null);
  const near = useMemo(() => (markAt ? marksNear(marks, markAt.y) : []), [marks, markAt]);
  // The lit branch's tips (not those the pointer is on, which MarkHover lights).
  const tipMarks = useMemo(() => {
    const tips = new Set(tipIds.map((id) => indexById.get(id)));
    const pointedAt = new Set(near.map((mark) => mark.index));
    return marks.filter((mark) => tips.has(mark.index) && !pointedAt.has(mark.index));
  }, [marks, tipIds, indexById, near]);
  const lit = useMemo(() => new Set([...near, ...tipMarks].map((mark) => mark.index)), [near, tipMarks]);
  useScrollMarkers(canvas, marks, viewport, lit);
  const body = useRef<HTMLDivElement>(null);
  const [tipStrip, setTipStrip] = useState<Strip | null>(null);
  useLayoutEffect(() => {
    const rect = tipMarks.length > 0 ? body.current?.getBoundingClientRect() : undefined;
    setTipStrip(rect ? { top: rect.top, right: rect.right, bottom: rect.top + viewport.height, width: viewport.scrollbar || 6 } : null);
  }, [tipMarks, viewport]);
  return { markAt, setMarkAt, near, tipMarks, tipStrip, body };
}
