import { useEffect, useMemo, useState } from "react";
import { repoSize, type Action, type RepoSize } from "../api";
import { formatBytes, plural } from "../lib/format";
import { kindOf } from "../lib/repoSize";
import { Dialog } from "./Dialog";

/**
 * What makes the repository big: everything ever committed stays in its history, so the
 * biggest files (deleted ones too), and what each folder and kind of file costs. Kinds of
 * big file can move into Git LFS: from now on, or by rewriting history.
 */
export function RepoSizeDialog({
  repoPath,
  canChange,
  branch,
  onClose,
  run,
}: {
  repoPath: string;
  canChange: boolean;
  /** The checked-out branch. */
  branch: string | null;
  onClose: () => void;
  run: (action: Action) => void;
}) {
  const [size, setSize] = useState<RepoSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [everything, setEverything] = useState(false);
  useEffect(() => {
    let current = true;
    repoSize(repoPath)
      .then((found) => current && setSize(found))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath]);

  // The kinds of big file that aren't in Git LFS: the ones worth moving.
  const offered = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const file of size?.biggest ?? []) {
      if (file.inLfs || file.bytes < 100_000) continue;
      const kind = kindOf(file.path);
      kinds.set(kind, (kinds.get(kind) ?? 0) + file.diskBytes);
    }
    return [...kinds.entries()].sort((a, b) => b[1] - a[1]);
  }, [size]);
  const patterns = [...chosen];
  // Each file once: its biggest version, how many of its versions are among the biggest,
  // and whether it's still in the latest commit.
  const files = useMemo(() => {
    const byPath = new Map<string, { path: string; bytes: number; versions: number; current: boolean; inLfs: boolean }>();
    for (const file of size?.biggest ?? []) {
      const known = byPath.get(file.path);
      if (known) {
        known.versions++;
        known.bytes = Math.max(known.bytes, file.bytes);
        known.current ||= file.current;
      } else byPath.set(file.path, { path: file.path, bytes: file.bytes, versions: 1, current: file.current, inLfs: file.inLfs });
    }
    return [...byPath.values()].slice(0, 10);
  }, [size]);
  const largest = Math.max(1, ...(size?.folders ?? []).map((group) => group.diskBytes), ...(size?.kinds ?? []).map((group) => group.diskBytes));

  return (
    <Dialog
      title="What makes this repository big"
      error={error}
      wide
      onCancel={onClose}
      buttons={
        <>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <span className="spacer" />
          {offered.length > 0 && (
            <>
              <button
                className="outline-button"
                disabled={!canChange || patterns.length === 0}
                title="New versions go into Git LFS; what's in the history stays"
                onClick={() => {
                  onClose();
                  run({ kind: "trackWithLfs", patterns, paths: [] });
                }}
              >
                <span className="button-label">Into Git LFS from now on</span>
              </button>
              <button
                className={everything ? "danger-outline-button" : "primary-small-button"}
                disabled={!canChange || patterns.length === 0 || !branch}
                onClick={() => {
                  onClose();
                  run({ kind: "migrateToLfs", patterns, everything });
                }}
              >
                {everything ? "Rewrite every branch" : `Rewrite ${branch ?? "the branch"}'s new commits`}
              </button>
            </>
          )}
        </>
      }
    >
      {!size ? (
        !error && <p className="muted">Looking through the whole history… (a big repository takes a while)</p>
      ) : (
        <div className="repo-size">
          <p>
            The history takes <strong>{formatBytes(size.historyBytes)}</strong> on disk: {plural(size.versions, "file version")}. Everyone who
            clones the repository downloads all of it, deleted files included (Git LFS files aside).
          </p>
          <div className="repo-size-groups">
            {[
              ["By folder", size.folders],
              ["By kind of file", size.kinds],
            ].map(([title, groups]) => (
              <section key={title as string}>
                <h3>{title as string}</h3>
                <ul>
                  {(groups as RepoSize["folders"]).map((group) => (
                    <li key={group.name} title={`${plural(group.versions, "version")}, ${formatBytes(group.diskBytes)}`}>
                      <span className="repo-size-name mono">{group.name}</span>
                      <span className="repo-size-bar">
                        <span style={{ width: `${Math.max(1, (group.diskBytes / largest) * 100)}%` }} />
                      </span>
                      <span className="repo-size-amount">{formatBytes(group.diskBytes)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <h3>The biggest files</h3>
          <ul className="repo-size-files">
            {files.map((file) => (
              <li key={file.path}>
                <span className="repo-size-name mono" title={file.path}>
                  {file.path}
                </span>
                {file.versions > 1 && <span className="repo-size-tag">{file.versions} versions</span>}
                {!file.current && <span className="repo-size-tag">deleted</span>}
                {file.inLfs && <span className="repo-size-tag lfs">in Git LFS now</span>}
                <span className="repo-size-amount">{formatBytes(file.bytes)}</span>
              </li>
            ))}
          </ul>
          {offered.length > 0 && (
            <div className="repo-size-move">
              <h3>Move into Git LFS</h3>
              <div className="repo-size-kinds">
                {offered.map(([kind, bytes]) => (
                  <label key={kind} className="checkbox">
                    <input
                      type="checkbox"
                      checked={chosen.has(kind)}
                      onChange={(event) =>
                        setChosen((now) => {
                          const next = new Set(now);
                          if (event.target.checked) next.add(kind);
                          else next.delete(kind);
                          return next;
                        })
                      }
                    />
                    <span className="mono">{kind}</span>
                    <span className="muted">{formatBytes(bytes)}</span>
                  </label>
                ))}
              </div>
              <p className="dialog-note-line">
                <strong>From now on</strong> keeps the history as it is. <strong>Rewriting</strong> takes them out of the history too: the
                commits get new ids (backed up first, for Restore Branch).
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={everything} onChange={(event) => setEverything(event.target.checked)} />
                Every branch's whole history, not only {branch ?? "this branch"}'s commits that aren't pushed yet. Every branch then needs
                force-pushing, and everyone else has to clone again.
              </label>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
