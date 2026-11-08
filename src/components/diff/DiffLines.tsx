import { useMemo } from "react";
import type { Hunk } from "../../api";
import { wordSegments } from "../../lib/wordDiff";

const SIGNS = { added: "+", removed: "−", context: " " } as const;

/** A text file's changes: each stretch of changed lines with its line numbers, the changed words marked. */
export function DiffLines({ hunks }: { hunks: Hunk[] }) {
  const segments = useMemo(() => hunks.map((hunk) => wordSegments(hunk.lines)), [hunks]);
  return (
    <div className="diff-lines" role="table" aria-label="Changed lines">
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className="diff-hunk" role="rowgroup">
          <div className="diff-hunk-header" role="row">
            <span className="diff-hunk-dots">⋯</span>
            {hunk.section && <span className="diff-hunk-section">{hunk.section}</span>}
          </div>
          {hunk.lines.map((line, lineIndex) => {
            const parts = segments[hunkIndex][lineIndex];
            return (
              <div key={lineIndex} className={`diff-row ${line.kind}`} role="row">
                <span className="diff-number" aria-label={line.old ? `Line ${line.old} before` : undefined}>
                  {line.old ?? ""}
                </span>
                <span className="diff-number" aria-label={line.new ? `Line ${line.new} after` : undefined}>
                  {line.new ?? ""}
                </span>
                <span className="diff-sign" aria-hidden>
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
      ))}
    </div>
  );
}
