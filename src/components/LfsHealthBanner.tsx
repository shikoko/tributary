import type { LfsHealth } from "../api";
import { baseName } from "../lib/paths";
import { plural } from "../lib/format";
import { CloseIcon, WarningIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  health: LfsHealth;
  busy: boolean;
  onDownload: () => void;
  onSetUp: () => void;
  /** Open the Git LFS website, to install it. */
  onGetLfs: () => void;
  onDismiss: () => void;
}

/** What to say about `health`, and which button fixes it. */
export function describeLfsHealth(health: LfsHealth): { text: string; fix: "install" | "setUp" | "download" } {
  if (health.notInstalled)
    return {
      text: "This repository stores files with Git LFS, which isn't installed. Until it is, those files are small pointer files, and files can't be locked.",
      fix: "install",
    };
  if (health.notSetUp)
    return { text: "Git LFS is installed but git isn't set up to use it, so files stored with it are small pointer files.", fix: "setUp" };
  const names = health.examples.map(baseName);
  const more = health.pointers - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more.toLocaleString()} more` : names.join(", ");
  return {
    text: `${plural(health.pointers, "file")} stored with Git LFS ${health.pointers === 1 ? "hasn't" : "haven't"} been downloaded${list ? ` (${list})` : ""}.`,
    fix: "download",
  };
}

/** Says when Git LFS files are missing here, and offers to fix it. */
export function LfsHealthBanner({ health, busy, onDownload, onSetUp, onGetLfs, onDismiss }: Props) {
  const { text, fix } = describeLfsHealth(health);
  return (
    <div className="notice-banner" role="status" data-tour="lfs-bar">
      <WarningIcon size={14} />
      <span>{text}</span>
      {fix === "install" && (
        <button className="notice-action" onClick={onGetLfs}>
          Get Git LFS
        </button>
      )}
      {fix === "setUp" && (
        <button className="notice-action" onClick={onSetUp} disabled={busy} title="Runs git lfs install (once for this computer), then downloads the files">
          Set up Git LFS
        </button>
      )}
      {fix === "download" && (
        <button className="notice-action" onClick={onDownload} disabled={busy} title="git lfs pull">
          Download them
        </button>
      )}
      <Button kind="icon" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <CloseIcon size={14} />
      </Button>
    </div>
  );
}
