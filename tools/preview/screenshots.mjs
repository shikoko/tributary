// The README's screenshots, taken in the browser preview from the demo repositories, so
// they can be taken again whenever the interface changes:
//
//   npm run preview:build && node tools/preview/screenshots.mjs [<folder>] [--only <name>,…]
//
// They're written to docs/images (or <folder>) at twice the size, for sharp screens. The
// demos are made up (people, history, pull requests), so nobody's own details show.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemos, demoEnv, STUDIO_PULL_REQUEST_CONVERSATIONS, STUDIO_PULL_REQUEST_DETAILS, STUDIO_PULL_REQUESTS } from "./demo.mjs";
import { startLockServer } from "./lfs-locks.mjs";
import { startPreview } from "./server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(",")) : null;
const out = resolve(args.find((arg, index) => !arg.startsWith("--") && (onlyAt < 0 || index !== onlyAt + 1)) ?? join(here, "..", "..", "docs", "images"));
mkdirSync(out, { recursive: true });

const { chromium } = createRequire(import.meta.url)("playwright");
// Always the same folder, so the paths in the pictures stay the same from one run to the next.
const projects = join(tmpdir(), "tributary-docs", "Projects");
const locks = await startLockServer({ port: 0 });
let demos;
/** Demo repositories as they're made, for a shot that changes them. */
const fresh = () => {
  rmSync(projects, { recursive: true, force: true });
  mkdirSync(projects, { recursive: true });
  demos = buildDemos(projects, { lockServer: locks.url });
  return demos;
};
fresh();
const preview = await startPreview({ port: 0, quiet: true, env: demoEnv(demos) });
const browser = await chromium.launch();

const people = {
  maya: { GIT_AUTHOR_NAME: "Maya Chen", GIT_AUTHOR_EMAIL: "maya@example.com", GIT_COMMITTER_NAME: "Maya Chen", GIT_COMMITTER_EMAIL: "maya@example.com" },
  priya: { GIT_AUTHOR_NAME: "Priya Nair", GIT_AUTHOR_EMAIL: "priya@example.com", GIT_COMMITTER_NAME: "Priya Nair", GIT_COMMITTER_EMAIL: "priya@example.com" },
};
const git = (folder, args, who = people.maya, input) =>
  execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", env: { ...process.env, ...demoEnv(demos), ...who }, input }).trim();

/** A new window on the preview, opening `repo` (or the start screen without one). */
async function open(repo, { theme = "dark", preview: fakes = {}, storage = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("  page error:", String(error)));
  await page.addInitScript(
    ([pick, fakes, storage, theme]) => {
      window.__PREVIEW__ = { pick, pullRequests: [], ...fakes };
      localStorage.setItem("tributary.fetch.auto", "false");
      localStorage.setItem("tributary.appearance", JSON.stringify({ theme }));
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
    },
    [repo ?? null, fakes, storage, theme],
  );
  await page.goto(preview.url);
  if (repo) {
    await page.getByText("Open repository").first().click();
    await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
    // The notebook's submodule notice isn't what these are about.
    const notice = page.getByRole("button", { name: "Not now" });
    await notice.click({ timeout: 3000 }).catch(() => {});
  }
  return page;
}

