// next-version.mjs on small repositories laid out as Tributary's (develop, and main with its
// release tags), against a stand-in for GitHub's API that answers with the pull requests'
// labels.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "next-version.mjs");

// Each pull request's labels, by number.
let labels = {};
let server;
let api;
const folders = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const number = request.url.match(/^\/repos\/o\/r\/issues\/(\d+)\/labels/)?.[1];
    if (!number || !labels[number]) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(labels[number].map((name) => ({ name }))));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

afterEach(() => {
  labels = {};
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/**
 * A repository whose last release is v1.2.3: main, tagged, and develop from it. main is also
 * origin/main, as in a checkout of every branch.
 */
function repository() {
  const folder = mkdtempSync(join(tmpdir(), "next-version-"));
  folders.push(folder);
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=Someone", "-c", "user.email=someone@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: folder, encoding: "utf8" },
    );
  const fetchMain = () => git("update-ref", "refs/remotes/origin/main", "main");
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(folder, "package.json"), JSON.stringify({ version: "1.2.3" }));
  git("add", ".");
  git("commit", "--quiet", "-m", "The first release");
  git("tag", "v1.2.3");
  git("checkout", "--quiet", "-b", "develop");
  fetchMain();

  return {
    git,
    /** A pull request with this label, merged into develop. */
    merge(number, label) {
      labels[number] = [label];
      git("checkout", "--quiet", "-b", `change-${number}`, "develop");
      writeFileSync(join(folder, `${number}.txt`), "");
      git("add", ".");
      git("commit", "--quiet", "-m", `Change ${number}`);
      git("checkout", "--quiet", "develop");
      git("merge", "--quiet", "--no-ff", "-m", `Merge pull request #${number} from o/change-${number}`, `change-${number}`);
    },
    /** The pull request from develop into main merged: a release, not published yet. */
    release(number) {
      git("checkout", "--quiet", "main");
      git("merge", "--quiet", "--no-ff", "-m", `Merge pull request #${number} from o/develop`, "develop");
      git("checkout", "--quiet", "develop");
      fetchMain();
    },
    /** The release published, which tags it. */
    publish(tag) {
      git("tag", tag, "main");
    },
    /** A commit straight on main. */
    commitOnMain() {
      git("checkout", "--quiet", "main");
      git("commit", "--quiet", "--allow-empty", "-m", "Something else");
      git("checkout", "--quiet", "develop");
      fetchMain();
    },
    /** What the script says, on the branch that's checked out. */
    async version(...args) {
      const { stdout } = await promisify(execFile)("node", [script, ...args], {
        cwd: folder,
        env: { ...process.env, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "token", GITHUB_API_URL: api, GITHUB_STEP_SUMMARY: "" },
      });
      return stdout.trim();
    },
  };
}

describe("next-version.mjs", () => {
  it("raises the last release by the biggest change merged since", async () => {
    const repo = repository();
    repo.merge(1, "fix");
    repo.merge(2, "feature");
    repo.merge(3, "fix");
    expect(await repo.version()).toBe("1.3.0");
    expect(await repo.version("--beta")).toBe("1.3.0-beta.3");
  });

  it("numbers a beta after a release that's been published", async () => {
    const repo = repository();
    repo.merge(1, "fix");
    repo.merge(2, "feature");
    repo.release(3);
    repo.publish("v1.3.0");
    repo.merge(4, "feature");
    expect(await repo.version("--beta")).toBe("1.4.0-beta.1");
  });

  it("numbers a beta after a release that's been merged into main and isn't published yet", async () => {
    const repo = repository();
    repo.merge(1, "fix");
    repo.merge(2, "feature");
    repo.release(3);
    repo.merge(4, "feature");
    expect(await repo.version("--beta")).toBe("1.4.0-beta.1");
    repo.merge(5, "breaking");
    expect(await repo.version("--beta")).toBe("2.0.0-beta.2");
    // The same once it's published.
    repo.publish("v1.3.0");
    expect(await repo.version("--beta")).toBe("2.0.0-beta.2");
  });

  it("numbers a beta of develop as it was merged into main before that release", async () => {
    const repo = repository();
    repo.merge(1, "fix");
    repo.merge(2, "feature");
    repo.release(3);
    expect(await repo.version("--beta")).toBe("1.3.0-beta.2");
  });

  it("gives the release being built the version after the tag before", async () => {
    const repo = repository();
    repo.merge(1, "fix");
    repo.merge(2, "feature");
    repo.release(3);
    repo.git("checkout", "--quiet", "main");
    expect(await repo.version()).toBe("1.3.0");
  });

  it("counts from the tag when main's tip isn't a merge of develop", async () => {
    const repo = repository();
    repo.commitOnMain();
    repo.merge(1, "feature");
    expect(await repo.version("--beta")).toBe("1.3.0-beta.1");
  });

  it("stops a beta when main isn't fetched", async () => {
    const repo = repository();
    repo.git("update-ref", "-d", "refs/remotes/origin/main");
    repo.merge(1, "fix");
    await expect(repo.version("--beta")).rejects.toThrow(/origin\/main/);
  });
});
