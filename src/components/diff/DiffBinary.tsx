import type { FileDiff } from "../../api";
import { formatBytes } from "../../lib/format";

/** What a file was and became, when it isn't shown line by line. */
function sizes(diff: FileDiff): string {
  const { sizeBefore: before, sizeAfter: after } = diff;
  if (before === null && after !== null) return `Added, ${formatBytes(after)}`;
  if (before !== null && after === null) return `Deleted (it was ${formatBytes(before)})`;
  if (before !== null && after !== null) return before === after ? `${formatBytes(after)}, the same size` : `${formatBytes(before)} → ${formatBytes(after)}`;
  return "";
}

/** Images side by side, or what can be said about another binary file: its sizes. */
export function DiffBinary({ diff }: { diff: FileDiff }) {
  if (diff.images && (diff.images.before || diff.images.after)) {
    return (
      <div className="diff-images">
        {(["before", "after"] as const).map((side) => (
          <figure key={side} className="diff-image">
            <figcaption>{side === "before" ? "Before" : "After"}</figcaption>
            <div className="diff-image-frame">
              {diff.images![side] ? (
                <img src={diff.images![side]!} alt={`${diff.path}, ${side}`} />
              ) : (
                <span className="diff-image-missing">{side === "before" ? "Not there yet" : "Deleted"}</span>
              )}
            </div>
          </figure>
        ))}
        <p className="diff-binary-sizes">{sizes(diff)}</p>
      </div>
    );
  }
  return (
    <div className="diff-message">
      <strong>
        {diff.tooLarge ? "Too long to show here" : diff.lfs ? "Stored with Git LFS" : "Not a text file"}
      </strong>
      <span>{sizes(diff)}</span>
      <span className="muted">Open it in your diff tool to compare the two versions.</span>
    </div>
  );
}
