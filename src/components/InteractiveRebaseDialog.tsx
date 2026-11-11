import { useRef, useState } from "react";
import { moved } from "../lib/order";
import type { CommitDetails, CommitRow, RebaseStep, StepAction } from "../api";
import { shortId } from "../lib/format";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { GripIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  branch: string;
  /** The commit the rewritten commits will sit on. */
  onto: CommitRow;
  /** The commits after `onto`, newest first (as in the graph). */
  commits: CommitRow[];
  loadDetails: (id: string) => Promise<CommitDetails>;
  onCancel: () => void;
  /** Start the rebase with these steps, oldest first. */
  onStart: (steps: RebaseStep[]) => void;
}

interface Row {
  commit: CommitRow;
  action: StepAction;
  /** The new message, for reword. */
  message: string;
}

const ACTIONS: { value: StepAction; label: string; title: string }[] = [
  { value: "pick", label: "Pick", title: "Keep the commit as it is" },
  { value: "reword", label: "Reword", title: "Keep the commit, with a new message" },
  { value: "squash", label: "Squash", title: "Combine with the commit below, keeping both messages" },
  { value: "fixup", label: "Fixup", title: "Combine with the commit below, keeping only its message" },
  { value: "drop", label: "Drop", title: "Leave the commit out" },
];


/** Reorder, reword, squash or drop the commits after a commit on the checked-out branch. */
export function InteractiveRebaseDialog({ branch, onto, commits, loadDetails, onCancel, onStart }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    commits.map((commit) => ({ commit, action: "pick", message: commit.summary })),
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  /** Full messages, loaded when a commit is first reworded. */
  const loaded = useRef(new Set<string>());

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const setAction = (index: number, action: StepAction) => {
    update(index, { action });
    const { commit } = rows[index];
    if (action === "reword" && !loaded.current.has(commit.id)) {
      loaded.current.add(commit.id);
      loadDetails(commit.id)
        .then((details) => {
          const full = details.body ? `${details.summary}\n\n${details.body}` : details.summary;
          setRows((current) =>
            current.map((row) => (row.commit.id === commit.id && row.message === commit.summary ? { ...row, message: full } : row)),
          );
        })
        .catch(() => {});
    }
  };

  const startDrag = (index: number, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    let current = index;
    setDragging(index);
    const move = (e: PointerEvent) => {
      const items = [...(list.current?.children ?? [])] as HTMLElement[];
      // The new place: how many of the other rows have their middle above the pointer.
      const target = items.filter((item, i) => {
        if (i === current) return false;
        const rect = item.getBoundingClientRect();
        return rect.top + rect.height / 2 < e.clientY;
      }).length;
      if (target !== current) {
        const from = current;
        setRows((rows) => moved(rows, from, target));
        current = target;
        setDragging(target);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The oldest commit that's kept has nothing below it to combine with.
  const lastKept = rows.map((row) => row.action !== "drop").lastIndexOf(true);
  const problem =
    lastKept < 0
      ? "Every commit is dropped. To do that, hard reset to the commit instead."
      : rows[lastKept].action === "squash" || rows[lastKept].action === "fixup"
        ? `${shortId(rows[lastKept].commit.id)} has no commit below it to combine with. Pick it instead.`
        : rows.some((row) => row.action === "reword" && !row.message.trim())
          ? "Write a message for each commit you reword."
          : null;
  const changed = rows.some((row, i) => row.action !== "pick" || row.commit.id !== commits[i].id);
  const result = rows.filter((row) => row.action === "pick" || row.action === "reword").length;

  return (
    <Dialog
      title={`Interactive rebase of ${branch}`}
      wide
      onCancel={onCancel}
      buttons={
        <>
          <span className="dialog-note">
            {commits.length} {commits.length === 1 ? "commit" : "commits"} → {result} after the rebase
          </span>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={problem !== null || !changed}
            onClick={() =>
              onStart(
                [...rows].reverse().map((row) =>
                  row.action === "reword" ? { id: row.commit.id, action: row.action, message: row.message.trim() } : { id: row.commit.id, action: row.action },
                ),
              )
            }
          >
            Start rebase
          </Button>
        </>
      }
    >
      <p className="hint">
        Rewrites the commits after <span className="mono">{shortId(onto.id)}</span> {onto.summary}. Drag to reorder (or
        Alt+↑/↓), and choose what happens to each one. Newest is at the top.
      </p>
      <ol className={`rebase-list${dragging !== null ? " dragging" : ""}`} ref={list}>
        {rows.map((row, index) => (
          <li
            key={row.commit.id}
            className={`rebase-row ${row.action}${dragging === index ? " lifted" : ""}`}
            tabIndex={0}
            onKeyDown={(event) => {
              if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              const to = index + (event.key === "ArrowUp" ? -1 : 1);
              if (to < 0 || to >= rows.length) return;
              setRows((current) => moved(current, index, to));
              // Keep the keyboard on the row that moved.
              requestAnimationFrame(() => (list.current?.children[to] as HTMLElement | undefined)?.focus());
            }}
          >
            <div className="rebase-main">
              <span className="rebase-grip" onPointerDown={(event) => startDrag(index, event)} title="Drag to reorder">
                <GripIcon size={14} />
              </span>
              <select
                className="rebase-action"
                value={row.action}
                onChange={(event) => setAction(index, event.target.value as StepAction)}
                title={ACTIONS.find((action) => action.value === row.action)?.title}
                aria-label={`What to do with ${shortId(row.commit.id)}`}
              >
                {ACTIONS.map((action) => (
                  <option key={action.value} value={action.value} title={action.title}>
                    {action.label}
                  </option>
                ))}
              </select>
              <span className="mono rebase-sha">{shortId(row.commit.id)}</span>
              <span className="rebase-summary" title={row.commit.summary}>
                {row.action === "squash" || row.action === "fixup" ? "↳ " : ""}
                {row.commit.summary}
              </span>
              <Avatar name={row.commit.authorName} email={row.commit.authorEmail} size={18} />
            </div>
            {row.action === "reword" && (
              <textarea
                className="text-input rebase-message"
                rows={3}
                value={row.message}
                onChange={(event) => update(index, { message: event.target.value })}
                aria-label={`New message for ${shortId(row.commit.id)}`}
                autoFocus
              />
            )}
          </li>
        ))}
      </ol>
      {problem && <div className="dialog-warning">{problem}</div>}
    </Dialog>
  );
}
