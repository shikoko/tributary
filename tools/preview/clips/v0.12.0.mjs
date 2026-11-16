// What's new in 0.12.0, for What's New and the release page (see clips.mjs).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Points at `target`, then clicks it, and waits `ms`. */
async function press(page, point, pause, target, ms) {
  await point(page, target);
  await pause(page, 250);
  await click(page);
  await pause(page, ms);
}

/**
 * Maya, as git's environment: the GIT_AUTHOR_* and GIT_COMMITTER_* variables, which win over
 * `-c user.name`, so whoever runs the recording never shows in it.
 */
const as = (name, email) => ({ ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
const MAYA = as("Maya Chen", "maya@example.com");
const PRIYA = as("Priya Nair", "priya@example.com");

export default {
  /**
   * The notebook's main has a commit to push, and Priya pushed to it since the last fetch:
   * the push is refused, the message says so in plain words with what Sync and Force push
   * would each do, git's own message opens under it, and it's closed again.
   */
  async "plain-errors"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1152, height: 720 });
    const push = page.locator(".split-button .tool-button", { hasText: "Push" });
    await push.waitFor({ timeout: 10_000 });
    const banner = page.locator(".error-explained");
    await record(page, { x: 0, y: 0, width: 1152, height: 720 }, async () => {
      await pause(page, 700);
      await press(page, point, pause, push, 300);
      await banner.locator(".error-choices").waitFor({ timeout: 15_000 });
      await pause(page, 3200);
      await press(page, point, pause, banner.getByRole("button", { name: "Show git's message" }), 2600);
      await press(page, point, pause, banner.getByRole("button", { name: "Hide git's message" }), 500);
      await press(page, point, pause, banner.getByRole("button", { name: "Dismiss" }), 300);
      await banner.waitFor({ state: "detached", timeout: 5000 });
      await point(page, { x: 1151, y: 719 });
      await pause(page, 700);
    });
    await page.close();
  },

  /**
   * feature/export, reworded after it was pushed, and Priya pushed a commit to it since the
   * last fetch: the force push has stopped and lists it, and Force push anyway opens the
   * dialog with the box ticked, and replaces it.
   */
  async "force-push-anyway"({ open, point, pause, demos, record }) {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8", env: MAYA }).trim();
    // On the remote, feature/export is as it was last fetched, and then Priya's commit (her
    // merge of main into it, which the demo has there, goes).
    const priya = join(dirname(demos.notebook), "notebook-priya");
    const theirs = (...args) => execFileSync("git", ["-C", priya, ...args], { encoding: "utf8", env: PRIYA }).trim();
    execFileSync("git", ["clone", "-q", "--branch", "feature/export", git("remote", "get-url", "origin"), priya]);
    theirs("reset", "-q", "--hard", git("rev-parse", "origin/feature/export"));
    theirs("commit", "-q", "--allow-empty", "-m", "Tune the PDF page margins");
    theirs("push", "-q", "--force", "origin", "HEAD:feature/export");
    git("checkout", "-q", "feature/export");
    git("commit", "-q", "--amend", "--only", "-m", `${git("log", "-1", "--format=%s")}, with page numbers`);
    const page = await open(demos.notebook, { width: 1152, height: 580 });
    const menuToggle = page.getByRole("button", { name: "More push options" });
    await menuToggle.waitFor({ timeout: 10_000 });
    const dialog = page.locator(".dialog", { hasText: "Force push feature/export?" });
    const banner = page.locator(".error-explained");
    // It starts where the force push (from the push button's menu) has just stopped.
    await menuToggle.click();
    await page.locator(".menu-item", { hasText: "Force push…" }).click();
    await dialog.getByRole("button", { name: "Force push", exact: true }).click();
    await banner.locator(".error-commits li").first().waitFor({ timeout: 15_000 });
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await pause(page, 600);
    // The top of the window, where it all happens: the toolbar, the message and the dialog.
    await record(
      page,
      { x: 0, y: 0, width: 1152, height: 460 },
      async () => {
        await pause(page, 3400);
        await press(page, point, pause, banner.getByRole("button", { name: "Force push anyway…" }), 1800);
        await press(page, point, pause, dialog.getByRole("button", { name: "Force push anyway" }), 300);
        await page.locator(".toast", { hasText: "Force pushed feature/export to origin" }).waitFor({ timeout: 15_000 });
        await point(page, { x: 1151, y: 579 });
        await pause(page, 1000);
      },
      // The push can't be undone on screen: the end fades back to the start.
      { fadeBack: true },
    );
    await page.close();
  },
};
