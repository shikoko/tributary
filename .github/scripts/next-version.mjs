// The version of the next release, worked out from the last release and the pull requests
// merged into develop since, by their labels:
//
//   breaking  1.2.3 → 2.0.0
//   feature   1.2.3 → 1.3.0
//   fix       1.2.3 → 1.2.4 (and a pull request without a label)
//
// The biggest change decides: two features and a fix since 1.2.3 make 1.3.0.
//
//   node .github/scripts/next-version.mjs         the release's version, like 1.3.0
//   node .github/scripts/next-version.mjs --beta  a beta, built from develop, like 1.3.0-beta.3
//                                                 (the third pull request since 1.2.3), which
//                                                 comes before 1.3.0 and after 1.3.0-beta.2
//
// The last release is the newest tag like v1.2.3 (a release's tag appears when it's
// published). Before the first release, the version is the one in package.json.
// Needs the whole history and its tags (actions/checkout with fetch-depth: 0), and
// GH_TOKEN to read the pull requests' labels.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const KINDS = ["fix", "feature", "breaking"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** The newest release tag, or undefined before the first release. */
function lastRelease() {
  const numbers = (tag) => tag.match(RELEASE).slice(1).map(Number);
  return git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => RELEASE.test(tag))
    .sort((a, b) => {
      const [x, y] = [numbers(a), numbers(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
}

/** The pull requests merged into develop since `since` (a tag), from their merge commits. */
function mergedSince(since) {
  const subjects = git("log", "--merges", "--format=%s", since ? `${since}..HEAD` : "HEAD").split("\n");
  const numbers = [];
  for (const subject of subjects) {
    const found = subject.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
    // develop going into main, or main back into develop, isn't a change of its own.
    if (found && found[2] !== "develop" && found[2] !== "main") numbers.push(Number(found[1]));
  }
  return [...new Set(numbers)];
}

/** A pull request's kind of change, from its labels. */
async function kind(number) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are needed to read the labels");
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${api}/repos/${repository}/issues/${number}/labels?per_page=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`Couldn't read the labels of #${number} (${response.status})`);
  const labels = (await response.json()).map((label) => label.name);
  return KINDS.findLast((name) => labels.includes(name)) ?? "fix";
}

// --dev is what builds of develop were called before they were betas.
const beta = process.argv.includes("--beta") || process.argv.includes("--dev");
const last = lastRelease();
const merged = mergedSince(last);
// Before the first release, the labels don't change anything.
const kinds = last ? await Promise.all(merged.map(kind)) : merged.map(() => "");

let version;
if (!last) {
  version = JSON.parse(readFileSync("package.json", "utf8")).version;
} else {
  const [major, minor, patch] = last.match(RELEASE).slice(1).map(Number);
  const biggest = Math.max(0, ...kinds.map((name) => KINDS.indexOf(name)));
  version = [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`][biggest];
}
if (beta) version += `-beta.${merged.length}`;

// What it was worked out from, on the run's page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = merged.map((number, index) => `- #${number}${kinds[index] ? `: ${kinds[index]}` : ""}`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Version ${version}\n\n${last ? `Since ${last}` : "Before the first release (the version in package.json)"}: ${
      merged.length ? `\n\n${lines.join("\n")}\n` : "no pull requests.\n"
    }\n`,
  );
}
console.log(version);
