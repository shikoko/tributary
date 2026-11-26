// badges.mjs: its counts and dates, and the files it writes from a stand-in for GitHub's API.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ago, installerDownloads, short } from "./badges.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "badges.mjs");
const DAY = 86_400_000;

describe("short", () => {
  it("counts as shields.io does", () => {
    expect(short(0)).toBe("0");
    expect(short(135)).toBe("135");
    expect(short(999)).toBe("999");
    expect(short(1000)).toBe("1k");
    expect(short(1459)).toBe("1.5k");
    expect(short(12_345)).toBe("12k");
    expect(short(1_234_567)).toBe("1.2M");
  });
});

describe("ago", () => {
  const now = Date.UTC(2026, 10, 26, 12);
  it("says how long ago, in days, weeks, months and years", () => {
    expect(ago(now - 3_600_000, now)).toBe("today");
    expect(ago(now - DAY, now)).toBe("yesterday");
    expect(ago(now - 3 * DAY, now)).toBe("3 days ago");
    expect(ago(now - 8 * DAY, now)).toBe("last week");
    expect(ago(now - 20 * DAY, now)).toBe("2 weeks ago");
    expect(ago(now - 40 * DAY, now)).toBe("last month");
    expect(ago(now - 100 * DAY, now)).toBe("3 months ago");
    expect(ago(now - 400 * DAY, now)).toBe("last year");
    expect(ago(now - 800 * DAY, now)).toBe("2 years ago");
  });
});

describe("installerDownloads", () => {
  it("counts the installers, not the update checks or signatures", () => {
    const releases = [
      {
        assets: [
          { name: "Tributary_0.20.0_x64-setup.exe", download_count: 100 },
          { name: "Tributary_0.20.0_x64-setup.exe.sig", download_count: 40 },
          { name: "Tributary_0.20.0_universal.dmg", download_count: 30 },
          { name: "Tributary.app.tar.gz", download_count: 20 },
          { name: "Tributary.app.tar.gz.sig", download_count: 20 },
          { name: "Tributary_0.20.0_amd64.AppImage", download_count: 10 },
          { name: "latest.json", download_count: 900 },
        ],
      },
      { assets: [{ name: "Tributary_0.19.0_arm64-setup.exe", download_count: 5 }] },
      {},
    ];
    expect(installerDownloads(releases)).toBe(165);
  });
});

describe("the files it writes", () => {
  let server;
  let api;
  let folder;
  const requests = [];

  beforeAll(async () => {
    // 150 releases, so they come in two pages of GitHub's at most 100.
    const releases = Array.from({ length: 150 }, (_, i) => ({
      tag_name: `v0.${i}.0`,
      assets: [
        { name: `Tributary_0.${i}.0_x64-setup.exe`, download_count: 10 },
        { name: "latest.json", download_count: 50 },
      ],
    }));
    const answers = {
      "/repos/o/r": { default_branch: "develop", stargazers_count: 1234 },
      "/repos/o/r/releases/latest": { tag_name: "v0.20.0" },
      "/repos/o/r/releases?per_page=100&page=1": releases.slice(0, 100),
      "/repos/o/r/releases?per_page=100&page=2": releases.slice(100),
      "/repos/o/r/commits?sha=develop&per_page=1": [
        { commit: { committer: { date: new Date(Date.now() - 2 * DAY).toISOString() } } },
      ],
    };
    server = createServer((request, response) => {
      requests.push({ url: request.url, auth: request.headers.authorization });
      const answer = answers[request.url];
      if (!answer) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(answer));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    api = `http://127.0.0.1:${server.address().port}`;
    folder = mkdtempSync(join(tmpdir(), "badges-"));
  });

  afterAll(() => {
    server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("writes each badge for shields.io's endpoint badge", async () => {
    await promisify(execFile)(process.execPath, [script, folder], {
      env: { ...process.env, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "token", GITHUB_API_URL: api },
    });
    const read = (name) => JSON.parse(readFileSync(join(folder, name), "utf8"));
    const common = { schemaVersion: 1, labelColor: "14161b", cacheSeconds: 3600 };
    expect(read("release.json")).toEqual({ ...common, label: "release", message: "v0.20.0", color: "0b7fc4" });
    expect(read("downloads.json")).toEqual({ ...common, label: "downloads", message: "1.5k", color: "16935b" });
    expect(read("stars.json")).toEqual({ ...common, label: "stars", message: "1.2k", color: "b87600", namedLogo: "github" });
    expect(read("last-commit.json")).toEqual({ ...common, label: "last commit", message: "2 days ago", color: "d4357c" });
    expect(requests.every((request) => request.auth === "Bearer token")).toBe(true);
  });

  it("fails, writing nothing, when GitHub doesn't answer", async () => {
    const empty = mkdtempSync(join(tmpdir(), "badges-"));
    try {
      const run = promisify(execFile)(process.execPath, [script, empty], {
        env: { ...process.env, GITHUB_REPOSITORY: "o/missing", GH_TOKEN: "token", GITHUB_API_URL: api },
      });
      await expect(run).rejects.toMatchObject({ stderr: expect.stringContaining("GitHub answered 404") });
      expect(() => readFileSync(join(empty, "release.json"))).toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
