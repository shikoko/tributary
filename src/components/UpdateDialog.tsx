import { useEffect, useState } from "react";
import { installUpdate, onUpdateProgress, type UpdateInfo, type UpdateProgress } from "../lib/updates";
import { Dialog } from "./Dialog";

/** Release notes, from GitHub's Markdown: headings, bullet points and paragraphs. */
function Notes({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^<!--.*-->$/.test(line.trim()));
  return (
    <div className="update-notes">
      {lines.map((line, index) => {
        const heading = line.match(/^#+\s*(.*)$/);
        if (heading) return <strong key={index}>{heading[1]}</strong>;
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        // Links to pull requests and people read better as plain text here.
        const text = (bullet ? bullet[1] : line)
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
          // GitHub's generated notes end each change with "by @someone in <link>".
          .replace(/ by @\S+ in https?:\/\/\S+$/, "");
        return bullet ? (
          <div key={index} className="update-note-item">
            <span>•</span>
            <span>{text}</span>
          </div>
        ) : (
          <p key={index}>{text}</p>
        );
      })}
    </div>
  );
}

export function UpdateDialog({ update, onClose }: { update: UpdateInfo; onClose: () => void }) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!installing) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    onUpdateProgress(setProgress)
      .then((unlisten) => (disposed ? unlisten() : (stop = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [installing]);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      // Tributary restarts into the new version when it's installed.
      await installUpdate();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };
  const percent = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  return (
    <Dialog
      title={`Tributary ${update.version} is available`}
      wide
      busy={installing}
      error={error}
      onCancel={onClose}
      buttons={
        <>
          <button className="secondary-button" onClick={onClose} disabled={installing}>
            Later
          </button>
          <button className="primary-small-button" onClick={install} disabled={installing}>
            {installing ? (percent === null ? "Downloading…" : `Downloading… ${percent}%`) : "Install and restart"}
          </button>
        </>
      }
    >
      <p className="hint">
        You have version {update.current}. Installing restarts Tributary, and your tabs open again where you were.
      </p>
      {update.notes && <Notes text={update.notes} />}
      {installing && (
        <div className="progress-track update-progress">
          <div className={`progress-fill${percent === null ? " indeterminate" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
    </Dialog>
  );
}
