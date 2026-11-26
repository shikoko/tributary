// The numbers on the README's badges, published with the website (in site/badges/, by the
// Website workflow) for shields.io's endpoint badges to draw. shields.io then reads a small
// file from the website rather than asking GitHub's API itself, which at times takes too
// long, leaving a broken badge.
//
//   node .github/scripts/badges.mjs <folder>
//
// Needs GITHUB_REPOSITORY and GH_TOKEN (and GITHUB_API_URL for another API, as the tests do).
// Writes, as shields.io's endpoint format:
// - release.json: the latest release's version;
// - downloads.json: how many times the installers were downloaded, from every release, by
//   hand or by automatic updates. Not latest.json, which every check for updates downloads,
//   nor the update signatures;
// - stars.json: the stars on GitHub;
// - last-commit.json: how long ago the default branch (develop) last changed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Tributary's colours, deep enough for white text: its dark background behind the labels,
// and the graph's lanes behind the values.
const LABEL = "14161b";
const COLOURS = { release: "0b7fc4", downloads: "16935b", stars: "b87600", lastCommit: "d4357c" };

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

function badge(label, message, color, extra = {}) {
  return { schemaVersion: 1, label, message, color, labelColor: LABEL, cacheSeconds: 3600, ...extra };
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

  const badges = {
    "release.json": badge("release", latest.tag_name, COLOURS.release),
    "downloads.json": badge("downloads", short(installerDownloads(releases)), COLOURS.downloads),
    "stars.json": badge("stars", short(repo.stargazers_count), COLOURS.stars, { namedLogo: "github" }),
    "last-commit.json": badge("last commit", ago(new Date(commit.commit.committer.date), Date.now()), COLOURS.lastCommit),
  };
  mkdirSync(folder, { recursive: true });
  for (const [name, content] of Object.entries(badges)) {
    writeFileSync(join(folder, name), `${JSON.stringify(content)}\n`);
    console.log(`${name}: ${content.label} ${content.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
