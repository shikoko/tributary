import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Release, WhatsNewIcon } from "../lib/whatsNew";
import { withAlpha } from "../lib/colors";
import { useThemeColors } from "../app/useAppearance";
import { Dialog } from "./Dialog";
import {
  BellIcon,
  CheckIcon,
  CommitIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HistoryIcon,
  PullIcon,
  RevertIcon,
  ShelfIcon,
  SparkleIcon,
  TeamIcon,
  ViewIcon,
} from "./Icons";

const ICONS: Record<WhatsNewIcon, (size: number) => ReactNode> = {
  lfs: (size) => <DownloadIcon size={size} />,
  progress: (size) => <BellIcon size={size} />,
  team: (size) => <TeamIcon size={size} />,
  undo: (size) => <RevertIcon size={size} />,
  commit: (size) => <CommitIcon size={size} />,
  setup: (size) => <CheckIcon size={size} />,
  open: (size) => <ExternalLinkIcon size={size} />,
  simple: (size) => <ViewIcon size={size} />,
  shelf: (size) => <ShelfIcon size={size} />,
  history: (size) => <HistoryIcon size={size} />,
  schedule: (size) => <PullIcon size={size} />,
  disk: (size) => <DownloadIcon size={size} />,
};

const icon = (name: WhatsNewIcon | undefined, size: number) => (name ? ICONS[name](size) : <SparkleIcon size={size} />);

type Item = Release["items"][number] & { version: string };

/** `#rrggbb` a third of the way to white. */
function lighter(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) + (255 - ((value >> shift) & 255)) * 0.35);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Each item in its own graph colour, as chosen in Settings (with a glow of the next one's). */
function useItemColors() {
  const { lanes } = useThemeColors();
  return (index: number): CSSProperties => {
    const color = lanes[index % lanes.length];
    const next = lanes[(index + 1) % lanes.length];
    return {
      "--wn-color": color,
      "--wn-light": lighter(color),
      "--wn-soft": withAlpha(color, 0.16),
      "--wn-faint": withAlpha(color, 0.08),
      "--wn-glow": withAlpha(color, 0.38),
      "--wn-next-soft": withAlpha(next, 0.14),
    } as CSSProperties;
  };
}

const title = (releases: Release[]) => (releases.length === 1 ? `What's new in Tributary ${releases[0].version}` : "What's new in Tributary");

/**
 * What changed, after an update (or from Help → What's New): one thing at a time, large,
 * with the list of them beside it.
 */
export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const colors = useItemColors();
  const items: Item[] = releases.flatMap((release) => release.items.map((item) => ({ ...item, version: release.version })));
  const [at, setAt] = useState(0);
  const item = items[at];
  const last = at === items.length - 1;
  // The arrow keys step through them, wherever the focus is in the dialog.
  const count = items.length;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") setAt((now) => Math.min(count - 1, now + 1));
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") setAt((now) => Math.max(0, now - 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);
  return (
    <Dialog
      title={title(releases)}
      wide
      onCancel={onClose}
      closable
      className="whats-new-dialog"
      buttons={
        <>
          <span className="wn-step">
            {at + 1} of {items.length}
          </span>
          <span className="spacer" />
          {at > 0 && (
            <button className="secondary-button" onClick={() => setAt(at - 1)}>
              Back
            </button>
          )}
          <button className="primary-small-button" onClick={() => (last ? onClose() : setAt(at + 1))} autoFocus>
            {last ? "Got it" : "Next"}
          </button>
        </>
      }
    >
      <div className="wn-spotlight">
        <div className="wn-nav" role="tablist" aria-orientation="vertical">
          {items.map((entry, index) => (
            <button
              key={`${entry.version}-${entry.title}`}
              role="tab"
              aria-selected={index === at}
              className={index === at ? "on" : undefined}
              style={colors(index)}
              onClick={() => setAt(index)}
            >
              <span className="wn-nav-tile">{icon(entry.icon, 13)}</span>
              {entry.title}
            </button>
          ))}
        </div>
        <div className="wn-stage" key={at} style={colors(at)} role="tabpanel">
          <div className="wn-art">
            <span className="wn-ring one" />
            <span className="wn-ring two" />
            <span className="wn-ring three" />
            <span className="wn-art-tile">{icon(item.icon, 30)}</span>
          </div>
          <span className="wn-stage-version">New in {item.version}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </div>
      </div>
    </Dialog>
  );
}
