// What changed in each version, shown once after an update (and from About Tributary), and
// whether to greet someone new with the tour instead. The words are each version's release
// notes (docs/release-notes), built into the app: the same as the release page and the
// update window say. So are the pictures of the new things in them.

/** One thing that changed: its name (the notes' bold start), and the rest of what they say. */
export interface NoteItem {
  title: string;
  /** What follows the name, as Markdown. When the name runs on into its sentence ("**Discard all deletes new files too,** and…"), the whole sentence. */
  text: string;
  /** It, working: the picture under it in the notes (`![what it shows](v0.5.0/name.webp)`), where it's built into the app. */
  picture?: Picture;
}

export interface Picture {
  /** Where the notes keep it, from docs/release-notes ("v0.5.0/lane-lights-up.webp"). */
  path: string;
  /** Its address in the app, or "" when there's no such file. */
  src: string;
  /** What it shows, for someone who can't see it. */
  alt: string;
}

export interface NoteSection {
  /** "New", "Highlights", "Better", "Fixes". */
  name: string;
  items: NoteItem[];
}

export interface Release {
  version: string;
  /** The notes' first line: the release in a sentence. */
  headline: string;
  sections: NoteSection[];
}

/** Where the notes for the update window end, and the release page's own part (installing) starts. */
const END = "<!-- release page only";

/** A version's notes, from their Markdown: the headline, then each section's items. */
export function parseNotes(version: string, markdown: string): Release {
  const headline: string[] = [];
  const sections: NoteSection[] = [];
  // Windows line endings, as git checks the notes out on Windows (where the Windows installer is built).
  for (const line of markdown.replace(/\r\n?/g, "\n").split(END)[0].split("\n")) {
    const heading = /^##\s+(.+)$/.exec(line);
    const bullet = /^-\s+(.+)$/.exec(line);
    // A picture of an item: on its own line, indented under it.
    const picture = /^\s+!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    const items = sections[sections.length - 1]?.items;
    if (heading) sections.push({ name: heading[1].trim(), items: [] });
    else if (bullet && items) items.push(noteItem(bullet[1].trim()));
    else if (picture && items && items.length > 0) items[items.length - 1].picture = { path: picture[2], src: "", alt: picture[1].trim() };
    else if (sections.length === 0 && line.trim()) headline.push(line.trim());
  }
  return { version, headline: headline.join(" "), sections: sections.filter((section) => section.items.length > 0) };
}

/** "**Name:** what it does" → the name and what it does; "**Name runs on,** into…" → the name and the whole sentence. */
function noteItem(line: string): NoteItem {
  const named = /^\*\*(.+?)\*\*\s*(.*)$/.exec(line);
  if (!named) return { title: "", text: line };
  const [, bold, rest] = named;
  return bold.endsWith(":") ? { title: bold.slice(0, -1), text: rest } : { title: bold.replace(/[,.;]$/, ""), text: line };
}

/** The new things in a version: its New (or, for the first, its Highlights). The rest are fixes and things that got better. */
export function featured(release: Release): { items: NoteItem[]; rest: NoteSection[] } {
  const [first, ...others] = release.sections;
  return first && /^(new|highlights)$/i.test(first.name) ? { items: first.items, rest: others } : { items: [], rest: release.sections };
}

const NOTES = import.meta.glob("../../docs/release-notes/v*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PICTURES = import.meta.glob("../../docs/release-notes/v*/*.{webp,png,gif}", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** Every version's notes, newest first, with their pictures. */
export const RELEASES: Release[] = Object.entries(NOTES)
  .map(([path, markdown]) => parseNotes(/v([^/]+)\.md$/.exec(path)![1], markdown))
  .map((release) => {
    for (const item of release.sections.flatMap((section) => section.items)) {
      if (item.picture) item.picture.src = PICTURES[`../../docs/release-notes/${item.picture.path}`] ?? "";
    }
    return release;
  })
  .sort((a, b) => compareVersions(b.version, a.version));

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
 * What What's New in About Tributary shows: the notes of the newest version up to `version`, or, when
 * there are none (a build from before its version was raised for a release), the newest.
 */
export function forMenu(version: string | null, releases = RELEASES): Release[] {
  const upTo = releases.filter((release) => !version || compareVersions(release.version, version) <= 0);
  return (upTo.length > 0 ? upTo : releases).slice(0, 1);
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
