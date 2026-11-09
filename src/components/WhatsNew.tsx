import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { Release, WhatsNewIcon } from "../lib/whatsNew";
import { modKey } from "../lib/platform";
import { withAlpha } from "../lib/colors";
import { readSetting } from "../lib/settings";
import { useThemeColors } from "../app/useAppearance";
import { Dialog } from "./Dialog";
import { BellIcon, BranchIcon, CheckIcon, CommitIcon, DownloadIcon, ExternalLinkIcon, Logo, RevertIcon, SearchIcon, SparkleIcon, TeamIcon } from "./Icons";

const ICONS: Record<WhatsNewIcon, (size: number) => ReactNode> = {
  lfs: (size) => <DownloadIcon size={size} />,
  progress: (size) => <BellIcon size={size} />,
  team: (size) => <TeamIcon size={size} />,
  undo: (size) => <RevertIcon size={size} />,
  commit: (size) => <CommitIcon size={size} />,
  setup: (size) => <CheckIcon size={size} />,
  open: (size) => <ExternalLinkIcon size={size} />,
};

const icon = (name: WhatsNewIcon | undefined, size: number) => (name ? ICONS[name](size) : <SparkleIcon size={size} />);

type Item = Release["items"][number] & { version: string };

/** `#rrggbb` a third of the way to white. */
function lighter(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) + (255 - ((value >> shift) & 255)) * 0.35);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Each item in its own graph colour, as chosen in Settings, blending into the next one's. */
function useItemColors() {
  const { lanes } = useThemeColors();
  return (index: number): CSSProperties => {
    const color = lanes[index % lanes.length];
    const next = lanes[(index + 1) % lanes.length];
    return {
      "--wn-color": color,
      "--wn-light": lighter(color),
      "--wn-next": next,
      "--wn-soft": withAlpha(color, 0.16),
      "--wn-faint": withAlpha(color, 0.07),
      "--wn-glow": withAlpha(color, 0.38),
      "--wn-next-soft": withAlpha(next, 0.14),
    } as CSSProperties;
  };
}

const title = (releases: Release[]) => (releases.length === 1 ? `What's new in Tributary ${releases[0].version}` : "What's new in Tributary");
const versions = (releases: Release[]) =>
  releases.length === 1 ? releases[0].version : `${releases[releases.length - 1].version} to ${releases[0].version}`;
const flatten = (releases: Release[]): Item[] => releases.flatMap((release) => release.items.map((item) => ({ ...item, version: release.version })));

/** Which of the looks to show, while one is being chosen. */
function readLook(): "cards" | "graph" | "spotlight" {
  const look = readSetting<string>("whatsNew.look", "cards");
  return look === "graph" || look === "spotlight" ? look : "cards";
}

/** What changed, after an update (or from Help → What's New). */
export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const look = readLook();
  if (look === "graph") return <WhatsNewGraph releases={releases} onClose={onClose} />;
  if (look === "spotlight") return <WhatsNewSpotlight releases={releases} onClose={onClose} />;
  return <WhatsNewCards releases={releases} onClose={onClose} />;
}

const gotIt = (onClose: () => void) => (
  <button className="primary-small-button" onClick={onClose} autoFocus>
    Got it
  </button>
);

