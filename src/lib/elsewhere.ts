import type { OtherChange, Overlap } from "../api";
import { baseName } from "./paths";
import { relativeTime } from "./format";

/** "origin/art/lighting, by Rosa Bell 2 days ago". */
export function describeChange(change: OtherChange, now?: number): string {
  return `${change.branch}, by ${change.author} ${relativeTime(change.time, now)}`;
}

/** For a file's mark: where else it changed, and what that means. */
export function overlapTitle(overlap: Overlap, now?: number): string {
  const where = overlap.elsewhere.map((change) => `Also changed on ${describeChange(change, now)}`).join("\n");
  return `${where}\n${
    overlap.unmergeable ? "It can't be merged: one version will have to win." : "Git can usually merge both changes."
  }`;
}

/**
 * The warning's first line: the one file and where, or how many. Files that can't be
 * merged come first and set the tone.
 */
export function overlapHeadline(overlaps: Overlap[], now?: number): string {
  const assets = overlaps.filter((overlap) => overlap.unmergeable);
  if (overlaps.length === 1) {
    const [only] = overlaps;
    const latest = only.elsewhere[0];
    const others = only.elsewhere.length > 1 ? ` (and ${only.elsewhere.length - 1} more ${only.elsewhere.length === 2 ? "branch" : "branches"})` : "";
    return `${baseName(only.path)} was also changed on ${describeChange(latest, now)}${others}.`;
  }
  if (assets.length > 0) {
    const files = assets.length === 1 ? `${baseName(assets[0].path)} and ${overlaps.length - 1} more` : `${overlaps.length} files`;
    return `${files} you're changing were also changed on other branches.`;
  }
  return `${overlaps.length} files you're changing were also changed on other branches.`;
}
