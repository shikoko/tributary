// Release notes as Markdown: the changes since the last release, who made them, and the
// issues they mention.
import type { ReleaseNotes } from "../api";

/** "Maya Chen", "Maya Chen and Theo Park", "Maya Chen, Theo Park and Rosa Bell". */
export function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * The notes in Markdown, oldest change first. `issues`: the issues their messages mention
 * (with where they are), listed after the changes.
 */
export function releaseMarkdown(notes: ReleaseNotes, issues: { key: string; url: string | null }[] = []): string {
  const lines: string[] = [];
  if (notes.items.length === 0) {
    lines.push("Nothing new since the last release.");
  } else {
    lines.push("## What's changed", "");
    for (const item of [...notes.items].reverse()) {
      lines.push(`- ${item.title}${item.number ? ` (${item.number})` : ""}`);
    }
  }
  if (issues.length > 0) {
    lines.push("", "## Issues", "");
    for (const issue of issues) lines.push(issue.url ? `- [${issue.key}](${issue.url})` : `- ${issue.key}`);
  }
  if (notes.contributors.length > 0) {
    lines.push("", `Thanks to ${names(notes.contributors)}.`);
  }
  if (notes.from) lines.push("", `**Full changes:** ${notes.from}...${notes.to}`);
  return `${lines.join("\n")}\n`;
}
