// The release checklist's checks a computer can do (.github/release-checklist.md), on a
// version's notes before it's released: What's New, the update window's notes and the
// release page's pictures. What it finds goes under the checklist's items.
//
//   npm run preview:build && npm run release:check -- 0.9.0 [--out <folder>]
//
// - What's New, as this version shows it after updating from the one before, in the dark
//   and light themes: each page's screenshot (in --out, or a folder in the system's temporary
//   one), that the window keeps its height, that each new thing's recording plays, and that
//   nothing goes wrong on the page.
// - The update file, made from the notes as the release build makes it (latest-json.mjs, with
//   stand-in installers and signatures): every platform, and notes that stop before
//   Installing, without pictures.
// - The release page's notes (release-notes.mjs, at this commit): every picture linked, and
//   there in docs/release-notes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const version = args.find((arg) => /^v?\d+\.\d+\.\d+$/.test(arg))?.replace(/^v/, "");
if (!version) {
  console.error("Which version? npm run release:check -- 0.9.0 [--out <folder>]");
  process.exit(2);
}
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : mkdtempSync(join(tmpdir(), `tributary-release-check-${version}-`));
mkdirSync(out, { recursive: true });

const notesFile = join(root, "docs", "release-notes", `v${version}.md`);
if (!existsSync(notesFile)) {
  console.error(`There are no notes for ${version}: docs/release-notes/v${version}.md.`);
  process.exit(1);
}

const problems = [];
const said = [];
const ok = (text) => said.push(`✓ ${text}`);
const wrong = (text) => {
  said.push(`✗ ${text}`);
  problems.push(text);
};

/** -1, 0 or 1, comparing "0.10.2" with "0.9.0" by their numbers. */
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
const versions = readdirSync(join(root, "docs", "release-notes"))
  .map((name) => /^v(\d+\.\d+\.\d+)\.md$/.exec(name)?.[1])
  .filter(Boolean);
const before = versions.filter((v) => compare(v, version) < 0).sort(compare).pop() ?? null;
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const repository = /github\.com[:/](.+?)(?:\.git)?$/.exec(git("remote", "get-url", "origin"))?.[1] ?? "shikoko/tributary";

