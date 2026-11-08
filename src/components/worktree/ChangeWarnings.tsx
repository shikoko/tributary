import type { Action, FileChange, FileChecks, Lock } from "../../api";
import { formatBytes, plural } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { LockIcon, WarningIcon } from "../Icons";

/** "*.umap" for "Content/Maps/Level.umap"; the path itself for a file without an extension. */
export function lfsPattern(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `*${name.slice(dot)}` : path;
}

interface Props {
  staged: FileChange[];
  unstaged: FileChange[];
  lockOf: (path: string) => Lock | undefined;
  /** Big files outside Git LFS and lockable files among the changes. */
  checks: FileChecks | null;
  /** The repository's server supports locking. */
  canLock: boolean;
  busy: boolean;
  run: (action: Action) => void;
}

/**
 * What to know before committing: changed files someone else has locked (pushing them
 * will be refused), big files that would go into git itself (with buttons to track them
 * with Git LFS), and lockable files nobody has locked yet.
 */
export function ChangeWarnings({ staged, unstaged, lockOf, checks, canLock, busy, run }: Props) {
  const lockedByOthers = [...staged, ...unstaged].filter((file) => {
    const lock = lockOf(file.path);
    return lock && !lock.mine;
  });
  const lockHolders = [...new Set(lockedByOthers.map((file) => lockOf(file.path)!.owner || "someone else"))];
  // Grouped by the LFS pattern that would catch them.
  const large = checks?.large ?? [];
  const stagedPaths = new Set(staged.map((file) => file.path));
  const patterns = [...new Set(large.map((file) => lfsPattern(file.path)))];
  const unlocked = canLock ? (checks?.lockable ?? []).filter((path) => !lockOf(path)) : [];
  return (
    <>
    {lockedByOthers.length > 0 && (
      <div className="lock-warning" role="status">
        <LockIcon size={13} />
        <span>
          {lockedByOthers.length === 1 ? (
            <>
              <strong>{lockedByOthers[0].path.split("/").pop()}</strong> is locked by {lockHolders[0]}
            </>
          ) : (
            <>
              {plural(lockedByOthers.length, "changed file")} are locked by {lockHolders.join(", ")}
            </>
          )}
          . You won't be able to push {lockedByOthers.length === 1 ? "your changes to it" : "them"} until{" "}
          {lockedByOthers.length === 1 ? "it's" : "they're"} unlocked.
        </span>
      </div>
    )}
    {large.length > 0 && (
      <div className="file-warning large" role="status">
        <WarningIcon size={14} />
        <div>
          <div>
            {large.length === 1 ? (
              <>
                <strong>{baseName(large[0].path)}</strong> ({formatBytes(large[0].size)}) isn't stored with Git LFS.
              </>
            ) : (
              <>
                {large.length} big files ({formatBytes(large.reduce((sum, file) => sum + file.size, 0))}) aren't stored with
                Git LFS.
              </>
            )}{" "}
            Committed like this, everyone who clones the repository downloads {large.length === 1 ? "it" : "them"} forever.
          </div>
          <div className="file-warning-actions">
            {patterns.map((pattern) => (
              <button
                key={pattern}
                className="outline-button small"
                disabled={busy}
                onClick={() =>
                  run({
                    kind: "trackWithLfs",
                    patterns: [pattern],
                    paths: large.filter((file) => lfsPattern(file.path) === pattern && stagedPaths.has(file.path)).map((file) => file.path),
                  })
                }
              >
                Track {pattern} with LFS
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    {unlocked.length > 0 && (
      <div className="file-warning lockable" role="status">
        <LockIcon size={14} />
        <div>
          <div>
            {unlocked.length === 1 ? <strong>{baseName(unlocked[0])}</strong> : `${unlocked.length} files you changed`} can be
            locked, and nobody has. Lock {unlocked.length === 1 ? "it" : "them"} before someone else starts on{" "}
            {unlocked.length === 1 ? "it" : "them"}.
          </div>
          <div className="file-warning-actions">
            <button className="outline-button small" disabled={busy} onClick={() => run({ kind: "lockFiles", paths: unlocked })}>
              {unlocked.length === 1 ? "Lock it" : `Lock ${unlocked.length} files`}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
