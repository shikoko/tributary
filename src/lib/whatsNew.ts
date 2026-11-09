// What changed in each version, shown once after an update (and from Help), and whether to
// greet someone new with the tour instead.

/** The picture beside an item. */
export type WhatsNewIcon = "lfs" | "progress" | "team" | "undo" | "commit" | "setup" | "open";

export interface Release {
  version: string;
  items: { title: string; text: string; icon?: WhatsNewIcon }[];
}

/** Newest first. Add the next version's entry when it's released (with the version bumped). */
export const RELEASES: Release[] = [
  {
    version: "0.2.0",
    items: [
      {
        icon: "lfs",
        title: "Faster Git LFS pulls",
        text: "Pulls and checkouts download the Git LFS files they need all together, several at a time, before checking out. A second bar counts the files and the time left; hover it for the speed and the biggest file still to come.",
      },
      {
        icon: "progress",
        title: "Progress outside the window",
        text: "The taskbar button or Dock icon fills up during a long pull, a tab in the background shows a ring, and a notification says when it's done if you're in another app.",
      },
      {
        icon: "team",
        title: "Team activity, redesigned",
        text: "Gradient graphs of everyone's days, the kinds of work, lines of code, hotspots, when the team works and pull requests. The people button in the toolbar opens it.",
      },
      { icon: "undo", title: "Your actions, with Undo", text: "Activity → Your actions lists what you did in a repository, each with Undo for as long as it's safe." },
      {
        icon: "commit",
        title: "Smarter commit messages",
        text: "On a branch for a Jira or Linear issue, the summary starts with its key. Set a message template, or use your team's, in the repository's settings.",
      },
      {
        icon: "setup",
        title: "Project setup check",
        text: "Repository → Check Project Setup looks over an Unreal or Unity project's ignores, Git LFS, lockable files, line endings and long paths, with a fix for each.",
      },
      { icon: "open", title: "Open it anywhere", text: "The toolbar's Open button opens the repository on GitHub or GitLab, in Finder or Explorer, or in your editor or terminal." },
    ],
  },
];

/** -1, 0 or 1, comparing "0.10.2" with "0.9.0" by numbers ("preview" and the like count as 0). */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * What to show when the app starts: the tour for someone new (no version seen, no
 * repositories opened before), what's new since the version last seen, or nothing.
 */
export function onStart(version: string, seen: string | null, usedBefore: boolean, releases = RELEASES): { show: "tour" | "news" | null; releases: Release[] } {
  if (!seen) {
    if (!usedBefore) return { show: "tour", releases: [] };
    // Used before this was added: what this version brings.
    const current = releases.filter((release) => compareVersions(release.version, version) === 0);
    return { show: current.length > 0 ? "news" : null, releases: current };
  }
  const since = releases.filter((release) => compareVersions(release.version, seen) > 0 && compareVersions(release.version, version) <= 0);
  return { show: since.length > 0 ? "news" : null, releases: since };
}
