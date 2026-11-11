import { installCommandLineTools } from "../api";
import type { GitInstallState } from "../app/useGitInstall";
import { isMac, isWindows } from "../lib/platform";
import { openInBrowser } from "../lib/weblinks";
import { RefreshIcon, WarningIcon } from "./Icons";

const GIT_FOR_WINDOWS = "https://git-scm.com/download/win";
const GIT_DOWNLOADS = "https://git-scm.com/downloads";

/** This computer, as people call it. */
const computer = isMac ? "this Mac" : "this PC";

/** The button that gets git on this system, if there's one to press. */
function GetGit({ install }: { install: GitInstallState }) {
  if (isMac && install.install?.needsCommandLineTools)
    return (
      <button className="primary-small-button" onClick={() => installCommandLineTools().catch(() => openInBrowser(GIT_DOWNLOADS))}>
        Install the Command Line Tools
      </button>
    );
  if (isWindows)
    return (
      <button className="primary-small-button" onClick={() => openInBrowser(GIT_FOR_WINDOWS)} data-url={GIT_FOR_WINDOWS}>
        Get Git for Windows
      </button>
    );
  if (isMac)
    return (
      <button className="primary-small-button" onClick={() => openInBrowser(GIT_DOWNLOADS)} data-url={GIT_DOWNLOADS}>
        Get git
      </button>
    );
  return null;
}

function CheckAgain({ install, className = "secondary-button" }: { install: GitInstallState; className?: string }) {
  return (
    <button className={className} onClick={() => void install.lookAgain().catch(() => {})} disabled={install.checking}>
      <RefreshIcon size={13} className={install.checking ? "spin" : undefined} />
      <span className="button-label">{install.checking ? "Checking…" : "Check again"}</span>
    </button>
  );
}

/** How to get git here, in a sentence. */
function howTo(install: GitInstallState): string {
  if (isMac && install.install?.needsCommandLineTools)
    return "Apple's Command Line Tools bring it: install them (it takes a few minutes), or install git with Homebrew (brew install git).";
  if (isMac) return "Install it from git-scm.com, or with Homebrew (brew install git).";
  if (isWindows) return "Install Git for Windows (the standard options are fine), then come back.";
  return "Install it with your package manager, like sudo apt install git or sudo dnf install git.";
}

/** On the start screen: Tributary can't do much without git, so this comes first. */
export function GitNeededCard({ install }: { install: GitInstallState }) {
  return (
    <section className="git-needed" role="alert">
      <div className="git-needed-head">
        <WarningIcon size={16} />
        <strong>Tributary needs git</strong>
      </div>
      <p>
        It runs your own git for everything it does, so cloning, committing and syncing work just as they do on the command line, and git
        isn't installed on {computer}. {howTo(install)}
      </p>
      <div className="git-needed-buttons">
        <GetGit install={install} />
        <CheckAgain install={install} />
      </div>
    </section>
  );
}

/** Over a repository: what's missing, and the same ways to fix it. */
export function GitNeededBanner({ install }: { install: GitInstallState }) {
  return (
    <div className="notice-banner git-needed-banner" role="alert">
      <WarningIcon size={14} />
      <span>git isn't installed on {computer}, so changes, syncing and everything else that runs git can't work yet. {howTo(install)}</span>
      <GetGit install={install} />
      <CheckAgain install={install} className="notice-action" />
    </div>
  );
}

/** git is there, but older than everything needs. */
export function GitOldNote({ install }: { install: GitInstallState }) {
  return (
    <p className="git-old">
      git {install.install?.version} works, but checking a merge before doing it needs git 2.38 or newer.{" "}
      <button className="link-button" onClick={() => openInBrowser(isWindows ? GIT_FOR_WINDOWS : GIT_DOWNLOADS)} data-url={isWindows ? GIT_FOR_WINDOWS : GIT_DOWNLOADS}>
        Get a newer git
      </button>
    </p>
  );
}
