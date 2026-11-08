import type { Submodule } from "../api";
import { plural } from "./format";

/** A submodule's folder name, like "editor-kit". */
export function submoduleName(submodule: Submodule): string {
  return submodule.path.split("/").filter(Boolean).pop() ?? submodule.path;
}

/** A word or two about where it is, for the sidebar; null when it's where it should be. */
export function submoduleNote(submodule: Submodule): string | null {
  switch (submodule.state) {
    case "notSetUp":
      return "not set up";
    case "behind":
    case "different":
      return "out of date";
    case "ahead":
      return "new commits";
    case "conflicted":
      return "conflicted";
    case "upToDate":
      return submodule.changed ? "changed" : null;
  }
}

/** The whole story, for a tooltip. */
export function submoduleTitle(submodule: Submodule): string {
  const lines = [submodule.path];
  if (submodule.url) lines.push(submodule.url);
  switch (submodule.state) {
    case "notSetUp":
      lines.push("Not set up yet: its files aren't here. Update it to clone it.");
      break;
    case "upToDate":
      lines.push("At the commit this repository records.");
      break;
    case "behind":
      lines.push(
        submodule.behind > 0
          ? `${plural(submodule.behind, "commit")} behind the commit this repository records. Update it to catch up.`
          : "Not at the commit this repository records (it isn't downloaded yet). Update it to catch up.",
      );
      break;
    case "ahead":
      lines.push(`${plural(submodule.ahead, "new commit")} in it. Commit it here to record them.`);
      break;
    case "different":
      lines.push("At a different commit from the one this repository records. Update it to go back to that one.");
      break;
    case "conflicted":
      lines.push("Both sides of the merge moved it. Stage the commit you want it at.");
      break;
  }
  if (submodule.changed) lines.push("It has uncommitted changes of its own.");
  return lines.join("\n");
}

/**
 * Set up, but not where this repository says it should be. Ahead counts only for the
 * submodules in `moved` (left there by a checkout or pull, rather than new work).
 */
export function outOfDate(submodules: Submodule[], moved: ReadonlySet<string> = new Set()): Submodule[] {
  return submodules.filter(
    (submodule) => submodule.state === "behind" || submodule.state === "different" || (submodule.state === "ahead" && moved.has(submodule.path)),
  );
}

/** What the banner says about submodules out of date, or not set up; null when there's nothing to say. */
export function submoduleNotice(submodules: Submodule[], moved: ReadonlySet<string> = new Set()): { text: string; paths: string[]; action: string } | null {
  const late = outOfDate(submodules, moved);
  if (late.length > 0) {
    const names = late.map(submoduleName);
    return {
      text:
        late.length === 1
          ? `The submodule ${names[0]} isn't at the commit this branch records for it.`
          : `${late.length} submodules aren't at the commits this branch records for them (${names.join(", ")}).`,
      paths: late.map((submodule) => submodule.path),
      action: late.length === 1 ? "Update it" : "Update them",
    };
  }
  const missing = submodules.filter((submodule) => submodule.state === "notSetUp");
  if (missing.length > 0 && missing.length === submodules.length) {
    return {
      text:
        missing.length === 1
          ? `The submodule ${submoduleName(missing[0])} isn't set up yet: its files aren't here.`
          : `This repository's ${missing.length} submodules aren't set up yet: their files aren't here.`,
      paths: missing.map((submodule) => submodule.path),
      action: missing.length === 1 ? "Set it up" : "Set them up",
    };
  }
  return null;
}
