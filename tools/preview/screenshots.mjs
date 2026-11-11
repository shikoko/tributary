// The README's screenshots, taken in the browser preview from the demo repositories, so
// they can be taken again whenever the interface changes:
//
//   npm run preview:build && node tools/preview/screenshots.mjs [<folder>] [--only <name>,…]
//
// They're written to docs/images (or <folder>) at twice the size, for sharp screens. The
// README's opening image and the social preview are made from the overview (hero.html). The
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
  rosa: { GIT_AUTHOR_NAME: "Rosa Bell", GIT_AUTHOR_EMAIL: "rosa@example.com", GIT_COMMITTER_NAME: "Rosa Bell", GIT_COMMITTER_EMAIL: "rosa@example.com" },
  theo: { GIT_AUTHOR_NAME: "Theo Park", GIT_AUTHOR_EMAIL: "theo@example.com", GIT_COMMITTER_NAME: "Theo Park", GIT_COMMITTER_EMAIL: "theo@example.com" },
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
      // Not someone new: no welcome tour, no What's new.
      localStorage.setItem("tributary.whatsNew.seen", JSON.stringify("999.0.0"));
      localStorage.setItem("tributary.tours.off", "true");
      localStorage.setItem("tributary.appearance", JSON.stringify({ theme }));
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
    },
    [repo ?? null, fakes, storage, theme],
  );
  await page.goto(preview.url);
  if (repo) {
    await page.getByText("Open repository").first().click();
    await page.locator(".commit-row, .simple-view").first().waitFor({ timeout: 20_000 });
    // The notebook's submodule notice isn't what these are about.
    const notice = page.getByRole("button", { name: "Not now" });
    await notice.click({ timeout: 3000 }).catch(() => {});
  }
  return page;
}

