import { useEffect, useRef, type ReactNode } from "react";
import { isBeta, type Updates } from "../lib/updates";
import { relativeTime } from "../lib/format";
import { useNow } from "../lib/useNow";
import { openInBrowser, TRIBUTARY_ON_GITHUB } from "../lib/weblinks";
import { Dialog } from "./Dialog";
import { CheckIcon, DownloadIcon, ExternalLinkIcon, InfoIcon, Logo, NotesIcon, RefreshIcon, SparkleIcon, WarningIcon } from "./Icons";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";
import { Chip } from "./ui/Chip";

const SOURCE = TRIBUTARY_ON_GITHUB;
/** Opening About checks again when the last check is older than this. */
const STALE = 10 * 60 * 1000;

interface Props {
  version: string | null;
  updates: Updates;
  auto: boolean;
  setAuto: (auto: boolean) => void;
  /** Betas too: a version of what's coming, from each change merged. */
  beta: boolean;
  setBeta: (beta: boolean) => void;
  /** The newer version's notes, and Restart now. */
  onInstall: () => void;
  onWhatsNew: () => void;
  onLicences: () => void;
  onClose: () => void;
}

/** What the last check found, with the one thing to do about it. */
function UpdateStatus({ updates, onInstall }: Pick<Props, "updates" | "onInstall">) {
  // Every half minute, so "checked just now" grows older while the window is open.
  const now = useNow(30_000);
  const { available, checking, checkedAt, downloading, ready, waiting, error, check } = updates;
  const again = (label: string, retry = check) => (
    <Button kind="secondary" onClick={() => void retry()} disabled={checking}>
      {label}
    </Button>
  );
  const whatsNew = available && (
    <Button kind="link" onClick={onInstall}>
      What's new
    </Button>
  );
  let tone: string;
  let icon: ReactNode;
  let title: string;
  let detail: ReactNode;
  let action: ReactNode = null;
  if (waiting) {
    tone = "available";
    icon = <RefreshIcon size={16} className="spin" />;
    title = "Restarting when git is done…";
    detail = "Waiting for a git command to finish";
    action = (
      <Button kind="secondary" onClick={updates.stopWaiting}>
        Don't restart
      </Button>
    );
  } else if (error && error.step !== "check") {
    tone = "failed";
    icon = <WarningIcon size={16} />;
    title = error.step === "download" ? "Couldn't download the update" : "Couldn't install the update";
    detail = error.message;
    action = again("Try again", error.step === "download" ? updates.download : updates.restart);
  } else if (ready && available) {
    tone = "available";
    icon = <DownloadIcon size={16} />;
    title = `Tributary ${available.version} is ready`;
    detail = <>Installs when you restart, or when you quit · {whatsNew}</>;
    action = (
      <Button kind="primary" onClick={() => void updates.restart()}>
        Restart now
      </Button>
    );
  } else if (downloading && available) {
    tone = "available";
    icon = <DownloadIcon size={16} />;
    title = `Downloading Tributary ${available.version}…`;
    detail = (
      <>
        {downloading.percent === null ? "Starting" : `${downloading.percent}%`} · {whatsNew}
      </>
    );
  } else if (checking) {
    tone = "checking";
    icon = <RefreshIcon size={16} className="spin" />;
    title = "Checking for updates…";
    detail = "Asking Tributary's GitHub releases";
  } else if (error) {
    tone = "failed";
    icon = <WarningIcon size={16} />;
    title = "Couldn't check for updates";
    detail = error.message;
    action = again("Try again");
  } else if (checkedAt) {
    tone = "current";
    icon = <CheckIcon size={16} />;
    title = "You're up to date";
    detail = `Checked ${relativeTime(checkedAt / 1000, now / 1000)}`;
    action = again("Check again");
  } else {
    tone = "unknown";
    icon = <InfoIcon size={16} />;
    title = "Updates come from Tributary's GitHub releases";
    detail = null;
    action = again("Check for updates");
  }
  return (
    <div className={`about-status ${tone}`} role="status">
      <span className="about-status-icon">{icon}</span>
      <span className="about-status-text">
        <strong>{title}</strong>
        {detail && <span title={typeof detail === "string" ? detail : undefined}>{detail}</span>}
      </span>
      {action}
    </div>
  );
}

/** A setting's switch, with what it does under its name. */
function Toggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <div className="about-auto">
      <span className="about-auto-text">
        <span>{label}</span>
        <span className="settings-hint">{hint}</span>
      </span>
      <Switch on={on} onChange={set} label={label} />
    </div>
  );
}

/**
 * About Tributary: the version, whether there's a newer one (checked when the window opens,
 * unless it was just checked), the automatic check, betas, and what's new.
 */
export function AboutDialog({ version, updates, auto, setAuto, beta, setBeta, onInstall, onWhatsNew, onLicences, onClose }: Props) {
  const { check, checkedAt, checking } = updates;
  // Once, as the window opens.
  const opening = useRef(true);
  useEffect(() => {
    if (!opening.current) return;
    opening.current = false;
    if (!checking && (checkedAt === null || Date.now() - checkedAt > STALE)) void check();
  }, [check, checkedAt, checking]);
  return (
    <Dialog
      title="About Tributary"
      className="about-window"
      closable
      onCancel={onClose}
      buttons={<span className="about-copyright">Copyright © 2026 Bogdan Roatis · Free and open source, under the MIT licence</span>}
    >
      <div className="about-hero">
        <Logo size={76} tile />
        <span className="about-name">Tributary</span>
        <span className="about-version">
          {version ? `Version ${version}` : "Version unknown"}
          {isBeta(version) && <Chip className="about-beta">Beta</Chip>}
        </span>
        <span className="about-tagline">A fast, friendly git client.</span>
      </div>
      <section className="about-updates" aria-label="Updates">
        <UpdateStatus updates={updates} onInstall={onInstall} />
        <Toggle label="Check for updates automatically" hint="Shortly after Tributary starts, and every six hours." on={auto} set={setAuto} />
        <Toggle
          label="Get beta versions"
          hint={
            beta
              ? "A new version with each change, before it's released. Turning this off keeps the version you have until a release is newer."
              : "Try what's coming: a new version with each change, before it's released. It may have rough edges."
          }
          on={beta}
          set={setBeta}
        />
      </section>
      <nav className="about-links" aria-label="More about Tributary">
        <button className="about-link" onClick={onWhatsNew}>
          <SparkleIcon size={14} />
          What's New
        </button>
        <button className="about-link" onClick={onLicences}>
          <NotesIcon size={14} />
          Licences
        </button>
        <button className="about-link" onClick={() => openInBrowser(SOURCE)} data-url={SOURCE}>
          <ExternalLinkIcon size={14} />
          Source code
        </button>
      </nav>
    </Dialog>
  );
}
