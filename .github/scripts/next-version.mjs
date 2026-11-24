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
// The last release is the newest tag like v1.2.3. Before the first release, the version is
// the one in package.json.
//
// A release's tag only appears when it's published, at the end of the release build on main,
// about 40 minutes after its pull request (develop into main) is merged. A pull request merged
// into develop in that time isn't in the release, so its beta comes after it. Counted from the
// release before, it would be a beta of the release that's being published (1.3.0-beta.4 after
// 1.3.0 was merged), which is older than that release, so no copy of Tributary on it would be
// offered the beta. So for a beta, a release that's been merged into main but not tagged yet is
// the last release: main's tip, when it's the merge of a pull request from develop with no tag
// like v1.2.3 on it, and the beta's commit isn't in it (develop as it was merged into main is
// still a beta of that release). Its version is the one the release build works out for it
// (this script on main, without --beta), so a beta of what was merged after it gets the same
// number before the tag appears as after. The release build itself counts from the tag before:
// main's tip is what it's building.
//
// Needs the whole history, the tags and main (actions/checkout with fetch-depth: 0, which
// fetches every branch: main is origin/main), and GH_TOKEN to read the pull requests' labels.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const KINDS = ["fix", "feature", "breaking"];
const MAIN = "refs/remotes/origin/main";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gitSucceeds = (...args) => {
  try {
    execFileSync("git", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** The newest release tag, or undefined before the first release. */
function lastTag() {
  const numbers = (tag) => tag.match(RELEASE).slice(1).map(Number);
  return git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => RELEASE.test(tag))
    .sort((a, b) => {
      const [x, y] = [numbers(a), numbers(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
}

/** main's tip, if it's a release that's been merged but not published yet (above). */
function beingPublished() {
  if (!gitSucceeds("rev-parse", "--verify", "--quiet", `${MAIN}^{commit}`)) {
    throw new Error(
      "main isn't fetched (origin/main), so there's no knowing whether a release is being published: check out with fetch-depth: 0",
    );
  }
  if (git("tag", "--points-at", MAIN).split("\n").some((tag) => RELEASE.test(tag))) return undefined;
  if (!/^Merge pull request #\d+ from [^/\s]+\/develop$/.test(git("log", "-1", "--format=%s", MAIN))) return undefined;
  if (gitSucceeds("merge-base", "--is-ancestor", "HEAD", MAIN)) return undefined;
  return git("rev-parse", MAIN);
}

/** The pull requests merged into develop after `since` (a commit), up to `until`, from their merge commits. */
function mergedSince(since, until) {
  const subjects = git("log", "--merges", "--format=%s", since ? `${since}..${until}` : until).split("\n");
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

/**
 * The version of a release made from `until`, with the pull requests merged since the last
 * release (`last`: its version and its commit, or undefined before the first) and their kinds.
 */
async function releaseOf(until, last) {
  const merged = mergedSince(last?.commit, until);
  // Before the first release, the labels don't change anything.
  if (!last) {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    return { version, merged, kinds: merged.map(() => "") };
  }
  const kinds = await Promise.all(merged.map(kind));
  const [major, minor, patch] = last.version.split(".").map(Number);
  const biggest = Math.max(0, ...kinds.map((name) => KINDS.indexOf(name)));
  const version = [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`][biggest];
  return { version, merged, kinds };
}

// --dev is what builds of develop were called before they were betas.
const beta = process.argv.includes("--beta") || process.argv.includes("--dev");
const tag = lastTag();
let last = tag && { version: tag.slice(1), commit: tag, name: tag };
const publishing = beta ? beingPublished() : undefined;
if (publishing) {
  const { version } = await releaseOf(publishing, last);
  last = { version, commit: publishing, name: `v${version}, merged into main and not published yet` };
}
const { version: release, merged, kinds } = await releaseOf("HEAD", last);
const version = beta ? `${release}-beta.${merged.length}` : release;

// What it was worked out from, on the run's page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = merged.map((number, index) => `- #${number}${kinds[index] ? `: ${kinds[index]}` : ""}`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Version ${version}\n\n${last ? `Since ${last.name}` : "Before the first release (the version in package.json)"}: ${
      merged.length ? `\n\n${lines.join("\n")}\n` : "no pull requests.\n"
    }\n`,
  );
}
console.log(version);
