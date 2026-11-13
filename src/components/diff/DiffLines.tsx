import { useEffect, useMemo, useRef } from "react";
import type { Hunk, LineMode } from "../../api";
import { changedKeys, hunkKeys, keysBetween, lineKey } from "../../lib/lineSelection";
import { splitRows } from "../../lib/sideBySide";
import { highlightHunk, MAX_HIGHLIGHT_LINES, pieces, type Piece } from "../../lib/syntax";
import { wordSegments } from "../../lib/wordDiff";

const SIGNS = { added: "+", removed: "−", context: " " } as const;

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

/** A line's pieces: coloured by syntax, with the changed words marked. */
export function LineText({ parts }: { parts: Piece[] }) {
  if (parts.length === 0) return <> </>;
  return (
    <>
      {parts.map((part, index) => {
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
}: {
  hunks: Hunk[];
  picking?: LinePicking;
  language?: string | null;
  /** Before and after side by side, instead of in one column. */
  split?: boolean;
}) {
  const segments = useMemo(() => hunks.map((hunk) => wordSegments(hunk.lines)), [hunks]);
  const syntax = useMemo(() => {
    const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
    return total > MAX_HIGHLIGHT_LINES ? null : hunks.map((hunk) => highlightHunk(hunk.lines, language ?? null));
  }, [hunks, language]);
  const order = useMemo(() => changedKeys(hunks), [hunks]);
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
    <div className={`diff-lines${picking ? " picking" : ""}${split ? " split" : ""}`} role="table" aria-label="Changed lines">
      {hunks.map((hunk, hunkIndex) => {
        const keys = picking ? hunkKeys(hunk) : [];
        const chosenHere = picking ? keys.filter((key) => picking.selected.has(key)) : [];
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
              splitRows(hunk.lines).map(({ left, right }, rowIndex) => {
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
                        <LineText parts={pieces(line.text, syntax?.[hunkIndex][index] ?? null, segments[hunkIndex][index])} />
                      </span>
                    </div>
                  );
                };
                return (
                  <div key={rowIndex} className="diff-split-row" role="row">
                    {half(left, "left")}
                    {half(right, "right")}
                  </div>
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
              return (
                <div key={lineIndex} className={`diff-row ${line.kind}${key ? " pickable" : ""}${chosen ? " chosen" : ""}`} role="row" aria-selected={key ? chosen : undefined}>
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
                    <LineText parts={pieces(line.text, syntax?.[hunkIndex][lineIndex] ?? null, parts)} />
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
