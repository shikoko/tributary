import { useEffect, useMemo, useRef } from "react";
import type { Hunk, LineMode } from "../../api";
import { changedKeys, hunkKeys, keysBetween, lineKey } from "../../lib/lineSelection";
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

/** A text file's changes: each stretch of changed lines with its line numbers, the changed words marked. */
export function DiffLines({ hunks, picking }: { hunks: Hunk[]; picking?: LinePicking }) {
  const segments = useMemo(() => hunks.map((hunk) => wordSegments(hunk.lines)), [hunks]);
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
    <div className={`diff-lines${picking ? " picking" : ""}`} role="table" aria-label="Changed lines">
      {hunks.map((hunk, hunkIndex) => {
        const keys = picking ? hunkKeys(hunk) : [];
        const chosenHere = picking ? keys.filter((key) => picking.selected.has(key)) : [];
        return (
          <div key={hunkIndex} className="diff-hunk" role="rowgroup">
            <div className="diff-hunk-header" role="row">
              <span className="diff-hunk-dots">⋯</span>
              {hunk.section && <span className="diff-hunk-section">{hunk.section}</span>}
              {picking && keys.length > 0 && (
                <span className="diff-hunk-actions">
                  {picking.side === "unstaged" ? (
                    <>
                      <button
                        className="hunk-button"
                        disabled={picking.busy}
                        onClick={() => picking.onApply("discard", keys)}
                        title="Undo these changes in the file (you can put them back)"
                      >
                        Discard
                      </button>
                      <button className="hunk-button primary" disabled={picking.busy} onClick={() => picking.onApply("stage", keys)} title="Stage these changes">
                        Stage
                      </button>
                    </>
                  ) : (
                    <button className="hunk-button primary" disabled={picking.busy} onClick={() => picking.onApply("unstage", keys)} title="Take these changes out of what's staged">
                      Unstage
                    </button>
                  )}
                  {chosenHere.length > 0 && <span className="hunk-chosen">{chosenHere.length} chosen</span>}
                </span>
              )}
            </div>
            {hunk.lines.map((line, lineIndex) => {
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
                  <span className="diff-number" aria-label={line.old ? `Line ${line.old} before` : undefined} {...pick}>
                    {line.old ?? ""}
                  </span>
                  <span className="diff-number" aria-label={line.new ? `Line ${line.new} after` : undefined} {...pick}>
                    {line.new ?? ""}
                  </span>
                  <span className="diff-sign" aria-hidden {...pick}>
                    {SIGNS[line.kind]}
                  </span>
                  <span className="diff-text">
                    {parts
                      ? parts.map((part, index) => (part.changed ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))
                      : line.text || " "}
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
