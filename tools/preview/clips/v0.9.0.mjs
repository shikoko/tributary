// What's new in 0.9.0, for What's New and the release page (see clips.mjs). The demos are
// shared by the scenes, in this order: the ones that change a repository come last.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { studioCommitRuns } from "../demo.mjs";

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Points at `target`, then clicks it, and waits `ms`. */
async function press(page, point, pause, target, ms) {
  await point(page, target);
  await pause(page, 250);
  await click(page);
  await pause(page, ms);
}

/** Types `text` a letter at a time, as a person would. */
const type = (page, text) => page.keyboard.type(text, { delay: 90 });

/** Opens `repo` in a new tab, with the start screen's Open repository. */
async function openInNewTab(page, repo, name) {
  await page.evaluate((repo) => (window.__PREVIEW__.pick = repo), repo);
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByText("Open repository").first().click();
  await page.locator(".tabs > .tab[data-path]", { hasText: name }).waitFor({ timeout: 20_000 });
  await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
}

/**
 * Someone on the team, as git's environment: the GIT_AUTHOR_* and GIT_COMMITTER_* variables,
 * which win over `-c user.name`, so whoever runs the recording never shows in it.
 */
const as = (name, email) => ({ ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
const SAM = as("Sam Okafor", "sam@example.com");
const LEA = as("Lea Fischer", "lea@example.com");

/** git in a demo repository, as someone on the team. */
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: SAM }).trim();

/** The studio's checks in its commit's details, matching the runs studioCommitRuns() draws. */
function studioChecks() {
  const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
  const check = (name, state, from, to, detail = null) => ({ name, state, url: `https://github.com/example/feast/actions/runs/41/job/${name.length}`, detail, startedAt: ago(from), finishedAt: to === null ? null : ago(to), workflow: "Build", trigger: "on push to main" });
  return {
    site: "GitHub",
    canRerun: true,
    checks: [
      check("Audio loudness", "failure", 410, 290, "2 files too loud"),
      check("Build (Windows)", "pending", 365, null),
      check("Build (macOS)", "success", 365, 61),
      check("Build (Linux)", "success", 365, 102),
      check("Texture sizes", "success", 410, 352),
      check("Lint scripts", "success", 412, 371),
      check("Version", "success", 412, 398),
    ],
  };
}