const row = (page, summary) => page.locator(".commit-row", { has: page.locator(".summary", { hasText: new RegExp(`^${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first();
const settle = (page, ms = 500) => page.waitForTimeout(ms);

/**
 * The studio on a branch for the FEAST-23 issue, with a team commit template, a new file
 * staged and a message written for it.
 */
async function issueBranch() {
  const folder = fresh().studio;
  // Without the demo's own changes: just the new file.
  git(folder, ["stash", "push", "-q", "-u"]);
  git(folder, ["stash", "drop", "-q"]);
  git(folder, ["switch", "-q", "-c", "FEAST-23-tavern-sign"]);
  writeFileSync(join(folder, ".git", "team-template.txt"), "# Say what changed and why.\n\nWhy:\n\nHow to test:\n");
  git(folder, ["config", "commit.template", join(folder, ".git", "team-template.txt")]);
  writeFileSync(join(folder, "Notes.txt"), "Opening hours: noon till late\n");
  const page = await open(folder, { storage: { [`tributary.issueTracker:${folder}`]: { kind: "jira", site: "studio.atlassian.net", keys: ["FEAST"] } } });
  await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
  await page.getByRole("button", { name: "Stage all", exact: true }).click();
  await page.locator(".commit-box .primary-small-button", { hasText: "Commit 1 file" }).waitFor();
  await page.getByLabel("Commit summary").fill("Add the opening hours");
  await page.getByLabel("Commit description").fill("Why:\nGuests kept asking.\n\nHow to test:\nOpen the tavern level and read the sign.");
  return page;
}

/**
 * A teammate's work, `hoursAgo`, from a clone of `folder`'s remote: writes `files`, commits
 * them with `message` and pushes them to `to` (a branch, or a shelf's ref).
 */
function teammate(folder, who, hoursAgo, message, files, to) {
  const origin = git(folder, ["remote", "get-url", "origin"]);
  const clone = join(projects, `clone-${who.GIT_AUTHOR_NAME.split(" ")[0].toLowerCase()}-${Date.now()}`);
  const date = `@${Math.floor(Date.now() / 1000) - hoursAgo * 3600} +0000`;
  const as = { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["clone", "-q", origin, clone], { env: { ...process.env, ...demoEnv(demos), ...as } });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(clone, file)), { recursive: true });
    writeFileSync(join(clone, file), text);
  }
  git(clone, ["add", "-A"], as);
  git(clone, ["commit", "-q", "-m", message], as);
  git(clone, ["push", "-q", "--no-verify", "origin", `HEAD:${to}`], as);
}

const shots = {
  /** The commit graph with each commit's CI, and a merge commit's details with its checks. */
  async overview() {
    const folder = demos.notebook;
    // On GitHub, so its commits show their checks.
    git(folder, ["remote", "add", "github", "https://github.com/example/notebook.git"]);
    const ids = (...args) => git(folder, ["log", "--all", "--format=%H %s", ...args]).split("\n").filter(Boolean);
    const ciStates = {};
    for (const line of ids()) {
      const [id, ...words] = line.split(" ");
      const subject = words.join(" ");
      ciStates[id.slice(0, 12)] = subject === "Prepare the 0.3 release notes" ? "pending" : subject === "Add a theme picker" ? "failure" : "success";
    }
    const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
    const ran = (from, to) => ({ startedAt: ago(from), finishedAt: ago(to), workflow: "Checks", trigger: "on push to main" });
    const commitChecks = {
      site: "GitHub",
      canRerun: false,
      checks: [
        { name: "Build (macOS)", state: "success", url: "https://github.com/example/notebook/actions/runs/1", detail: null, ...ran(3 * 86_400 + 600, 3 * 86_400 + 408) },
        { name: "Build (Windows)", state: "success", url: "https://github.com/example/notebook/actions/runs/2", detail: null, ...ran(3 * 86_400 + 600, 3 * 86_400 + 361) },
        { name: "Tests", state: "success", url: "https://github.com/example/notebook/actions/runs/3", detail: null, ...ran(3 * 86_400 + 600, 3 * 86_400 + 492) },
        { name: "Lint", state: "success", url: "https://github.com/example/notebook/actions/runs/4", detail: null, ...ran(3 * 86_400 + 600, 3 * 86_400 + 578) },
      ],
    };
    const page = await open(folder, { preview: { ciStates, commitChecks } });
    await row(page, "Merge pull request #18 from feature/sync").click();
    await page.locator(".details", { hasText: "Merge pull request #18" }).waitFor();
    await page.locator(".graph-ci").first().waitFor({ timeout: 10_000 });
    await settle(page, 800);
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

  /** A branch's menu saying whether merging it would conflict, worked out without merging. */
  async "merge-check"() {
    const page = await open(fresh().studio);
    await page.locator(".commit-list .ref-pill[title*='art/barber-v2']").first().click({ button: "right" });
    await page.locator(".menu-detail", { hasText: "Conflicts in" }).first().waitFor({ timeout: 20_000 });
    await settle(page);
    return page;
  },

  /** What changed when a teammate force-pushed a branch, commit by commit. */
  async rewrite() {
    const page = await open(fresh().studio);
    await page.locator(".commit-list .ref-pill[title*='fix/stool']").first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "force-pushed" }).click();
    await page.locator(".rewrite-pair").first().waitFor();
    await settle(page);
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

  /** A pull request's checks: the tributaries flowing into the verdict, and the timeline in workflow runs. */
  async checks() {
    const page = await open(fresh().studio, {
      preview: { pullRequests: STUDIO_PULL_REQUESTS, pullRequestDetails: STUDIO_PULL_REQUEST_DETAILS, conversations: STUDIO_PULL_REQUEST_CONVERSATIONS },
    });
    await page.getByRole("button", { name: "Close details" }).click().catch(() => {});
    await page.locator(".pr-badge", { hasText: "#14" }).first().click();
    const card = page.locator(".request-status");
    await card.locator(".tributaries").waitFor();
    await card.evaluate((status) => status.scrollIntoView({ block: "start" }));
    // The waves draw in.
    await settle(page, 2500);
    return page;
  },

  /** What makes a repository big: its biggest files in all of the history, by kind and folder. */
  async "what-makes-it-big"() {
    const page = await open(fresh().studio);
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Tools" }).hover();
    await page.locator(".menu-item", { hasText: "What Makes It Big" }).click();
    await page.locator(".big-window .big").waitFor({ timeout: 30_000 });
    await settle(page, 900);
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
    await page.locator(".team-view .team-person-card").first().waitFor();
    // Room for the statistics beside each other.
    await page.getByRole("button", { name: "Close details" }).click().catch(() => {});
    await page.locator(".team-view .team-panels .team-panel").nth(2).waitFor();
    await settle(page);
    return page;
  },

  /** A 3D model before and after. */
  async media() {
    const page = await open(demos.studio);
    await page.locator(".commit-row", { hasText: "A slower door with a longer creak" }).first().click();
    await page.locator(".details .file", { hasText: "DoorCreak.wav" }).click();
    await page.locator(".diff-view .diff-waveform").nth(1).waitFor();
    // The 3D model (after the sound, the video and the Blender file).
    await page.locator(".details .file", { hasText: "Stool.glb" }).click();
    await page.locator(".diff-model-facts").waitFor({ timeout: 20_000 });
    await settle(page, 1500);
    return page;
  },

  /** The light theme, with the graph's settings (inside Appearance). */
  async appearance() {
    const page = await open(demos.studio, { theme: "light" });
    await page.keyboard.press("Control+Comma");
    await page.getByRole("tab", { name: "Graph" }).click();
    await settle(page);
    return page;
  },

  /** The issue's key in front of the summary, and the team's template. */
  async "commit-template"() {
    const page = await issueBranch();
    await settle(page);
    return page;
  },

  /** What you did, with Undo while it's safe. */
  async "your-actions"() {
    const page = await issueBranch();
    await page.locator(".commit-box .primary-small-button").click();
    await row(page, "FEAST-23: Add the opening hours").waitFor({ timeout: 10_000 });
    await page.locator(".sidebar-item", { hasText: /^\s*main\s*$/ }).first().dblclick();
    await page.locator(".status-bar button", { hasText: "Activity" }).click();
    await page.locator(".history-why").waitFor({ timeout: 10_000 });
    await page.locator(".toast").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    await settle(page);
    return page;
  },

  /** How the project is set up for git, with a fix for each problem. */
  async "project-setup"() {
    const page = await open(fresh().studio);
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Tools" }).hover();
    await page.locator(".menu-item", { hasText: "Check Project Setup" }).click();
    await page.locator(".setup-item").first().waitFor({ timeout: 15_000 });
    await settle(page);
    return page;
  },

  /** Simple mode: get latest, your changes with their locks, and the team. */
  async simple() {
    const folder = fresh().studio;
    teammate(folder, people.rosa, 3, "Hang a lantern by the door", { "Content/Props/Lantern.txt": "Brass, by the door\n" }, "main");
    const page = await open(folder, { storage: { "tributary.view.simple": true } });
    await page.getByRole("button", { name: "Check now" }).click();
    await page.locator(".simple-status", { hasText: "update" }).waitFor({ timeout: 20_000 });
    await page.getByLabel("What you changed").fill("New barber outfit and the intro cut");
    await page.locator(".toast").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    await settle(page);
    return page;
  },

  /** Shelving your changes, and the team's shelves. */
  async shelves() {
    const folder = fresh().studio;
    const shelf = (who) => `refs/tributary/shelves/${who}-${Date.now()}`;
    teammate(
      folder,
      people.rosa,
      2,
      "Tavern sign, darker wood: for Maya to look at\n\nShelved-From: art/tavern-sign",
      { "Content/Props/TavernSign.txt": "Darker oak, brass letters\n", "Content/Props/SignBracket.txt": "Wrought iron\n", "Config/DefaultGame.ini": "[/Script/Feast]\nSignStyle=Dark\n" },
      shelf("rosa-bell"),
    );
    teammate(folder, people.theo, 26, "Stool wobble: half done, needs a second pair of eyes\n\nShelved-From: fix/stool", { "Source/Feast/Stool.cpp": "// Legs from the floor\n" }, shelf("theo-park"));
    const page = await open(folder);
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Shelves" }).click();
    const dialog = page.locator(".shelves-dialog");
    await dialog.locator(".shelf", { hasText: "Theo" }).waitFor({ timeout: 20_000 });
    await dialog.getByLabel("What the shelf is for").fill("Barber's new outfit, for the art review");
    await dialog.locator(".shelf", { hasText: "Tavern sign" }).locator(".shelf-files-toggle").click();
    await settle(page);
    return page;
  },

  /** Local history: snapshots of uncommitted work, to put files back. */
  async "local-history"() {
    const folder = fresh().studio;
    const page = await open(folder);
    const keep = async (minutesAgo) => {
      const taken = await page.evaluate((path) => window.__TAURI_INTERNALS__.invoke("take_snapshot", { path, maxBytes: 50_000_000, keepDays: 7 }), folder);
      // As if taken earlier this morning.
      const time = Date.now() - minutesAgo * 60_000;
      git(folder, ["update-ref", `refs/tributary/snapshots/${time}`, taken.id]);
      git(folder, ["update-ref", "-d", taken.reference]);
    };
    writeFileSync(join(folder, "Config/DefaultGame.ini"), "[/Script/Feast]\nFireplace=Stone\n");
    await keep(70);
    writeFileSync(join(folder, "Source/Feast/Stool.cpp"), "// Three legs\n");
    writeFileSync(join(folder, "Config/DefaultGame.ini"), "[/Script/Feast]\nFireplace=Brick\n");
    await keep(40);
    writeFileSync(join(folder, "Config/DefaultGame.ini"), "[/Script/Feast]\nFireplace=\n");
    await keep(10);
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Local History" }).click();
    const dialog = page.locator(".local-history-dialog");
    await dialog.locator(".history-time").nth(2).waitFor({ timeout: 10_000 });
    await dialog.locator(".history-time").nth(1).click();
    await settle(page);
    return page;
  },

  /** A guided tour's stop: Fetch, Pull and Push. */
  async tour() {
    const page = await open(fresh().studio);
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Tours" }).click();
    await page.locator(".tours-dialog li", { hasText: "Getting started" }).getByRole("button").click();
    await page.locator(".tour-card h3", { hasText: "The graph" }).waitFor({ timeout: 5000 });
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.locator(".tour-card h3", { hasText: "Fetch, Pull and Push" }).waitFor({ timeout: 5000 });
    await settle(page, 900);
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

/**
 * The README's opening image (hero.png, at twice the size) and the social preview
 * (social-preview.png, for the repository's settings): Tributary's icon, name and tagline
 * beside the overview screenshot.
 */
async function hero() {
  const root = join(here, "..", "..");
  const data = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
  const html = readFileSync(join(here, "hero.html"), "utf8")
    .replace("{{font}}", data(join(root, "node_modules", "@fontsource-variable", "google-sans", "files", "google-sans-latin-full-normal.woff2"), "font/woff2"))
    .replace("{{icon}}", data(join(root, "src-tauri", "icons", "128x128@2x.png"), "image/png"))
    .replace("{{shot}}", data(join(out, "overview.png"), "image/png"));
  for (const [name, scale] of [
    ["hero", 2],
    ["social-preview", 1],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: scale });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 300);
    await page.screenshot({ path: join(out, `${name}.png`) });
    await page.close();
  }
}

/** Shots whose hover is part of the picture. */
const HOVERED = new Set(["blame", "compare", "merge-check"]);

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
if (!only || only.has("overview") || only.has("hero")) {
  try {
    await hero();
    console.log("  ✓ hero, social-preview");
  } catch (error) {
    failed++;
    console.error(`  ✗ hero\n      ${String(error).split("\n").join("\n      ")}`);
  }
}
await browser.close();
await preview.close?.();
await locks.close?.();
rmSync(join(tmpdir(), "tributary-docs"), { recursive: true, force: true });
console.log(failed ? `${failed} failed` : `Saved to ${out}`);
process.exit(failed ? 1 : 0);
