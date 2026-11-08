import type { Action, DiffSource, FileChange, Lock, Overlap } from "../../api";
import { plural } from "../../lib/format";
import { FileLine } from "../FileLine";
import { PlusIcon } from "../Icons";

interface Props {
  conflicted: FileChange[];
  /** What the two sides are called, like "main" and "feat/x". */
  mine: string;
  theirs: string;
  busy: boolean;
  lockOf: (path: string) => Lock | undefined;
  onFileMenu: (file: FileChange, x: number, y: number, source: DiffSource) => void;
  onOpen: (file: FileChange, source: DiffSource) => void;
  isShown: (path: string, source: DiffSource) => boolean;
  run: (action: Action, options?: { quiet?: boolean }) => void;
  elsewhereOf?: (path: string) => Overlap | undefined;
}

/** Conflicted files, each resolved by keeping one side's whole version (best for files that can't be merged), or fixed by hand and staged. */
const SOURCE: DiffSource = { kind: "unstaged" };

export function ConflictList({ conflicted, mine, theirs, busy, lockOf, onFileMenu, onOpen, isShown, run, elsewhereOf }: Props) {
  const resolve = (paths: string[], keep: "mine" | "theirs") => run({ kind: "resolveConflicts", paths, keep });
  return (
    <section className="files conflicts">
      <h3>
        Conflicts
        <span className="hint">{plural(conflicted.length, "file")}</span>
        <span className="spacer" />
        <button className="link-button" onClick={() => resolve(conflicted.map((file) => file.path), "mine")} disabled={busy} title={`Keep ${mine}'s version of every conflicted file`}>
          All mine
        </button>
        <button className="link-button" onClick={() => resolve(conflicted.map((file) => file.path), "theirs")} disabled={busy} title={`Take ${theirs}'s version of every conflicted file`}>
          All theirs
        </button>
      </h3>
      <div className="conflict-help">
        Pick a whole version of each file (best for files that can't be merged, like assets), or click a text file to resolve its conflicts one by one.
      </div>
      <ul className="file-list">
        {conflicted.map((file) => (
          <FileLine
            key={file.path}
            file={file}
            lock={lockOf(file.path)}
            elsewhere={elsewhereOf?.(file.path)}
            onContextMenu={(file, x, y) => onFileMenu(file, x, y, SOURCE)}
            onOpen={(file) => onOpen(file, SOURCE)}
            shown={isShown(file.path, SOURCE)}
            choices={[
              { label: "Mine", title: `Keep ${mine}'s version`, onClick: () => resolve([file.path], "mine"), disabled: busy },
              { label: "Theirs", title: `Take ${theirs}'s version`, onClick: () => resolve([file.path], "theirs"), disabled: busy },
            ]}
            action={{
              label: "Stage (mark as resolved)",
              icon: <PlusIcon size={13} />,
              onClick: () => run({ kind: "stage", paths: [file.path] }, { quiet: true }),
              disabled: busy,
            }}
          />
        ))}
      </ul>
    </section>
  );
}
