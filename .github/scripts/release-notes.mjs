// The release page's notes: a version's notes file, with its pictures (which it links
// beside it, like `v0.5.0/lane-lights-up.webp`) linked where the release page can show
// them, at the commit being released.
//
//   node release-notes.mjs <repository> <commit> <notes file> <out file>
import { readFileSync, writeFileSync } from "node:fs";

const [repository, commit, notesFile, out] = process.argv.slice(2);
const notes = readFileSync(notesFile, "utf8").replace(
  /(!\[[^\]]*\]\()(?![a-z]+:|\/|#)([^)\s]+)\)/g,
  (_, start, path) => `${start}https://raw.githubusercontent.com/${repository}/${commit}/docs/release-notes/${path})`,
);
writeFileSync(out, notes);
