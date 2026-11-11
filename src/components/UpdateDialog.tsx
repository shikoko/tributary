import type { Updates } from "../lib/updates";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

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

/**
 * A newer version: what changed, and Restart now. It downloads in the background first;
 * restarting waits until no git command is running, so nothing is cut off. Not now, it
 * installs when Tributary quits.
 */
export function UpdateDialog({ updates, onClose }: { updates: Updates; onClose: () => void }) {
  const { available, downloading, ready, waiting, error } = updates;
  if (!available) return null;
  const percent = downloading?.percent ?? null;
  return (
    <Dialog
      title={ready ? `Tributary ${available.version} is ready` : `Tributary ${available.version} is available`}
      wide
      error={error && error.step !== "check" ? error.message : null}
      errorAction={
        error?.step === "download"
          ? { label: "Try again", onClick: () => void updates.download() }
          : error?.step === "install"
            ? { label: "Try again", onClick: () => void updates.restart() }
            : null
      }
      onCancel={onClose}
      buttons={
        waiting ? (
          <>
            <span className="update-waiting">Waiting for git to finish…</span>
            <span className="spacer" />
            <Button kind="secondary" onClick={updates.stopWaiting}>
              Don't restart
            </Button>
          </>
        ) : (
          <>
            <Button kind="secondary" onClick={onClose}>
              Later
            </Button>
            <Button kind="primary" onClick={() => void updates.restart()} disabled={!ready} autoFocus={ready}>
              {ready ? "Restart now" : percent === null ? "Downloading…" : `Downloading… ${percent}%`}
            </Button>
          </>
        )
      }
    >
      <p className="hint">
        {available.current && `You have version ${available.current}. `}Restarting installs it, as soon as no git command is running, and your
        tabs open again where you were. Later, it installs when you quit Tributary.
      </p>
      {available.notes && <Notes text={available.notes} />}
      {downloading && (
        <div className="progress-track update-progress">
          <div className={`progress-fill${percent === null ? " indeterminate" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
    </Dialog>
  );
}
