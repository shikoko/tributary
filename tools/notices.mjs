// Writes THIRD_PARTY_NOTICES.txt: the licences of everything that goes into the app, for
// shipping with it. That's the Rust crates it's built from for macOS and Windows (from
// `cargo metadata`, which downloads them if needed) and the npm packages in the interface
// (package.json's dependencies, and theirs). Dev tools, tests and build scripts aren't
// included, since they don't ship.
//
//   node tools/notices.mjs           writes THIRD_PARTY_NOTICES.txt
//   node tools/notices.mjs --check   fails if the file is out of date
//
// Each licence text is shown once, with every package it covers.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "THIRD_PARTY_NOTICES.txt");
/** What the installers are built for (see .github/workflows/build.yml). */
const PLATFORMS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"];
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

/** The licence files in a package's folder (not in its subfolders). */
function licenseFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => LICENSE_FILE.test(name) && statSync(join(folder, name)).isFile())
    .sort()
    .map((name) => readFileSync(join(folder, name), "utf8").replace(/\r\n/g, "\n").trim())
    .filter((text) => text.length > 0);
}

/** The Rust crates the app is built from, without dev and build-only dependencies. */
function crates() {
  const packages = new Map();
  const own = new Set();
  const shipped = new Set();
  // One platform at a time: cargo can't filter by several at once.
  for (const target of PLATFORMS) {
    const metadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", target, "--manifest-path", join(root, "src-tauri", "Cargo.toml")], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
    for (const pkg of metadata.packages) packages.set(pkg.id, pkg);
    for (const id of metadata.workspace_members) own.add(id);
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
    const seen = new Set();
    const queue = [...metadata.workspace_members];
    while (queue.length > 0) {
      const id = queue.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      shipped.add(id);
      for (const dep of nodes.get(id)?.deps ?? []) {
        // Normal dependencies only: `kind` is "dev" or "build" for the others.
        if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
      }
    }
  }
  return [...shipped]
    .filter((id) => !own.has(id))
    .map((id) => packages.get(id))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? (pkg.license_file ? "see its licence file" : "not stated"),
      home: pkg.repository ?? pkg.homepage ?? `https://crates.io/crates/${pkg.name}`,
      texts: licenseFiles(dirname(pkg.manifest_path)),
    }));
}

/** The npm packages in the interface: package.json's dependencies, and theirs. */
function npmPackages() {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const found = new Map();
  const visit = (name, from) => {
    // Node's lookup: the nearest node_modules up from the package that needs it.
    let folder = from;
    let dir = null;
    for (;;) {
      const candidate = join(folder, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) {
        dir = candidate;
        break;
      }
      if (folder === root) break;
      folder = dirname(folder);
    }
    if (!dir) throw new Error(`${name} isn't installed: run npm ci first`);
    if (found.has(dir)) return;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    found.set(dir, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "not stated"),
      home: (repository ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`).replace(/^git\+/, "").replace(/\.git$/, ""),
      texts: licenseFiles(dir),
    });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      try {
        visit(dep, dir);
      } catch (e) {
        // A missing optional dependency is fine; a missing required one isn't.
        if (!pkg.optionalDependencies?.[dep]) throw e;
      }
    }
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) visit(name, root);
  return [...found.values()];
}

const RULE = "=".repeat(78);
const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });

function render(packages) {
  const groups = new Map();
  const withoutText = [];
  for (const pkg of packages) {
    if (pkg.texts.length === 0) {
      withoutText.push(pkg);
      continue;
    }
    // Each licence file on its own, so a text that many share (like Apache-2.0) is shown once.
    for (const text of pkg.texts) {
      const key = createHash("sha256").update(text.replace(/\s+/g, " ")).digest("hex");
      if (!groups.has(key)) groups.set(key, { text, packages: [] });
      const group = groups.get(key);
      if (!group.packages.includes(pkg)) group.packages.push(pkg);
    }
  }
  const sorted = [...groups.values()]
    .map((group) => ({ ...group, packages: group.packages.sort(byName) }))
    .sort((a, b) => byName(a.packages[0], b.packages[0]));

  const lines = [
    "Third-party notices for Tributary",
    "",
    "Tributary is made with the open-source software below, which keeps its own licences.",
    "Each licence text appears once, after the packages it covers. Tributary itself is",
    "under the MIT License (the LICENSE file).",
    "",
    `${packages.length} packages: ${packages.filter((pkg) => pkg.source === "crate").length} Rust crates and ${packages.filter((pkg) => pkg.source === "npm").length} npm packages.`,
    "This file is made by tools/notices.mjs.",
    "",
  ];
  for (const group of sorted) {
    lines.push(RULE, "");
    for (const pkg of group.packages) lines.push(`${pkg.name} ${pkg.version} (${pkg.license}) ${pkg.home}`);
    lines.push("", group.text, "");
  }
  if (withoutText.length > 0) {
    lines.push(RULE, "", "These packages don't include a licence file; their licences are the standard texts named:", "");
    for (const pkg of withoutText.sort(byName)) lines.push(`${pkg.name} ${pkg.version} (${pkg.license}) ${pkg.home}`);
    lines.push("");
  }
  return lines.join("\n");
}

const packages = [...crates().map((pkg) => ({ ...pkg, source: "crate" })), ...npmPackages().map((pkg) => ({ ...pkg, source: "npm" }))];
const text = render(packages);
if (process.argv.includes("--check")) {
  const now = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== text) {
    console.error("THIRD_PARTY_NOTICES.txt is out of date: run npm run notices");
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.txt is up to date.");
} else {
  writeFileSync(out, text);
  console.log(`THIRD_PARTY_NOTICES.txt: ${packages.length} packages, ${(text.length / 1024).toFixed(0)} KB`);
}
