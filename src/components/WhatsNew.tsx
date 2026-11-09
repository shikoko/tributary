import { useState, type ReactNode } from "react";
import type { Release } from "../lib/whatsNew";
import { modKey } from "../lib/platform";
import { Dialog } from "./Dialog";
import { BranchIcon, CommitIcon, Logo, RevertIcon, SearchIcon, TeamIcon } from "./Icons";

/** What changed, after an update (or from Help → What's New). */
export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  return (
    <Dialog
      title={releases.length === 1 ? `What's new in Tributary ${releases[0].version}` : "What's new in Tributary"}
      wide
      onCancel={onClose}
      buttons={
        <button className="primary-small-button" onClick={onClose} autoFocus>
          Got it
        </button>
      }
    >
      <div className="whats-new">
        {releases.map((release) => (
          <section key={release.version}>
            {releases.length > 1 && <h3 className="whats-new-version">{release.version}</h3>}
            <ul>
              {release.items.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
