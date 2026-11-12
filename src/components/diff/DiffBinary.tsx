import type { FileDiff } from "../../api";
import { describeSizes as sizes } from "../../lib/media";
import { ExternalLinkIcon } from "../Icons";
import { Button } from "../ui/Button";

interface Props {
  diff: FileDiff;
  /** The tool button's text, like "Open in Meld" or "Choose a diff tool…". */
  tool: string;
  onOpen: () => void;
}

/** What can be said about a binary file Tributary can't show: its sizes, and a way to compare it in your diff tool. */
export function DiffBinary({ diff, tool, onOpen }: Props) {
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
            : "Tributary shows text, pictures, sounds, videos and 3D models, but not this kind of file."}
      </span>
      <Button kind="outline" className="diff-message-action" onClick={onOpen}>
        <ExternalLinkIcon size={13} />
        <span className="button-label">{tool}</span>
      </Button>
    </div>
  );
}
