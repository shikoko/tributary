import { SUBMODULE_EXPLAINED } from "../lib/submodules";
import { CloseIcon, SubmoduleIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  notice: { text: string; action: string };
  busy: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
  /** Update them after every checkout and pull from now on. */
  onAlways: (() => void) | null;
}

/** Submodules left behind by a checkout or pull (or never set up), with a button to update them. */
export function SubmoduleBanner({ notice, busy, onUpdate, onDismiss, onAlways }: Props) {
  return (
    <div className="notice-banner info" role="status">
      <SubmoduleIcon size={14} />
      <span title={SUBMODULE_EXPLAINED}>{notice.text}</span>
      {onAlways && (
        <Button kind="link" onClick={onAlways} disabled={busy} title="Update them now, and after every checkout and pull from now on (Settings, General)">
          Always
        </Button>
      )}
      <button className="notice-action" onClick={onUpdate} disabled={busy}>
        <span className="button-label">{notice.action}</span>
      </button>
      <Button kind="icon" onClick={onDismiss} aria-label="Not now" title="Not now">
        <CloseIcon size={14} />
      </Button>
    </div>
  );
}