// What's New, after updating from the version before, in both themes.
async function whatsNew() {
  const { startPreview } = await import(join(root, "tools", "preview", "server.mjs"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright");
  const preview = await startPreview({ port: 0, quiet: true });
  const browser = await chromium.launch();
  try {
    for (const theme of ["dark", "light"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      await page.addInitScript((version) => Object.defineProperty(window, "__PREVIEW_VERSION__", { get: () => version, set: () => {}, configurable: false }), version);
      await page.addInitScript(
        ([theme, before]) => {
          window.__PREVIEW__ = { pullRequests: [] };
          localStorage.setItem("tributary.fetch.auto", "false");
          localStorage.setItem("tributary.whatsNew.seen", JSON.stringify(before ?? "0.0.0"));
          localStorage.setItem("tributary.tours.off", "true");
          localStorage.setItem("tributary.appearance", JSON.stringify({ theme }));
        },
        [theme, before],
      );
      await page.goto(preview.url);
      const dialog = page.locator(".whats-new-dialog");
      await dialog.waitFor({ timeout: 15_000 });
      const heights = [];
      let pictures = 0;
      let broken = 0;
      for (let n = 1; n <= 20; n++) {
        await page.waitForTimeout(1200);
        heights.push(Math.round((await dialog.boundingBox()).height));
        const picture = await dialog.evaluate((element) => {
          const image = element.querySelector(".wn-spotlight img");
          return image ? image.complete && image.naturalWidth > 0 : null;
        });
        if (picture === true) pictures++;
        if (picture === false) broken++;
        await page.screenshot({ path: join(out, `whats-new-${theme}-${n}.png`) });
        const next = dialog.locator(".dialog-buttons button, footer button").last();
        if (/got it|close|done/i.test((await next.innerText()).trim())) break;
        await next.click();
      }
      const steady = heights.every((height) => height === heights[0]);
      const where = `What's New in the ${theme} theme`;
      if (steady) ok(`${where}: ${heights.length} pages, ${heights[0]} pixels high on every one.`);
      else wrong(`${where}: the window's height changes from page to page (${heights.join(", ")} pixels).`);
      if (broken > 0) wrong(`${where}: ${broken} recording${broken === 1 ? "" : "s"} didn't load.`);
      else ok(`${where}: ${pictures} recording${pictures === 1 ? "" : "s"} loaded and playing.`);
      if (errors.length > 0) wrong(`${where}: errors on the page: ${errors.join("; ")}`);
      else ok(`${where}: no errors on the page.`);
      await page.close();
    }
  } finally {
    await browser.close();
    await preview.close?.();
  }
}

// The update file, with stand-ins for the installers and their signatures.
function updateFile() {
  const folder = mkdtempSync(join(tmpdir(), "tributary-release-check-assets-"));
  const assets = ["Tributary.app.tar.gz", `Tributary_${version}_universal.dmg`, `Tributary_${version}_x64-setup.exe`, `Tributary_${version}_arm64-setup.exe`, `Tributary_${version}_amd64.AppImage`, `Tributary_${version}_aarch64.AppImage`];
  mkdirSync(join(folder, "signatures"));
  for (const name of assets) writeFileSync(join(folder, "signatures", `${name}.sig`), "stand-in signature");
  writeFileSync(join(folder, "assets.json"), JSON.stringify({ body: "", assets: assets.map((name) => ({ name })) }));
  const latest = join(folder, "latest.json");
  execFileSync("node", [join(root, ".github", "scripts", "latest-json.mjs"), repository, `v${version}`, join(folder, "assets.json"), join(folder, "signatures"), latest, notesFile], { stdio: "ignore" });
  const file = JSON.parse(readFileSync(latest, "utf8"));
  const platforms = Object.keys(file.platforms);
  const expected = ["windows-x86_64", "windows-x86_64-nsis", "windows-aarch64", "windows-aarch64-nsis", "darwin-aarch64", "darwin-x86_64", "linux-x86_64", "linux-aarch64"];
  const missing = expected.filter((platform) => !platforms.includes(platform));
  if (file.version !== version) wrong(`The update file is for ${file.version}, not ${version}.`);
  if (missing.length > 0) wrong(`The update file has no ${missing.join(", ")}.`);
  else ok(`The update file lists ${platforms.length} platforms: ${platforms.join(", ")}.`);
  if (/!\[/.test(file.notes)) wrong("The update window's notes have pictures in them.");
  else if (/Installing|release page only/.test(file.notes)) wrong("The update window's notes don't stop before Installing.");
  else if (!file.notes.trim()) wrong("The update window's notes are empty.");
  else ok(`The update window's notes stop before Installing, without pictures (${file.notes.split("\n").filter(Boolean).length} lines).`);
}

// The release page's notes, at this commit.
function releasePage() {
  const page = join(mkdtempSync(join(tmpdir(), "tributary-release-check-page-")), "release-notes.md");
  execFileSync("node", [join(root, ".github", "scripts", "release-notes.mjs"), repository, commit, notesFile, page], { stdio: "ignore" });
  const links = [...readFileSync(page, "utf8").matchAll(/!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)\s]+)\)/g)].map((match) => match[1]);
  const prefix = `https://raw.githubusercontent.com/${repository}/${commit}/`;
  const elsewhere = links.filter((link) => !link.startsWith(prefix));
  const absent = links.filter((link) => link.startsWith(prefix) && !existsSync(join(root, link.slice(prefix.length))));
  if (elsewhere.length > 0) wrong(`The release page links pictures elsewhere than this commit: ${elsewhere.join(", ")}.`);
  if (absent.length > 0) wrong(`The release page links pictures that aren't there: ${absent.join(", ")}.`);
  if (elsewhere.length === 0 && absent.length === 0) ok(`The release page links ${links.length} picture${links.length === 1 ? "" : "s"} at ${commit.slice(0, 7)}.`);
  let pushed = false;
  try {
    pushed = git("branch", "-r", "--contains", commit) !== "";
  } catch {
    pushed = false;
  }
  if (!pushed) said.push(`  (${commit.slice(0, 7)} isn't on GitHub yet: the release page's pictures load from there once it is.)`);
}

console.log(`Checking ${version}${before ? `, after ${before}` : ""}, at ${commit.slice(0, 7)}.`);
try {
  await whatsNew();
} catch (error) {
  wrong(`What's New couldn't be checked: ${error.message.split("\n")[0]} (is the preview built? npm run preview:build)`);
}
updateFile();
releasePage();
console.log(said.join("\n"));
console.log(`What's New's screenshots are in ${out}.`);
if (problems.length > 0) {
  console.log(`${problems.length} thing${problems.length === 1 ? "" : "s"} to put right before releasing.`);
  process.exit(1);
}
process.exit(0);
