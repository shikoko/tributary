import type { ReactNode } from "react";
import { GitHubIcon } from "./Icons";

/**
 * Which site a section of a commit's details comes from, beside its heading: GitHub (with its
 * mark) or GitLab.
 */
export function SiteChip({ site }: { site: string }) {
  return (
    <span className="site-chip">
      {site === "GitHub" && <GitHubIcon size={11} />}
      <span className="chip-text">{site}</span>
    </span>
  );
}

/** The button at the end of a section's first line, like Show or Open. */
export function SectionButton({ onClick, icon, label, title }: { onClick: () => void; icon: ReactNode; label: string; title: string }) {
  return (
    <button className="section-button" onClick={onClick} title={title}>
      {icon}
      <span className="button-label">{label}</span>
    </button>
  );
}
