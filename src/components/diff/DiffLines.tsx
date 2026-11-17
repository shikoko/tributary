import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Hunk, LineMode } from "../../api";
import { changedKeys, hunkKeys, keysBetween, lineKey } from "../../lib/lineSelection";
import { splitRows, type SplitRow } from "../../lib/sideBySide";
import { highlightHunk, MAX_HIGHLIGHT_LINES, pieces, type Piece } from "../../lib/syntax";
import { wordSegments } from "../../lib/wordDiff";
import { foldPictures, pictureLabel, picturesIn, type EmbeddedPicture, type Folded, type PictureChange } from "../../lib/embeddedPictures";
import { formatBytes } from "../../lib/format";
import { InlinePicture } from "./DiffPictures";

const SIGNS = { added: "+", removed: "−", context: " " } as const;
const NOTHING = new Set<string>();

/** Staging (or unstaging, or discarding) some of the lines shown. */
export interface LinePicking {
  /** Your unstaged changes can be staged or discarded; staged ones unstaged. */
  side: "staged" | "unstaged";
  /** The chosen lines' keys (lib/lineSelection.ts). */
  selected: Set<string>;
  onSelect: (selected: Set<string>) => void;
  /** Do `mode` to these lines. */
  onApply: (mode: LineMode, keys: string[]) => void;
  /** Applying lines is waiting for git. */
  busy: boolean;
}

/** For each run of changed rows (side by side), the row it ends at, with `of` the run's lines. */
function runEnds<T>(rows: SplitRow[], of: (indexes: number[]) => T): Map<number, T> {
  const ends = new Map<number, T>();
  let run: number[] = [];
  rows.forEach((row, index) => {
    // An unchanged line is on both sides; a changed row has a different line on each, or one.
    if (row.left === row.right) return;
    run.push(...[row.left, row.right].filter((line): line is number => line !== null));
    const next = rows[index + 1];
    if (!next || next.left === next.right) {
      ends.set(index, of(run));
      run = [];
    }
  });
  return ends;
}

/** A picture's label in its line: what it is, and a click shows its letters instead. */
function PictureChip({ picture, label, onUnfold }: { picture: EmbeddedPicture; label: string; onUnfold?: () => void }) {
  return (
    <button type="button" className="diff-picture-chip" onClick={onUnfold} title={`${label}, written out in base64: click to show its letters`}>
      <img src={picture.url} alt="" draggable={false} />
      <span className="button-label">{label}</span>
    </button>
  );
}

/** A line's pieces: coloured by syntax, with the changed words marked (and pictures in it folded). */
export function LineText({ parts, onUnfold }: { parts: Folded[]; onUnfold?: () => void }) {
  if (parts.length === 0) return <> </>;
  return (
    <>
      {parts.map((part, index) => {
        if (part.picture) return <PictureChip key={index} picture={part.picture} label={part.text} onUnfold={onUnfold} />;
        const text = part.className ? <span className={part.className}>{part.text}</span> : part.text;
        return part.changed ? <mark key={index}>{text}</mark> : <span key={index}>{text}</span>;
      })}
    </>
  );
}

