// beta-channel.sh against a stand-in for gh that keeps the repository in a folder, and
// answers as gh does: GitHub's JSON on stdout, and a failure for a 404.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "beta-channel.sh");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The stand-in. $STATE holds the branch's file (file), whether the branch is there (branch),
// what was sent (calls), and whether the release tagged beta can change (frozen).
const GH = `#!/usr/bin/env bash
echo "$*" >> "$STATE/calls"
missing() { echo '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
decode() { node -e 'process.stdout.write(Buffer.from(JSON.parse(require("fs").readFileSync(0, "utf8")).content, "base64"))'; }
case "$*" in
  "api repos/o/r/contents/beta/latest.json?ref=updates -H Accept: application/vnd.github.raw")
    [ -f "$STATE/file" ] && cat "$STATE/file" || missing ;;
  "api repos/o/r/contents/beta/latest.json?ref=updates --jq .sha") [ -f "$STATE/file" ] && echo old-sha || missing ;;
  "api repos/o/r/branches/updates") [ -f "$STATE/branch" ] && echo '{"name":"updates"}' || missing ;;
  "api -X PUT repos/o/r/contents/beta/latest.json --input -")
    body=$(cat); echo "$body" > "$STATE/put.json"; decode <<<"$body" > "$STATE/file"; echo '{}' ;;
  "api -X POST repos/o/r/git/blobs --input - --jq .sha") decode > "$STATE/blob"; echo blob-sha ;;
  "api -X POST repos/o/r/git/trees --input - --jq .sha") cat > "$STATE/tree.json"; echo tree-sha ;;
  "api -X POST repos/o/r/git/commits --input - --jq .sha") cat > "$STATE/commit.json"; echo commit-sha ;;
  "api -X POST repos/o/r/git/refs --input -") cat > "$STATE/ref.json"; touch "$STATE/branch"; cp "$STATE/blob" "$STATE/file"; echo '{}' ;;
  "release view beta --repo o/r") ;;
  "release upload beta "*" --repo o/r --clobber") [ -f "$STATE/frozen" ] && { echo "HTTP 422: immutable" >&2; exit 1; } || cp "$4" "$STATE/release" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`;

describe.skipIf(process.platform === "win32")("the beta channel", () => {
  let folder;
  let state;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "beta-channel-"));
    state = join(folder, "state");
    mkdirSync(join(folder, "bin"));
    mkdirSync(state);
    writeFileSync(join(folder, "bin", "gh"), GH);
    chmodSync(join(folder, "bin", "gh"), 0o755);
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  /** Points the channel at `version`; what it printed. */
  const point = (version) => {
    const manifest = join(folder, "latest.json");
    writeFileSync(manifest, JSON.stringify({ version, platforms: {} }));
    const run = spawnSync("bash", [script, manifest], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(folder, "bin")}:${process.env.PATH}`, STATE: state, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "x" },
    });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout;
  };
  const offered = () => JSON.parse(readFileSync(join(state, "file"), "utf8")).version;
  const json = (name) => JSON.parse(readFileSync(join(state, name), "utf8"));

  it("makes the branch the first time, with only the channel on it", () => {
    expect(point("0.17.1-beta.1")).toContain("The beta channel offers 0.17.1-beta.1 now.");
    expect(offered()).toBe("0.17.1-beta.1");
    expect(json("tree.json").tree).toEqual([{ path: "beta/latest.json", mode: "100644", type: "blob", sha: "blob-sha" }]);
    expect(json("commit.json").parents).toEqual([]);
    expect(json("ref.json")).toEqual({ ref: "refs/heads/updates", sha: "commit-sha" });
    // The release tagged beta follows, for copies of 0.17.0 and earlier.
    expect(JSON.parse(readFileSync(join(state, "release"), "utf8")).version).toBe("0.17.1-beta.1");
  });

  it("points it at a newer version, and leaves it for an older one", () => {
    point("0.17.1-beta.1");
    expect(point("0.17.1-beta.2")).toContain("offers 0.17.1-beta.2 now (it offered 0.17.1-beta.1)");
    expect(json("put.json")).toMatchObject({ branch: "updates", sha: "old-sha", message: "Beta channel: 0.17.1-beta.2" });
    expect(offered()).toBe("0.17.1-beta.2");
    expect(point("0.17.1-beta.1")).toContain("offers 0.17.1-beta.2, which is newer than 0.17.1-beta.1");
    expect(offered()).toBe("0.17.1-beta.2");
    // A release is newer than its betas.
    point("0.17.1");
    expect(offered()).toBe("0.17.1");
  });

  it("goes on when the release tagged beta can't change any more", () => {
    writeFileSync(join(state, "frozen"), "");
    expect(point("0.17.1-beta.1")).toContain("::warning::The release tagged beta couldn't be pointed at 0.17.1-beta.1");
    expect(offered()).toBe("0.17.1-beta.1");
    expect(existsSync(join(state, "release"))).toBe(false);
  });

  it("is what CI's bash reads", () => {
    execFileSync("bash", ["-n", script]);
  });
});
