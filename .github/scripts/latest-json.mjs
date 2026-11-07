// Writes latest.json, which Tributary reads to find and verify new versions.
//
//   node latest-json.mjs <version> <assets.json> <folder with the .sig files> <out file>
//
// assets.json is { body, assets: [{ name, apiUrl }] }, from GitHub's API. Files are linked by
// their API address, which also works for a private repository (with a token).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, assetsFile, folder, out] = process.argv.slice(2);
const { assets, body } = JSON.parse(readFileSync(assetsFile, "utf8"));

/** The asset whose name ends with `suffix`, with its signature, or null. */
function signed(suffix) {
  const asset = assets.find((a) => a.name.endsWith(suffix));
  const signature = asset && join(folder, `${asset.name}.sig`);
  if (!asset || !existsSync(signature)) return null;
  return { url: asset.apiUrl, signature: readFileSync(signature, "utf8").trim() };
}

const platforms = {};
const windows = signed("-setup.exe");
if (windows) platforms["windows-x86_64"] = windows;
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
writeFileSync(out, JSON.stringify({ version, notes: body ?? "", pub_date: new Date().toISOString(), platforms }, null, 2));
console.log(`latest.json for ${version}: ${Object.keys(platforms).join(", ")}`);
