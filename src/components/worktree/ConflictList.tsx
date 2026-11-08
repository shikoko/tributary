import type { Action, FileChange, Lock } from "../../api";
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
  onFileMenu: (file: FileChange, x: number, y: number) => void;
  run: (action: Action, options?: { quiet?: boolean }) => void;
}

/** Conflicted files, each resolved by keeping one side's whole version (best for files that can't be merged), or fixed by hand and staged. */
export function ConflictList({ conflicted, mine, theirs, busy, lockOf, onFileMenu, run }: Props) {
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
        Pick a whole version of each file (best for files that can't be merged, like assets), or fix the file and stage it.
      </div>
      <ul className="file-list">
        {conflicted.map((file) => (
          <FileLine
            key={file.path}
            file={file}
            lock={lockOf(file.path)}
            onContextMenu={onFileMenu}
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
