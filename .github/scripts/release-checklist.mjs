// Compares a release pull request's description with the release checklist in
// .github/release-checklist.md, and says which of its items aren't ticked yet. Ready to
// release runs it, and again whenever the description is edited. They're reminders: they
// don't stop the release.
//
//   node .github/scripts/release-checklist.mjs <description file>
//
// Each item that's left is printed as a warning, which GitHub shows on the check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHECKLIST = fileURLToPath(new URL("../release-checklist.md", import.meta.url));

/** The checklist's items, by the name in bold at their start: "- [ ] **Version:** …" is "Version". */
export function items(checklist) {
  return [...checklist.matchAll(/^\s*- \[ \] \*\*(.+?):\*\*/gm)].map((match) => match[1]);
}

/** What's left in `description`: each item of `checklist` that isn't in it, or isn't ticked. */
export function left(checklist, description) {
  const text = description.replace(/\r\n?/g, "\n");
  return items(checklist).flatMap((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = text.match(new RegExp(`^\\s*[-*] \\[([ xX])\\] \\*\\*${escaped}:\\*\\*`, "m"));
    if (!line) return [{ name, ticked: false, there: false }];
    return line[1] === " " ? [{ name, ticked: false, there: true }] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const checklist = readFileSync(CHECKLIST, "utf8");
  const todo = left(checklist, readFileSync(process.argv[2], "utf8"));
  if (todo.length > 0 && todo.every((item) => !item.there)) {
    console.log("::warning::The description has no release checklist: it's in .github/release-checklist.md.");
  } else {
    for (const item of todo) console.log(`::warning::${item.there ? "Not ticked" : "Not in the checklist"}: ${item.name}.`);
    if (todo.length === 0) console.log(`::notice::All ${items(checklist).length} items on the release checklist are ticked.`);
  }
}
