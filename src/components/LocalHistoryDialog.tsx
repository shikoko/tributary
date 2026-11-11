import { useCallback, useEffect, useMemo, useState } from "react";
import { localHistory, takeSnapshot, type Action, type Snapshot } from "../api";
import { plural } from "../lib/format";
import { useStoredState } from "../lib/settings";
import { baseName, folderOf } from "../lib/paths";
import { Dialog } from "./Dialog";
import { HistoryIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  repoPath: string;
  /** Only the snapshots of this file. */
  file?: string;
  canChange: boolean;
  /** Runs a git action (closing this first). */
  run: (action: Action) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** "Today", "Yesterday", or the date. */
function dayOf(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const timeOf = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Local history: snapshots of uncommitted work, taken every few minutes, to put files back
 * as they were. Restoring snapshots what they are now first, so Undo brings that back.
 */
export function LocalHistoryDialog({ repoPath, file, canChange, run, onOpenSettings, onClose }: Props) {
  // The settings: how often (minutes, 0 for never), how big a file can be (MB), how long they're kept (days).
  const [minutes] = useStoredState("history.minutes", 10);
  const [maxMB] = useStoredState("history.maxMB", 50);
  const [days] = useStoredState("history.days", 7);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const load = useCallback(() => {
    localHistory(repoPath)
      .then((found) => {
        const shown = file ? found.filter((snapshot) => snapshot.files.some((each) => each.path === file)) : found;
        setSnapshots(shown);
        setChosen((now) => (now && shown.some((snapshot) => snapshot.reference === now) ? now : (shown[0]?.reference ?? null)));
      })
      .catch((e) => setError(String(e)));
  }, [repoPath, file]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const groups: { day: string; snapshots: Snapshot[] }[] = [];
    for (const snapshot of snapshots ?? []) {
      const day = dayOf(snapshot.time);
      let last = groups[groups.length - 1];
      if (last?.day !== day) {
        last = { day, snapshots: [] };
        groups.push(last);
      }
      last.snapshots.push(snapshot);
    }
    return groups;
  }, [snapshots]);
  const selected = snapshots?.find((snapshot) => snapshot.reference === chosen) ?? null;
  const files = selected ? (file ? selected.files.filter((each) => each.path === file) : selected.files) : [];

  const restore = (paths: string[]) => {
    if (!selected) return;
    onClose();
    run({ kind: "restoreFromHistory", reference: selected.reference, paths });
  };
  const takeOne = async () => {
    setTaking(true);
    setError(null);
    try {
      const taken = await takeSnapshot(repoPath, maxMB * 1_000_000, days);
      if (!taken) setError("Nothing new to keep: your changes are as the last snapshot has them.");
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setTaking(false);
    }
  };

  return (
    <Dialog
      title={file ? `Local history of ${baseName(file)}` : "Local history"}
      wide
      className="local-history-dialog"
      error={error}
      onCancel={onClose}
      buttons={
        <>
          <Button kind="secondary" onClick={() => void takeOne()} disabled={taking || !canChange}>
            {taking ? "Keeping…" : "Keep a snapshot now"}
          </Button>
          <span className="spacer" />
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
          {files.length > 1 && (
            <Button kind="primary" disabled={!canChange} onClick={() => restore(files.map((each) => each.path))}>
              Restore all {files.length}
            </Button>
          )}
        </>
      }
    >
      <p className="dialog-note-line">
        {minutes > 0 ? (
          <>
            Your uncommitted work, kept every {minutes} minutes for {days === 1 ? "a day" : `${days} days`} (files up to {maxMB >= 1000 ? `${maxMB / 1000} GB` : `${maxMB} MB`}).
            Restoring a file puts it back as it was then; what it is now is kept too, so Undo brings it back.{" "}
          </>
        ) : (
          <>Snapshots aren't kept now. </>
        )}
        <Button kind="link" onClick={onOpenSettings}>
          Settings
        </Button>
      </p>
      {snapshots === null ? (
        <p className="shelves-empty">Looking…</p>
      ) : snapshots.length === 0 ? (
        <p className="shelves-empty">{file ? "No snapshots of this file yet." : "No snapshots yet. They're kept while you have uncommitted changes."}</p>
      ) : (
        <div className="history-columns">
          <div className="history-times" role="listbox" aria-label="Snapshots">
            {byDay.map((group) => (
              <div key={group.day}>
                <div className="history-day">{group.day}</div>
                {group.snapshots.map((snapshot) => (
                  <button
                    key={snapshot.reference}
                    role="option"
                    aria-selected={snapshot.reference === chosen}
                    className={`history-time${snapshot.reference === chosen ? " on" : ""}`}
                    onClick={() => setChosen(snapshot.reference)}
                  >
                    <HistoryIcon size={12} />
                    <span className="history-clock">{timeOf(snapshot.time)}</span>
                    <span className="history-count">{plural(snapshot.files.length, "file")}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <ul className="history-files">
            {files.map((each) => (
              <li key={each.path}>
                <span className={`shelf-change ${each.change}`}>{each.change === "added" ? "A" : each.change === "deleted" ? "D" : "M"}</span>
                <span className="history-file-name">{baseName(each.path)}</span>
                <span className="history-file-dir">{folderOf(each.path)}</span>
                <Button
                  kind="outline"
                  disabled={!canChange}
                  title={each.change === "deleted" ? "It had been deleted then: delete it again" : `Put ${baseName(each.path)} back as it was at ${selected ? timeOf(selected.time) : ""}`}
                  onClick={() => restore([each.path])}
                >
                  <span className="button-label">Restore</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