/** A text file's changes: each stretch of changed lines with its line numbers, the changed words marked. */
export function DiffLines({
  hunks,
  picking,
  language,
  split = false,
  wrap = false,
  pictures,
}: {
  /** Pictures written into the lines: folded into labels, and shown under the lines they changed in. */
  pictures?: { changes: PictureChange[]; path: string };
  hunks: Hunk[];
  picking?: LinePicking;
  language?: string | null;
  /** Before and after side by side, instead of in one column. */
  split?: boolean;
  /** Long lines wrapped to the width there is, instead of scrolled to (side by side, they always are). */
  wrap?: boolean;
}) {
  const segments = useMemo(() => hunks.map((hunk) => wordSegments(hunk.lines)), [hunks]);
  const syntax = useMemo(() => {
    const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
    return total > MAX_HIGHLIGHT_LINES ? null : hunks.map((hunk) => highlightHunk(hunk.lines, language ?? null));
  }, [hunks, language]);
  const order = useMemo(() => changedKeys(hunks), [hunks]);
  // Pictures written into the lines, folded into labels until one is clicked.
  const fold = Boolean(pictures);
  const found = useMemo(() => (fold ? hunks.map((hunk) => hunk.lines.map((line) => picturesIn(line.text))) : null), [hunks, fold]);
  const [unfolded, setUnfolded] = useState<{ hunks: Hunk[]; keys: Set<string> }>({ hunks, keys: new Set() });
  const open = unfolded.hunks === hunks ? unfolded.keys : NOTHING;
  /** The line's pieces, its pictures folded (unless it was unfolded), and how to unfold them. */
  const lineParts = (hunkIndex: number, index: number, parts: Piece[]): { parts: Folded[]; onUnfold?: () => void } => {
    const pictures = found?.[hunkIndex][index] ?? [];
    const key = `${hunkIndex}:${index}`;
    if (pictures.length === 0 || open.has(key)) return { parts };
    return {
      parts: foldPictures(parts, pictures, (picture) => pictureLabel(picture, formatBytes)),
      onUnfold: () => setUnfolded({ hunks, keys: new Set([...open, key]) }),
    };
  };
  /** The pictures that changed in the run of lines ending at `index`, to show under it. */
  const changedAt = (hunkIndex: number, index: number) => pictures?.changes.filter((change) => change.hunk === hunkIndex && change.last === index) ?? [];
  /** The pictures that changed in a run of lines (by their indexes), side by side. */
  const changedIn = (hunkIndex: number, indexes: number[]) => pictures?.changes.filter((change) => change.hunk === hunkIndex && indexes.includes(change.last)) ?? [];
  /** Where a shift-click range starts: the line last clicked. */
  const anchor = useRef<string | null>(null);
  /** While dragging over the line numbers: whether lines are being chosen or let go. */
  const dragging = useRef<{ choose: boolean; from: string; base: Set<string> } | null>(null);

  useEffect(() => {
    const stop = () => (dragging.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const press = (key: string, event: React.PointerEvent) => {
    if (!picking || event.button !== 0) return;
    event.preventDefault();
    const { selected } = picking;
    if (event.shiftKey && anchor.current) {
      picking.onSelect(new Set([...selected, ...keysBetween(order, anchor.current, key)]));
      return;
    }
    const choose = !selected.has(key);
    const next = new Set(selected);
    if (choose) next.add(key);
    else next.delete(key);
    anchor.current = key;
    dragging.current = { choose, from: key, base: new Set(selected) };
    picking.onSelect(next);
  };

  const enter = (key: string) => {
    const drag = dragging.current;
    if (!picking || !drag) return;
    const next = new Set(drag.base);
    for (const each of keysBetween(order, drag.from, key)) {
      if (drag.choose) next.add(each);
      else next.delete(each);
    }
    picking.onSelect(next);
  };

  return (
    <div className={`diff-lines${picking ? " picking" : ""}${split ? " split" : ""}${wrap ? " wrap" : ""}`} role="table" aria-label="Changed lines">
      {hunks.map((hunk, hunkIndex) => {
        const keys = picking ? hunkKeys(hunk) : [];
        const chosenHere = picking ? keys.filter((key) => picking.selected.has(key)) : [];
        const rows = split ? splitRows(hunk.lines) : [];
        // Side by side, the pictures that changed in a run of rows go under its last row.
        const picturesBelow = split && pictures ? runEnds(rows, (indexes) => changedIn(hunkIndex, indexes)) : null;
        return (
          <div key={hunkIndex} className="diff-hunk" role="rowgroup">
            <div className="diff-hunk-header" role="row">
              <span className="diff-hunk-dots" role="cell">
                ⋯
              </span>
              {hunk.section && (
                <span className="diff-hunk-section" role="cell">
                  {hunk.section}
                </span>
              )}
              {picking && keys.length > 0 && (
                <span className="diff-hunk-actions" role="cell">
                  {picking.side === "unstaged" ? (
                    <>
                      <button
                        className="hunk-button"
                        disabled={picking.busy}
                        onClick={() => picking.onApply("discard", keys)}
                        title="Undo these changes in the file (you can put them back)"
                      >
                        <span className="button-label">Discard</span>
                      </button>
                      <button className="hunk-button primary" disabled={picking.busy} onClick={() => picking.onApply("stage", keys)} title="Stage these changes">
                        <span className="button-label">Stage</span>
                      </button>
                    </>
                  ) : (
                    <button className="hunk-button primary" disabled={picking.busy} onClick={() => picking.onApply("unstage", keys)} title="Take these changes out of what's staged">
                      <span className="button-label">Unstage</span>
                    </button>
                  )}
                  {chosenHere.length > 0 && <span className="hunk-chosen">{chosenHere.length} chosen</span>}
                </span>
              )}
            </div>
            {split &&
              rows.map(({ left, right }, rowIndex) => {
                // One side of a row: the line before (left) or after (right) the change.
                const half = (index: number | null, side: "left" | "right") => {
                  if (index === null) return <div className="diff-half empty" aria-hidden />;
                  const line = hunk.lines[index];
                  const key = picking ? lineKey(line) : null;
                  const chosen = key !== null && picking!.selected.has(key);
                  const pick = key
                    ? {
                        onPointerDown: (event: React.PointerEvent) => press(key, event),
                        onPointerEnter: () => enter(key),
                        title: chosen ? "Chosen: click to leave it out" : "Click to choose this line (shift-click or drag for more)",
                      }
                    : undefined;
                  const number = side === "left" ? line.old : line.new;
                  return (
                    // A cell of the row: whether its line is chosen is in its number's name.
                    <div className={`diff-half ${line.kind}${key ? " pickable" : ""}${chosen ? " chosen" : ""}`} role="cell">
                      <span className="diff-number" aria-label={number ? `Line ${number} ${side === "left" ? "before" : "after"}${chosen ? ", chosen" : ""}` : undefined} {...pick}>
                        {number ?? ""}
                      </span>
                      <span className="diff-sign" aria-hidden {...pick}>
                        {SIGNS[line.kind]}
                      </span>
                      <span className="diff-text">
                        <LineText {...lineParts(hunkIndex, index, pieces(line.text, syntax?.[hunkIndex][index] ?? null, segments[hunkIndex][index]))} />
                      </span>
                    </div>
                  );
                };
                const below = picturesBelow?.get(rowIndex);
                return (
                  <Fragment key={rowIndex}>
                    <div className="diff-split-row" role="row">
                      {half(left, "left")}
                      {half(right, "right")}
                    </div>
                    {below?.map((change, index) => <InlinePicture key={index} change={change} path={pictures!.path} split />)}
                  </Fragment>
                );
              })}
            {!split && hunk.lines.map((line, lineIndex) => {
              const parts = segments[hunkIndex][lineIndex];
              const key = picking ? lineKey(line) : null;
              const chosen = key !== null && picking!.selected.has(key);
              const pick = key
                ? {
                    onPointerDown: (event: React.PointerEvent) => press(key, event),
                    onPointerEnter: () => enter(key),
                    title: chosen ? "Chosen: click to leave it out" : "Click to choose this line (shift-click or drag for more)",
                  }
                : undefined;
              const shown = lineParts(hunkIndex, lineIndex, pieces(line.text, syntax?.[hunkIndex][lineIndex] ?? null, parts));
              const below = changedAt(hunkIndex, lineIndex);
              return (
                <Fragment key={lineIndex}>
                  <div className={`diff-row ${line.kind}${key ? " pickable" : ""}${chosen ? " chosen" : ""}`} role="row" aria-selected={key ? chosen : undefined}>
                    <span className="diff-number" role="cell" aria-label={line.old ? `Line ${line.old} before` : undefined} {...pick}>
                      {line.old ?? ""}
                    </span>
                    <span className="diff-number" role="cell" aria-label={line.new ? `Line ${line.new} after` : undefined} {...pick}>
                      {line.new ?? ""}
                    </span>
                    <span className="diff-sign" aria-hidden {...pick}>
                      {SIGNS[line.kind]}
                    </span>
                    <span className="diff-text" role="cell">
                      <LineText {...shown} />
                    </span>
                  </div>
                  {below.map((change, index) => (
                    <InlinePicture key={index} change={change} path={pictures!.path} />
                  ))}
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