/** A banner in the graph colours, then a card for each thing. */
function WhatsNewCards({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const colors = useItemColors();
  const { lanes } = useThemeColors();
  const items = flatten(releases);
  const glow = (index: number, alpha: number) => withAlpha(lanes[index % lanes.length], alpha);
  return (
    <Dialog title={title(releases)} wide onCancel={onClose} className="whats-new-dialog look-cards" buttons={gotIt(onClose)}>
      <header className="wn-hero" style={{ "--wn-a": glow(0, 0.45), "--wn-b": glow(1, 0.34), "--wn-c": glow(4, 0.32) } as CSSProperties}>
        <span className="wn-hero-logo">
          <Logo size={46} />
        </span>
        <span className="wn-hero-text">
          <span className="wn-eyebrow">What's new</span>
          <span className="wn-hero-title">Tributary {versions(releases)}</span>
          <span className="wn-hero-sub">{items.length === 1 ? "One new thing" : `${items.length} new things`} since you last looked</span>
        </span>
      </header>
      <div className="wn-scroll">
        <div className="wn-grid">
          {items.map((item, index) => (
            <article key={`${item.version}-${item.title}`} className={`wn-card${index === 0 ? " featured" : ""}`} style={colors(index)}>
              <span className="wn-tile">{icon(item.icon, index === 0 ? 20 : 16)}</span>
              <span className="wn-card-text">
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </span>
            </article>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Like the commit graph: a version's label, and each thing a commit on its line. */
function WhatsNewGraph({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const colors = useItemColors();
  let index = 0;
  return (
    <Dialog title={title(releases)} wide onCancel={onClose} className="whats-new-dialog look-graph" buttons={gotIt(onClose)}>
      <div className="wn-scroll">
        {releases.map((release) => (
          <section key={release.version} className="wn-release">
            <div className="wn-release-head">
              <span className="wn-pill">
                <CheckIcon size={12} />
                {release.version}
              </span>
              <span className="wn-release-count">{release.items.length === 1 ? "1 new thing" : `${release.items.length} new things`}</span>
            </div>
            <ol className="wn-line">
              {release.items.map((item) => {
                const style = colors(index++);
                return (
                  <li key={item.title} style={style}>
                    <span className="wn-node">{icon(item.icon, 15)}</span>
                    <span className="wn-line-text">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** One thing at a time, large, with the list beside it. */
function WhatsNewSpotlight({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const colors = useItemColors();
  const items = flatten(releases);
  const [at, setAt] = useState(0);
  const item = items[at];
  const last = at === items.length - 1;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") setAt(Math.min(items.length - 1, at + 1));
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") setAt(Math.max(0, at - 1));
    else return;
    event.preventDefault();
  };
  return (
    <Dialog
      title={title(releases)}
      wide
      onCancel={onClose}
      className="whats-new-dialog look-spotlight"
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
      <div className="wn-spotlight" onKeyDown={onKey}>
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

const STEPS: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <Logo size={40} />,
    title: "Welcome to Tributary",
    text: "A git app made for game teams: big files, Git LFS and locks, and pictures, sounds and models shown as what they are. Open, clone or create a repository from the start screen to begin.",
  },
  {
    icon: <BranchIcon size={30} />,
    title: "The graph",
    text: "Every branch and commit, newest at the top. Double-click a branch's label to check it out; right-click anything (a commit, a branch, a file) for what you can do with it.",
  },
  {
    icon: <CommitIcon size={30} />,
    title: "Committing",
    text: "Click Uncommitted changes at the top of the graph: stage files, or just some of their lines, and commit. Big files are offered to Git LFS, and files someone else has locked are flagged before you push.",
  },
  {
    icon: <TeamIcon size={30} />,
    title: "Your team",
    text: "The people button shows who's working on what, and which files are locked. A file you're changing that's being changed on another branch too is pointed out before it becomes a conflict.",
  },
  {
    icon: <RevertIcon size={30} />,
    title: "Nothing's lost",
    text: "Most things can be undone: from the message after you do them, or later from Activity → Your actions. Branches you rewrite or delete are backed up first.",
  },
  {
    icon: <SearchIcon size={30} />,
    title: "Everything, from the keyboard",
    text: `${modKey}K opens the command palette, with every command and its shortcut; ? lists the shortcuts.`,
  },
];

/** A few steps for someone new (or from Help → Welcome Tour). */
export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const { icon, title, text } = STEPS[step];
  return (
    <Dialog
      title="Getting started"
      onCancel={onClose}
      className="welcome-tour"
      buttons={
        <>
          <button className="secondary-button" onClick={onClose}>
            Skip
          </button>
          <span className="spacer" />
          <span className="tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((entry, index) => (
              <button key={entry.title} className={index === step ? "on" : undefined} onClick={() => setStep(index)} aria-label={`Step ${index + 1}: ${entry.title}`} />
            ))}
          </span>
          <span className="spacer" />
          {step > 0 && (
            <button className="secondary-button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="primary-small-button" onClick={() => (last ? onClose() : setStep(step + 1))} autoFocus>
            {last ? "Start" : "Next"}
          </button>
        </>
      }
    >
      <div className="tour-step" key={step}>
        <div className="tour-icon">{icon}</div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </Dialog>
  );
}