export default {
  /** A commit's checks from its CI dot: each run as a graph of its jobs, scrolled along, and closed. */
  async "checks-graph"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio, { width: 1152, height: 720, fakes: { ciStates: { "": "failure" }, commitChecks: studioChecks(), commitRuns: studioCommitRuns() } });
    // The branches sidebar out of the way, for the graph's room; the checked-out commit chosen,
    // so its details show its pull request and checks.
    await page.getByRole("button", { name: "Toggle the branches sidebar" }).click();
    const head = page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first();
    await head.locator(".cell.description").click();
    await page.locator(".details .commit-checks .check-pips").waitFor({ timeout: 10_000 });
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await pause(page, 600);
    const view = page.locator(".checks-view");
    await record(page, { x: 0, y: 0, width: 1152, height: 720 }, async () => {
      await pause(page, 700);
      await press(page, point, pause, head.locator(".graph-ci"), 1900);
      // Wider than the view: its arrow scrolls the Build graph along to the jobs still waiting.
      const more = view.locator(".run-graph-more.right").first();
      if (await more.isVisible()) await press(page, point, pause, more, 1500);
      await page.keyboard.press("Escape");
      await view.waitFor({ state: "detached", timeout: 5000 });
      await pause(page, 700);
    });
    await page.close();
  },

  /** Go to Commit: a tag far down the history, outlined once the list is there. */
  async "go-to-commit"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1200, height: 750 });
    await pause(page, 600);
    const dialog = page.locator(".dialog", { hasText: "Go to commit" });
    const goTo = async (query) => {
      await page.keyboard.press("Control+g");
      await dialog.getByRole("textbox").waitFor({ timeout: 5000 });
      await pause(page, 300);
      await type(page, query);
      await pause(page, 250);
      await press(page, point, pause, dialog.getByRole("button", { name: "Go" }), 1300);
    };
    await record(page, { x: 0, y: 0, width: 1200, height: 750 }, async () => {
      await pause(page, 500);
      await goTo("v0.1.0");
      await pause(page, 600);
    });
    await page.close();
  },

  /** A tab closed by mistake, and back in its place from another tab's menu. */
  async "reopen-tab"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio, { width: 1200, height: 750 });
    await openInNewTab(page, demos.notebook, "notebook");
    const tab = (name) => page.locator(".tabs > .tab[data-path]", { hasText: name });
    await tab("studio").click();
    await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
    await tab("notebook").click();
    await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
    // The notebook's notice about its submodule isn't what this is about.
    await page.getByRole("button", { name: "Not now" }).click({ timeout: 3000 }).catch(() => {});
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await pause(page, 600);
    // The tab bar and the top of the window under it, 16:10.
    await record(page, { x: 0, y: 0, width: 576, height: 360 }, async () => {
      await pause(page, 700);
      await press(page, point, pause, tab("notebook").locator(".tab-close"), 1000);
      await point(page, tab("studio"));
      await pause(page, 250);
      await page.mouse.click(page.pointerAt.x, page.pointerAt.y, { button: "right" });
      await pause(page, 600);
      await press(page, point, pause, page.locator(".menu-item", { hasText: "Reopen closed tab" }), 400);
      await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
      // Back over the tabs, off the commits (where a row's tooltip would show).
      await point(page, tab("notebook"));
      await pause(page, 1000);
    });
    await page.close();
  },

  /** A commit dragged onto a branch that isn't checked out, cherry-picked there, and undone. */
  async "drag-cherry-pick"({ open, point, pause, demos, record }) {
    const repo = demos.notebook;
    // A commit on a branch of its own, and a branch to pick it onto, a few commits down, both
    // made with git's plumbing so the files on disk stay as they are.
    const head = git(repo, "rev-parse", "HEAD");
    const blob = execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: "Things to pick up.\n", encoding: "utf8", env: SAM }).trim();
    const tree = execFileSync("git", ["-C", repo, "mktree"], { input: `${git(repo, "ls-tree", "HEAD")}\n100644 blob ${blob}\tPICK.md\n`, encoding: "utf8", env: SAM }).trim();
    git(repo, "branch", "-f", "pick-list", git(repo, "commit-tree", tree, "-p", head, "-m", "Add a pick list"));
    const bare = git(repo, "log", "--format=%H%x09%D", "-30", "main").split("\n").slice(2).find((line) => line.endsWith("\t"))?.split("\t")[0];
    git(repo, "branch", "-f", "release/notes", bare);
    const page = await open(repo, { width: 1024, height: 640 });
    const source = page.locator(".commit-row", { hasText: "Add a pick list" }).first();
    const target = page.locator('.commit-row .ref-pill[data-drop-branch="release/notes"]');
    await target.waitFor({ timeout: 10_000 });
    await pause(page, 600);
    await record(page, { x: 0, y: 0, width: 1024, height: 640 }, async () => {
      await pause(page, 900);
      await point(page, source.locator(".cell.description"), { dx: -40 });
      await pause(page, 300);
      await page.mouse.down();
      await pause(page, 200);
      // Slowly onto the branch's label: it's outlined, and the commit's ghost follows the pointer.
      const from = page.pointerAt;
      const box = await target.boundingBox();
      const end = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(from.x + ((end.x - from.x) * i) / 30, from.y + ((end.y - from.y) * i) / 30);
        await pause(page, 20);
      }
      page.pointerAt = end;
      await pause(page, 600);
      await page.mouse.up();
      await page.locator(".toast", { hasText: "onto release/notes" }).waitFor({ timeout: 10_000 });
      await pause(page, 1600);
      await press(page, point, pause, page.locator(".toast").getByRole("button", { name: "Undo" }), 600);
      await page.locator(".toast", { hasText: "back off release/notes" }).waitFor({ timeout: 10_000 });
      await pause(page, 1600);
    });
    await page.close();
    git(repo, "branch", "-D", "pick-list", "release/notes");
  },

  /** Sync: a teammate pushed to main and you have commits of your own, so Push is Sync. */
  async sync({ open, point, pause, demos, record }) {
    const repo = demos.notebook;
    // Without the demo's uncommitted changes, which git would ask to stash first.
    git(repo, "stash", "push", "--include-untracked", "--quiet", "--message", "Sidebar tweaks for later");
    if (git(repo, "rev-list", "--count", "origin/main..main") === "0") {
      git(repo, "commit", "--quiet", "--allow-empty", "--message", "Note when notes last synced");
    }
    const teammate = join(repo, "..", "sync-teammate");
    execFileSync("git", ["clone", "-q", git(repo, "remote", "get-url", "origin"), teammate], { env: LEA });
    execFileSync("git", ["-C", teammate, "commit", "-q", "--allow-empty", "-m", "Say who looks after what"], { env: LEA });
    execFileSync("git", ["-C", teammate, "push", "-q", "origin", "HEAD:main"], { env: LEA });
    // Wide enough for the toolbar's buttons to have their words.
    const page = await open(repo, { width: 1200, height: 750 });
    await pause(page, 600);
    const sync = page.locator(".split-button .tool-button", { hasText: "Sync" }).first();
    await record(page, { x: 0, y: 0, width: 1200, height: 750 }, async () => {
      await pause(page, 700);
      // Fetched, main has commits on both sides: Push becomes Sync.
      await press(page, point, pause, page.getByRole("button", { name: "Fetch", exact: true }), 300);
      await sync.waitFor({ timeout: 15_000 });
      await pause(page, 1200);
      await press(page, point, pause, sync, 300);
      await page.locator(".toast", { hasText: "Synced main" }).waitFor({ timeout: 20_000 });
      await pause(page, 2000);
    });
    await page.close();
  },
};