const row = (page, summary) => page.locator(".commit-row", { has: page.locator(".summary", { hasText: new RegExp(`^${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first();
const settle = (page, ms = 500) => page.waitForTimeout(ms);

const shots = {
  /** The commit graph, with a merge commit's details. */
  async overview() {
    const page = await open(demos.notebook);
    await row(page, "Merge pull request #18 from feature/sync").click();
    await page.locator(".details", { hasText: "Merge pull request #18" }).waitFor();
    await settle(page);
    return page;
  },

  /** Your changes side by side, coloured by syntax. */
  async "side-by-side"() {
    const store = join(fresh().notebook, "src", "store.ts");
    let text = readFileSync(store, "utf8").replace("const VERSION = 2;", "const VERSION = 3;").replace("const PAGE_SIZE = 200;", "const PAGE_SIZE = 500;");
    writeFileSync(store, `${text}\n// Old notes are compacted once a week.\nexport const COMPACT_DAYS = 7;\n`);
    const page = await open(demos.notebook, { storage: { "tributary.diff.sideBySide": true } });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click();
    await page.locator(".diff-split-row").first().waitFor();
    await settle(page);
    return page;
  },

  /** Lines chosen to stage, in one column. */
  async "stage-lines"() {
    const store = join(fresh().notebook, "src", "store.ts");
    const text = readFileSync(store, "utf8").replace("const VERSION = 2;", "const VERSION = 3;").replace("const PAGE_SIZE = 200;", "const PAGE_SIZE = 500;");
    writeFileSync(store, `${text}\n// Old notes are compacted once a week.\nexport const COMPACT_DAYS = 7;\n`);
    const page = await open(demos.notebook);
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-row.removed", { hasText: "VERSION = 2" }).locator(".diff-number").first().click();
    await view.locator(".diff-row.added", { hasText: "VERSION = 3" }).locator(".diff-number").nth(1).click({ modifiers: ["Shift"] });
    await page.locator(".line-bar").waitFor();
    await settle(page);
    return page;
  },

  /** A merge conflict, resolved here. */
  async conflicts() {
    const folder = fresh().notebook;
    const store = join(folder, "src", "store.ts");
    const before = readFileSync(store, "utf8");
    git(folder, ["stash", "push", "-q", "--include-untracked"]);
    git(folder, ["switch", "-q", "-c", "feature/storage-v4"], people.priya);
    writeFileSync(store, before.replace("const VERSION = 2;", "const VERSION = 4;").replace("const PAGE_SIZE = 200;", "const PAGE_SIZE = 250;"));
    git(folder, ["commit", "-q", "-am", "Move notes to storage version 4"], people.priya);
    git(folder, ["switch", "-q", "main"]);
    writeFileSync(store, before.replace("const VERSION = 2;", "const VERSION = 3;").replace("const PAGE_SIZE = 200;", "const PAGE_SIZE = 500;"));
    git(folder, ["commit", "-q", "-am", "Load more notes at once"]);
    try {
      git(folder, ["merge", "feature/storage-v4"]);
    } catch {
      // It stops with the conflict, as it should.
    }
    const page = await open(folder);
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .conflicts .file", { hasText: "store.ts" }).click();
    const card = page.locator(".conflict-card").first();
    await card.waitFor();
    await card.getByRole("button", { name: "Mine, then theirs" }).click();
    await settle(page);
    return page;
  },

  /** Who changed each line, with the step back to before a change. */
  async blame() {
    const page = await open(fresh().notebook);
    await row(page, "Speed up opening large notebooks").click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Who changed each line" }).click();
    const priya = page.locator(".blame-gutter-cell", { has: page.locator(".blame-gutter", { hasText: "Priya Nair" }) }).first();
    await priya.waitFor();
    await priya.hover();
    await settle(page);
    return page;
  },

  /** A branch compared with the checked-out one. */
  async compare() {
    const page = await open(demos.notebook);
    await page.locator(".commit-list .ref-pill[title^='Branch feature/export (local']").first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Compare with main" }).click();
    await page.locator(".compare-panel .file", { hasText: "zip.ts" }).waitFor();
    // Off the commit list, so no commit's preview pops up.
    await page.locator(".compare-panel").hover({ position: { x: 200, y: 600 } });
    await settle(page, 800);
    return page;
  },

  /** A pull request's reviews and checks. */
  async "pull-request"() {
    const page = await open(fresh().studio, {
      preview: { pullRequests: STUDIO_PULL_REQUESTS, pullRequestDetails: STUDIO_PULL_REQUEST_DETAILS, conversations: STUDIO_PULL_REQUEST_CONVERSATIONS },
    });
    await page.locator(".pr-badge", { hasText: "#14" }).first().click();
    await page.locator(".request-view .request-check").first().waitFor();
    await settle(page);
    return page;
  },

  /** A pull request's conversation, with a reply being written. */
  async review() {
    const page = await open(fresh().studio, {
      preview: { pullRequests: STUDIO_PULL_REQUESTS, pullRequestDetails: STUDIO_PULL_REQUEST_DETAILS, conversations: STUDIO_PULL_REQUEST_CONVERSATIONS },
    });
    await page.locator(".pr-badge", { hasText: "#12" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-conversation").waitFor();
    await view.locator(".request-reply").first().click();
    await view.locator(".comment-box textarea").first().fill("Makes sense. Approving once the scissors are in.");
    await view.locator(".request-section", { hasText: "Conversation" }).evaluate((section) => section.scrollIntoView({ block: "start" }));
    await settle(page);
    return page;
  },

  /** A Photoshop texture's changed pixels. */
  async textures() {
    const page = await open(fresh().studio);
    await row(page, "Sign: paint a mug of ale next to the mark").click();
    await page.locator(".details .file", { hasText: "TavernSign.psd" }).click();
    await page.locator(".diff-image-modes button", { hasText: "Changed pixels" }).click();
    await page.locator(".diff-pixels-summary", { hasText: "pixels changed" }).waitFor();
    await settle(page);
    return page;
  },

  /** An Unreal level's actors, saved one per file, by their names. */
  async actors() {
    const page = await open(fresh().studio);
    await row(page, "Move the fireplace to the back wall, and swap the old bench for a long one").click();
    await page.locator(".details .file-name.actor").first().waitFor();
    await settle(page);
    return page;
  },

  /** Jira issues a commit mentions, with their titles and states. */
  async issues() {
    const studio = fresh().studio;
    git(studio, ["stash", "push", "-q", "--include-untracked"]);
    writeFileSync(join(studio, "Config", "DefaultGame.ini"), "[/Script/EngineSettings.GeneralProjectSettings]\nProjectName=Feast of the Forgotten\nApronPhysics=True\n");
    git(studio, ["commit", "-q", "-am", "FEAST-12: leather apron sways with the barber\n\nCloth physics on the apron, tuned so it doesn't clip the chair. Also tidies FEAST-9."], people.maya);
    const all = [
      { key: "FEAST-12", title: "Barber's apron should be leather", status: "In Review", done: false, url: "https://studio.atlassian.net/browse/FEAST-12" },
      { key: "FEAST-9", title: "Barber clips through the chair", status: "Done", done: true, url: "https://studio.atlassian.net/browse/FEAST-9" },
      { key: "FEAST-23", title: "Tavern sign: add the opening hours", status: "In Progress", done: false, url: "https://studio.atlassian.net/browse/FEAST-23" },
      { key: "FEAST-21", title: "Door creak is too loud", status: "To Do", done: false, url: "https://studio.atlassian.net/browse/FEAST-21" },
    ];
    const page = await open(studio, {
      preview: { issues: { all, mine: ["FEAST-23", "FEAST-21"], user: "Maya Chen" } },
      storage: { [`tributary.issueTracker:${studio}`]: { kind: "jira", site: "https://studio.atlassian.net", keys: ["FEAST"] } },
    });
    await row(page, "FEAST-12: leather apron sways with the barber").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "New branch here" }).click();
    await page.locator(".dialog select").selectOption("FEAST-23");
    await page.locator(".mentioned-issues").waitFor();
    await settle(page);
    return page;
  },

  /** A bisect that found the first bad commit. */
  async bisect() {
    const folder = fresh().notebook;
    git(folder, ["stash", "push", "-q", "--include-untracked"]);
    const subjects = ["Cache rendered notes", "Faster search index", "Lazy-load attachments", "Trim the note list's memory", "Batch database writes", "Smaller sync payloads", "Reuse the editor between notes"];
    subjects.forEach((subject, n) => {
      writeFileSync(join(folder, `perf-${n}.txt`), subject);
      git(folder, ["add", `perf-${n}.txt`]);
      git(folder, ["commit", "-q", "-m", subject], n % 2 ? people.priya : people.maya);
    });
    const page = await open(folder);
    await row(page, "Prepare the 0.3 release notes").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Find what broke" }).click();
    await page.getByRole("button", { name: "Start bisecting" }).click();
    const bar = page.locator(".bisect-bar");
    await bar.filter({ hasText: "good or bad" }).waitFor();
    for (let step = 0; step < 6 && !(await bar.filter({ hasText: "Found it" }).count()); step++) {
      const testing = await bar.locator(".operation-text").innerText();
      const index = subjects.findIndex((subject) => testing.includes(subject));
      await bar.getByRole("button", { name: index >= subjects.indexOf("Batch database writes") ? "Bad" : "Good", exact: true }).click();
      await page.waitForTimeout(700);
    }
    await bar.filter({ hasText: "Found it" }).waitFor();
    await page.locator(".toast").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    await settle(page);
    return page;
  },

  /** What the team has been working on. */
  async team() {
    const page = await open(fresh().studio);
    await page.locator(".menu-bar-item", { hasText: "View" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Team Activity" }).click();
    await page.locator(".team-view .team-person").first().waitFor();
    await settle(page);
    return page;
  },

  /** A 3D model before and after. */
  async media() {
    const page = await open(demos.studio);
    await page.locator(".commit-row", { hasText: "A slower door with a longer creak" }).first().click();
    await page.locator(".details .file", { hasText: "DoorCreak.wav" }).click();
    await page.locator(".diff-view .diff-waveform").nth(1).waitFor();
    await page.keyboard.press("]");
    await page.keyboard.press("]");
    await page.locator(".diff-model-facts").waitFor({ timeout: 20_000 });
    await settle(page, 1500);
    return page;
  },

  /** The light theme, with the appearance settings. */
  async appearance() {
    const page = await open(demos.studio, { theme: "light" });
    await page.keyboard.press("Control+Comma");
    await page.getByRole("tab", { name: "Appearance" }).click();
    await settle(page);
    return page;
  },

  /** The start screen, with where each recent repository stands. */
  async start() {
    const now = Date.now();
    const recent = [
      { path: demos.notebook, name: "notebook", openedAt: now - 3_600_000, branch: "main", pinned: true },
      { path: demos.studio, name: "studio", openedAt: now - 86_400_000, branch: "main" },
      { path: join(projects, "old-prototype"), name: "old-prototype", openedAt: now - 30 * 86_400_000, branch: "main" },
    ];
    const page = await open(null, { storage: { "tributary.recentRepositories": recent, "tributary.reopenLast": false } });
    await page.locator(".recent-chip.changes").first().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    return page;
  },
};

/** Shots whose hover is part of the picture. */
const HOVERED = new Set(["blame", "compare"]);

let failed = 0;
for (const [name, shoot] of Object.entries(shots)) {
  if (only && !only.has(name)) continue;
  try {
    const page = await shoot();
    // No focus rings or hover states left from clicking (blame shows its hover on purpose).
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    if (!HOVERED.has(name)) await page.mouse.move(900, 18);
    await settle(page, 400);
    await page.screenshot({ path: join(out, `${name}.png`) });
    await page.close();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}\n      ${String(error).split("\n").join("\n      ")}`);
  }
}
await browser.close();
await preview.close?.();
await locks.close?.();
rmSync(join(tmpdir(), "tributary-docs"), { recursive: true, force: true });
console.log(failed ? `${failed} failed` : `Saved to ${out}`);
process.exit(failed ? 1 : 0);
