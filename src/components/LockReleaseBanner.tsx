import type { Lock } from "../api";
import { baseName } from "../lib/paths";
import { CloseIcon, UnlockIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  /** Your locks on files you've just pushed. */
  locks: Lock[];
  busy: boolean;
  onRelease: () => void;
  onKeep: () => void;
  /** Release them now, and from now on without asking. */
  onAlways: () => void;
}

/** After a push: offers to release your locks on the files you pushed, so your teammates can work on them. */
export function LockReleaseBanner({ locks, busy, onRelease, onKeep, onAlways }: Props) {
  const names = locks.map((lock) => baseName(lock.path));
  const what =
    locks.length === 1
      ? `the lock on ${names[0]}`
      : `the locks on ${locks.length} files (${names.slice(0, 3).join(", ")}${locks.length > 3 ? ", …" : ""})`;
  return (
    <div className="notice-banner info" role="status">
      <UnlockIcon size={14} />
      <span>
        You pushed your changes but still hold {what}. Release {locks.length === 1 ? "it" : "them"} so your teammates can work on{" "}
        {locks.length === 1 ? "it" : "them"}?
      </span>
      <Button kind="link" onClick={onAlways} disabled={busy} title="Release them now, and after every push from now on (Settings, Large files and Git LFS)">
        Always
      </Button>
      <button className="notice-action" onClick={onRelease} disabled={busy}>
        <span className="button-label">Release {locks.length === 1 ? "lock" : "locks"}</span>
      </button>
      <Button kind="icon" onClick={onKeep} aria-label="Keep them" title="Keep them">
        <CloseIcon size={14} />
      </Button>
    </div>
  );
}
