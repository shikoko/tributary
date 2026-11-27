// The README's badges, drawn here and published with the website (in site/badges/, by the
// Website workflow), so the README shows files from the website. Badges drawn by shields.io
// when the README is viewed often fail to load on GitHub: its image proxy gives up waiting
// for shields.io, and shows the badge's alt text instead. They're drawn with shields.io's own
// library (badge-maker), so they look the same.
//
//   node .github/scripts/badges.mjs <folder>
//
// Needs GITHUB_REPOSITORY and GH_TOKEN (and GITHUB_API_URL for another API, as the tests do).
// Writes, as SVG:
// - release.svg: the latest release's version;
// - downloads.svg: how many times the installers were downloaded, from every release, by
//   hand or by automatic updates. Not latest.json, which every check for updates downloads,
//   nor the update signatures;
// - stars.svg: the stars on GitHub;
// - last-commit.svg: how long ago the default branch (develop) last changed;
// - license.svg, windows.svg, macos.svg, linux.svg and built-with.svg, which don't change.
// The logos are Simple Icons' (CC0), in badge-logos/.
import { makeBadge } from "badge-maker";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Tributary's colours, deep enough for white text: its dark background behind the labels,
// and the graph's lanes behind the values.
const LABEL = "#14161b";
const BLUE = "#0b7fc4";
const GREEN = "#16935b";
const AMBER = "#b87600";
const PINK = "#d4357c";
const VIOLET = "#6d4fe0";

// The installers: Windows setups, macOS disk images and update archives, Linux AppImages.
const INSTALLER = /(-setup\.exe|\.dmg|\.app\.tar\.gz|\.AppImage)$/;

/** A count as shields.io shows one: 135, 1.5k, 12k, 1.2M. */
export function short(count) {
  for (const [size, unit] of [
    [1e6, "M"],
    [1e3, "k"],
  ]) {
    if (count >= size) {
      const value = count / size;
      return `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)}${unit}`;
    }
  }
  return String(count);
}

/** How long ago `then` was, at `now`: today, yesterday, 3 days ago, last week, 2 months ago… */
export function ago(then, now) {
  const days = Math.floor((now - then) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "last year" : `${years} years ago`;
}

/** How many times the releases' installers were downloaded. */
export function installerDownloads(releases) {
  let total = 0;
  for (const release of releases)
    for (const asset of release.assets ?? []) if (INSTALLER.test(asset.name)) total += asset.download_count;
  return total;
}

function logo(name) {
  return `data:image/svg+xml;base64,${readFileSync(join(here, "badge-logos", `${name}.svg`)).toString("base64")}`;
}

/** Each badge's file name, and what it says, from the numbers GitHub gave. */
export function badges({ release, downloads, stars, lastCommit }) {
  return {
    "release.svg": { label: "release", message: release, color: BLUE },
    "downloads.svg": { label: "downloads", message: short(downloads), color: GREEN },
    "stars.svg": { label: "stars", message: short(stars), color: AMBER, logo: "github" },
    "last-commit.svg": { label: "last commit", message: lastCommit, color: PINK },
    "license.svg": { label: "license", message: "MIT", color: VIOLET },
    "windows.svg": { label: "Windows", message: "x64 | ARM64", color: BLUE },
    "macos.svg": { label: "macOS", message: "Apple Silicon | Intel", color: PINK, logo: "apple" },
    "linux.svg": { label: "Linux", message: "x64 | ARM64", color: AMBER, logo: "linux" },
    "built-with.svg": { label: "built with", message: "Rust · Tauri · React", color: VIOLET },
  };
}

/** A badge as an SVG file, in the README's style: flat, square, with Tributary's dark label. */
export function draw({ label, message, color, logo: name }) {
  return `${makeBadge({
    label,
    message,
    color,
    labelColor: LABEL,
    style: "flat-square",
    ...(name ? { logoBase64: logo(name) } : {}),
  })}\n`;
}

async function main(folder) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!folder || !repository || !token) throw new Error("usage: GITHUB_REPOSITORY=… GH_TOKEN=… node badges.mjs <folder>");
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const get = async (path) => {
    const response = await fetch(`${api}/repos/${repository}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
    return response.json();
  };

  const repo = await get("");
  const latest = await get("/releases/latest");
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await get(`/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const [commit] = await get(`/commits?sha=${encodeURIComponent(repo.default_branch)}&per_page=1`);

  const all = badges({
    release: latest.tag_name,
    downloads: installerDownloads(releases),
    stars: repo.stargazers_count,
    lastCommit: ago(new Date(commit.commit.committer.date), Date.now()),
  });
  mkdirSync(folder, { recursive: true });
  for (const [name, badge] of Object.entries(all)) {
    writeFileSync(join(folder, name), draw(badge));
    console.log(`${name}: ${badge.label} ${badge.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
