import { useEffect, useState } from "react";
import type { CommitDetails, CommitRow } from "../api";
import { plural, shortId } from "../lib/format";
import { baseName } from "../lib/paths";
import { Dialog } from "./Dialog";
import { FileKindIcon } from "./FileKindIcon";
import { Loader } from "./Loader";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

/**
 * Split a commit in two: choose the files that move into a new commit right after it, and
 * both commits' messages. The files end up exactly as they were; uncommitted changes aren't
 * touched.
 */
export function SplitCommitDialog({
  commit,
  later,
  loadDetails,
  onCancel,
  onSplit,
}: {
  commit: CommitRow;
  /** How many commits come after it on the branch (they're made again on top). */
  later: number;
  loadDetails: (id: string) => Promise<CommitDetails>;
  onCancel: () => void;
  onSplit: (paths: string[], first: string, second: string) => void;
}) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<Set<string>>(new Set());
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  useEffect(() => {
    let current = true;
    loadDetails(commit.id)
      .then((found) => {
        if (!current) return;
        setDetails(found);
        setFirst(found.body ? `${found.summary}\n\n${found.body}` : found.summary);
      })
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  // A new loader each render does the same: only another commit is worth loading again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit.id]);

  const files = details?.files ?? [];
  const toggle = (path: string) =>
    setMoving((now) => {
      const next = new Set(now);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const keeping = files.length - moving.size;
  const ready = moving.size > 0 && keeping > 0 && first.trim() !== "" && second.trim() !== "";
  // A renamed file moves as both its names.
  const paths = files.filter((file) => moving.has(file.path)).flatMap((file) => (file.oldPath ? [file.oldPath, file.path] : [file.path]));
  return (
    <Dialog
      title={`Split ${shortId(commit.id)} in two`}
      error={error}
      wide
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="primary" disabled={!ready} onClick={() => onSplit(paths, first, second)}>
            Split it
          </Button>
        </>
      }
    >
      {!details ? (
        !error && <Loader size={56} title="Reading the commit" />
      ) : files.length < 2 ? (
        <p>It changes only one file: there's nothing to split.</p>
      ) : (
        <div className="dialog-form split-commit">
          <p className="dialog-note-line">
            Tick the files that move into a new commit right after it. They end up just as they are now
            {later > 0 ? `; the ${plural(later, "commit")} after it ${later === 1 ? "is" : "are"} made again on top` : ""}.
          </p>
          <ul className="split-files">
            {files.map((file) => (
              <li key={file.path}>
                <label className="checkbox" title={file.path}>
                  <input type="checkbox" checked={moving.has(file.path)} onChange={() => toggle(file.path)} />
                  <FileKindIcon path={file.path} size={14} className="file-kind" />
                  <span className="mono">{baseName(file.path)}</span>
                  <span className="muted split-folder">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</span>
                </label>
              </li>
            ))}
          </ul>
          <Field label={<>First commit: {plural(keeping, "file")}</>}>
            <textarea className="text-input" rows={2} value={first} onChange={(event) => setFirst(event.target.value)} spellCheck />
          </Field>
          <Field label={<>New commit: {plural(moving.size, "file")}</>}>
            <textarea
              className="text-input"
              rows={2}
              value={second}
              onChange={(event) => setSecond(event.target.value)}
              placeholder="What these files change"
              spellCheck
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
