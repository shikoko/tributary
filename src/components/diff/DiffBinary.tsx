import type { FileDiff } from "../../api";
import { formatBytes } from "../../lib/format";
import { ExternalLinkIcon } from "../Icons";

/** What a file was and became, when it isn't shown line by line. */
function sizes(diff: FileDiff): string {
  const { sizeBefore: before, sizeAfter: after } = diff;
  if (before === null && after !== null) return `Added, ${formatBytes(after)}`;
  if (before !== null && after === null) return `Deleted (it was ${formatBytes(before)})`;
  if (before !== null && after !== null) return before === after ? `${formatBytes(after)}, the same size` : `${formatBytes(before)} → ${formatBytes(after)}`;
  return "";
}

interface Props {
  diff: FileDiff;
  /** The tool button's text, like "Open in Meld" or "Choose a diff tool…". */
  tool: string;
  onOpen: () => void;
}

/** Images side by side, or what can be said about another binary file: its sizes, and a way to compare it in your diff tool. */
export function DiffBinary({ diff, tool, onOpen }: Props) {
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
      <span className="muted">
        {diff.tooLarge
          ? "Your diff tool can show it all."
          : diff.lfs
            ? "Its contents aren't text, so they can't be shown line by line here."
            : "Tributary can only show text and images line by line."}
      </span>
      <button className="outline-button diff-message-action" onClick={onOpen}>
        <ExternalLinkIcon size={13} />
        <span className="button-label">{tool}</span>
      </button>
    </div>
  );
}
