// Writes latest.json, which Tributary reads to find and verify new versions.
//
//   node latest-json.mjs <repository> <tag> <assets.json> <folder with the .sig files> <out file> [notes file]
//
// assets.json is { body, assets: [{ name }] }, from GitHub's API. Files are linked by their
// public download address under the release's tag, which works once the draft is published.
// The notes the update window shows come from the notes file when there is one (up to its
// "release page only" comment, without its pictures), or else from the release's own notes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repository, tag, assetsFile, folder, out, notesFile] = process.argv.slice(2);
const version = tag.replace(/^v/, "");
const { assets, body } = JSON.parse(readFileSync(assetsFile, "utf8"));
// Without the pictures of the new things: What's New shows them, once it's installed.
const notes =
  notesFile && existsSync(notesFile)
    ? readFileSync(notesFile, "utf8")
        .split(/<!--\s*release page only/)[0]
        .replace(/^[ \t]*!\[[^\]]*\]\([^)\s]+\)[ \t]*$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : (body ?? "");

/** The asset whose name ends with `suffix`, with its signature, or null. */
function signed(suffix) {
  const asset = assets.find((a) => a.name.endsWith(suffix));
  const signature = asset && join(folder, `${asset.name}.sig`);
  if (!asset || !existsSync(signature)) return null;
  return { url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`, signature: readFileSync(signature, "utf8").trim() };
}

const platforms = {};
// Windows: Tributary's setup, which updates the copy that runs it (just for you, or for
// everyone on the PC).
const windows = signed("-setup.exe");
if (windows) {
  platforms["windows-x86_64"] = windows;
  platforms["windows-x86_64-nsis"] = windows;
}
// One universal app for both kinds of Mac.
const mac = signed(".app.tar.gz");
if (mac) {
  platforms["darwin-aarch64"] = mac;
  platforms["darwin-x86_64"] = mac;
}
if (Object.keys(platforms).length === 0) {
  console.log("No signed installers (is the TAURI_SIGNING_PRIVATE_KEY secret set?): no latest.json.");
  process.exit(0);
}
writeFileSync(out, JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));
console.log(`latest.json for ${version}: ${Object.keys(platforms).join(", ")}`);
