import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Updates } from "../lib/updates";
import { relativeTime } from "../lib/format";
import { openInBrowser } from "../lib/weblinks";
import { Dialog } from "./Dialog";
import { CheckIcon, DownloadIcon, ExternalLinkIcon, InfoIcon, Logo, NotesIcon, RefreshIcon, SparkleIcon, WarningIcon } from "./Icons";

const SOURCE = "https://github.com/shikoko/tributary";
/** Opening About checks again when the last check is older than this. */
const STALE = 10 * 60 * 1000;

interface Props {
  version: string | null;
  updates: Updates;
  auto: boolean;
  setAuto: (auto: boolean) => void;
  /** The newer version's notes, and Install and restart. */
  onInstall: () => void;
  onWhatsNew: () => void;
  onLicences: () => void;
  onClose: () => void;
}

/** Ticks every half minute, so "checked just now" grows older while the window is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** What the last check found, with the one thing to do about it. */
function UpdateStatus({ version, updates, onInstall }: Pick<Props, "version" | "updates" | "onInstall">) {
  const now = useNow();
  const { available, checking, error, checkedAt, check } = updates;
  const again = (label: string) => (
    <button className="secondary-button" onClick={() => void check()} disabled={checking}>
      {label}
    </button>
  );
  let tone: string;
  let icon: ReactNode;
  let title: string;
  let detail: string | null;
  let action: ReactNode;
  if (checking) {
    tone = "checking";
    icon = <RefreshIcon size={16} className="spin" />;
    title = "Checking for updates…";
    detail = "Asking Tributary's GitHub releases";
    action = null;
  } else if (available) {
    tone = "available";
    icon = <DownloadIcon size={16} />;
    title = `Tributary ${available.version} is available`;
    detail = version ? `You have ${version}` : null;
    action = (
      <button className="primary-small-button" onClick={onInstall}>
        See what's new…
      </button>
    );
  } else if (error) {
    tone = "failed";
    icon = <WarningIcon size={16} />;
    title = "Couldn't check for updates";
    detail = error;
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
        {detail && <span title={detail}>{detail}</span>}
      </span>
      {action}
    </div>
  );
}

/**
 * About Tributary: the version, whether there's a newer one (checked when the window opens,
 * unless it was just checked), the automatic check, and what's new.
 */
export function AboutDialog({ version, updates, auto, setAuto, onInstall, onWhatsNew, onLicences, onClose }: Props) {
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
        <span className="about-version">{version ? `Version ${version}` : "Version unknown"}</span>
        <span className="about-tagline">A fast, friendly git client.</span>
      </div>
      <section className="about-updates" aria-label="Updates">
        <UpdateStatus version={version} updates={updates} onInstall={onInstall} />
        <div className="about-auto">
          <span className="about-auto-text">
            <span>Check for updates automatically</span>
            <span className="settings-hint">Shortly after Tributary starts, and every six hours.</span>
          </span>
          <button role="switch" aria-checked={auto} aria-label="Check for updates automatically" className={`switch${auto ? " on" : ""}`} onClick={() => setAuto(!auto)}>
            <span className="switch-knob" />
          </button>
        </div>
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
        <button className="about-link" onClick={() => openInBrowser(SOURCE)}>
          <ExternalLinkIcon size={14} />
          Source code
        </button>
      </nav>
    </Dialog>
  );
}
