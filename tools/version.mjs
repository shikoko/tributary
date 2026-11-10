// Tributary's version, which is in several files (the app's and the setup's Cargo.toml and
// tauri.conf.json, package.json, and the lock files), kept the same in all of them.
//
//   node tools/version.mjs              prints it, or fails if the files disagree
//   node tools/version.mjs 0.3.0        sets it in every file
//   node tools/version.mjs --after v0.2.0
//                                       fails unless it's newer than that release
//
// `npm run set-version -- 0.3.0` does the same as the second.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Each file with the version: how to read it, and how to write a new one. JSON files are
 * changed in place (their first `"version"` lines, which are the ones read), so nothing
 * else in them moves.
 */
const json = (file, ...paths) => ({
  file,
  read: (text) => paths.map((path) => path.reduce((value, key) => value?.[key], JSON.parse(text))),
  write: (text, version) => {
    let left = paths.length;
    return text.replace(/"version": "[^"]*"/g, (found) => (left-- > 0 ? `"version": "${version}"` : found));
  },
});
// The [package] table's version, the first `version =` line.
const cargoToml = (file) => ({
  file,
  read: (text) => [text.match(/^version = "([^"]*)"/m)?.[1]],
  write: (text, version) => text.replace(/^version = "[^"]*"/m, `version = "${version}"`),
});
// Tributary's own packages in Cargo.lock.
const LOCKED = ["tributary", "tributary-setup"];
const cargoLock = (file) => ({
  file,
  read: (text) => LOCKED.map((name) => text.match(new RegExp(`\\nname = "${name}"\\nversion = "([^"]*)"`))?.[1]),
  write: (text, version) =>
    LOCKED.reduce((out, name) => out.replace(new RegExp(`(\\nname = "${name}"\\nversion = )"[^"]*"`), `$1"${version}"`), text),
});

const FILES = [
  json("package.json", ["version"]),
  json("package-lock.json", ["version"], ["packages", "", "version"]),
  json("src-tauri/tauri.conf.json", ["version"]),
  json("src-tauri/setup/tauri.conf.json", ["version"]),
  cargoToml("src-tauri/Cargo.toml"),
  cargoToml("src-tauri/setup/Cargo.toml"),
  cargoLock("src-tauri/Cargo.lock"),
];

const text = (file) => readFileSync(join(root, file), "utf8");

/** The version every file has; exits if they don't all have the same one. */
function current() {
  const found = FILES.flatMap(({ file, read }) => read(text(file)).map((version) => ({ file, version })));
  const versions = new Set(found.map(({ version }) => version));
  if (versions.size !== 1 || !SEMVER.test([...versions][0] ?? "")) {
    console.error("The version isn't the same everywhere:");
    for (const { file, version } of found) console.error(`  ${file}: ${version ?? "(none)"}`);
    console.error("Set it in all of them with: npm run set-version -- <version>");
    process.exit(1);
  }
  return [...versions][0];
}

/** Compare two versions: negative if a is older than b. A pre-release comes before its release. */
function compare(a, b) {
  const [, ...x] = a.match(SEMVER);
  const [, ...y] = b.match(SEMVER);
  for (let i = 0; i < 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3].localeCompare(y[3], "en", { numeric: true });
}

const [first, second] = process.argv.slice(2);
if (!first) {
  console.log(current());
} else if (first === "--after") {
  const version = current();
  const released = (second ?? "").replace(/^v/, "");
  if (!SEMVER.test(released)) {
    console.error(`"${second}" isn't a version like v0.2.0`);
    process.exit(2);
  }
  if (compare(version, released) <= 0) {
    console.error(`The version is ${version}, but ${second} is already released: set a newer one with npm run set-version -- <version>.`);
    process.exit(1);
  }
  console.log(`${version} comes after ${second}`);
} else {
  const version = first.replace(/^v/, "");
  if (!SEMVER.test(version)) {
    console.error(`"${first}" isn't a version like 0.3.0`);
    process.exit(2);
  }
  for (const { file, write } of FILES) writeFileSync(join(root, file), write(text(file), version));
  console.log(`Tributary is now version ${version}`);
}
