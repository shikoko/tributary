// Writes latest.json, which Tributary reads to find and verify new versions.
//
//   node latest-json.mjs <repository> <tag> <assets.json> <folder with the .sig files> <out file> [notes file]
//
// assets.json is { body, assets: [{ name }] }, from GitHub's API. Files are linked by their
// public download address under the release's tag, which works once the draft is published.
// The notes the update window shows come from the notes file when there is one (up to its
// "release page only" comment), or else from the release's own notes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repository, tag, assetsFile, folder, out, notesFile] = process.argv.slice(2);
const version = tag.replace(/^v/, "");
const { assets, body } = JSON.parse(readFileSync(assetsFile, "utf8"));
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").split(/<!--\s*release page only/)[0].trim() : (body ?? "");

/** The asset whose name ends with `suffix`, with its signature, or null. */
function signed(suffix) {
  const asset = assets.find((a) => a.name.endsWith(suffix));
  const signature = asset && join(folder, `${asset.name}.sig`);
  if (!asset || !existsSync(signature)) return null;
  return { url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`, signature: readFileSync(signature, "utf8").trim() };
}

const platforms = {};
// Each Windows install is updated the way it was installed (the updater looks for its own
// kind first): one from the .msi (for everyone on the PC) with the .msi, one from the setup
// (just for you) with the NSIS installer the setup carries, -update.exe.
const nsis = signed("-update.exe");
if (nsis) {
  platforms["windows-x86_64-nsis"] = nsis;
  platforms["windows-x86_64"] = nsis;
}
const msi = signed(".msi");
if (msi) platforms["windows-x86_64-msi"] = msi;
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
