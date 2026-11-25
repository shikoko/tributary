// What's new in 0.20.0, for What's New and the release page (see clips.mjs).
import { execFileSync } from "node:child_process";

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Points at `target`, then clicks it, and waits `ms`. */
async function press(page, point, pause, target, ms) {
  await point(page, target);
  await pause(page, 250);
  await click(page);
  await pause(page, ms);
}

/** Where the pointer waits, before and after: outside what's recorded. */
async function rest(page, at) {
  page.pointerAt = at;
  await page.mouse.move(at.x, at.y);
}

export default {
  /**
   * Two repositories open: the overview shows them both, a new workspace, Art, is made and
   * switched to, empty, and the overview then shows each workspace's repositories.
   */
  async workspaces({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 960, height: 600 });
    // Panels without their fade, which would take the recording over 400 KB.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((path) => window.__PREVIEW__.emit("open-folder", path), demos.studio);
    await page.locator(".tabs > .tab.active[data-path]", { hasText: /^studio$/ }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    const switcher = page.locator(".workspace-switch");
    const panel = page.locator(".workspace-panel");
    await rest(page, { x: 959, y: 599 });
    await record(
      page,
      { x: 0, y: 0, width: 960, height: 600 },
      async () => {
        await pause(page, 500);
        await press(page, point, pause, switcher, 1300);
        await press(page, point, pause, panel.getByRole("button", { name: "New workspace…" }), 300);
        await page.keyboard.type("Art", { delay: 140 });
        await pause(page, 300);
        await press(page, point, pause, panel.getByRole("radio", { name: "Colour 5", exact: true }), 400);
        await press(page, point, pause, panel.getByRole("button", { name: "Create and switch" }), 0);
        await page.locator(".workspace-switch", { hasText: "Art" }).waitFor({ timeout: 10_000 });
        await pause(page, 1000);
        await press(page, point, pause, page.locator(".workspace-switch"), 1800);
        await point(page, { x: 959, y: 599 });
        await pause(page, 200);
      },
      { fadeBack: true },
    );
    await page.close();
  },

  /**
   * The notebook with two branches origin hasn't got all of: ready, a commit ahead of its
   * branch there, and try-sharing, never pushed. Push branches… lists them, ready ticked, and
   * pushes it.
   */
  async "push-branches"({ open, point, pause, demos, record }) {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    git("branch", "ready", "origin/main");
    git("push", "-q", "-u", "origin", "ready");
    const lea = { GIT_AUTHOR_NAME: "Lea Fischer", GIT_AUTHOR_EMAIL: "lea@example.com", GIT_COMMITTER_NAME: "Lea Fischer", GIT_COMMITTER_EMAIL: "lea@example.com" };
    const ahead = execFileSync("git", ["-C", demos.notebook, "commit-tree", git("rev-parse", "ready^{tree}"), "-p", "ready", "-m", "Get the export ready"], {
      encoding: "utf8",
      env: { ...process.env, ...lea },
    }).trim();
    git("update-ref", "refs/heads/ready", ahead);
    git("branch", "try-sharing", "main");
    const page = await open(demos.notebook, { width: 960, height: 480 });
    // The dialog without its fade: the whole window dimming, frame by frame, would take the
    // recording over 400 KB.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const more = page.getByRole("button", { name: "More push options" });
    await more.waitFor({ timeout: 15_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    // Where the dialog sits, to centre the recording on it: 16 by 10, as What's New shows it.
    await more.click();
    await page.locator(".menu-item", { hasText: "Push branches…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Push branches to origin" });
    await dialog.locator(".prune-row").first().waitFor({ timeout: 10_000 });
    const box = await dialog.boundingBox();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await page.waitForTimeout(500);
    await rest(page, { x: 959, y: 479 });
    await record(
      page,
      { x: Math.max(0, Math.round(box.x + box.width / 2 - 384)), y: 0, width: 768, height: 480 },
      async () => {
        await pause(page, 400);
        await press(page, point, pause, more, 400);
        await press(page, point, pause, page.locator(".menu-item", { hasText: "Push branches…" }), 300);
        await dialog.locator(".prune-row").first().waitFor({ timeout: 10_000 });
        await pause(page, 1500);
        await press(page, point, pause, dialog.getByRole("button", { name: /^Push \d+ branch/ }), 0);
        await page.locator(".toast", { hasText: /Pushed/ }).waitFor({ timeout: 15_000 });
        await pause(page, 1200);
        await point(page, { x: 959, y: 479 });
        await pause(page, 300);
      },
      { fadeBack: true },
    );
    await page.close();
  },

  /**
   * The notebook's staged welcome screen, with AI turned on: the sparkle in the summary writes
   * the message (from a stand-in for the provider), with who wrote it underneath, then Undo
   * puts the empty fields back.
   */
  async "ai-message"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, {
      width: 960,
      height: 600,
      storage: { "tributary.ai.on": true },
      fakes: {
        ai: {
          key: "sk-ant-0000000000003f2a",
          written: {
            summary: "Add the onboarding welcome screen",
            description: "Shows a short welcome the first time a notebook opens, before the tour, with a button to skip it.",
            by: "Claude",
            files: 1,
            leftOut: [],
            shortened: false,
          },
          delay: 1300,
        },
      },
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const write = page.getByRole("button", { name: "Write the message with AI" });
    await write.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    // The commit box, and the staged file above it: 16 by 10, from the panel's right edge.
    const box = await page.locator(".commit-box").boundingBox();
    const width = 560;
    const height = 350;
    const region = { x: 960 - width, y: Math.min(600 - height, Math.max(0, Math.round(box.y + box.height - height + 8))), width, height };
    await rest(page, { x: 959, y: 599 });
    await record(page, region, async () => {
      await pause(page, 500);
      await press(page, point, pause, write, 0);
      await page.locator(".ai-note").waitFor({ timeout: 10_000 });
      await pause(page, 2600);
      await press(page, point, pause, page.locator(".ai-note").getByRole("button", { name: "Undo" }), 500);
      await point(page, { x: 959, y: 599 });
      await pause(page, 300);
    });
    await page.close();
  },
};
