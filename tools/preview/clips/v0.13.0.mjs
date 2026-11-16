// What's new in 0.13.0, for What's New and the release page (see clips.mjs).
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

export default {
  /**
   * The notebook's master, renamed to main on origin since it was last fetched: Pull stops,
   * the message says why, Choose another lists origin's branches with origin/main first, and
   * using it, with master renamed to main to match, fixes it.
   */
  async "renamed-branch"({ open, point, pause, demos, record }) {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    const remote = git("remote", "get-url", "origin");
    const bare = (...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8" }).trim();
    // As it was: master here and on origin.
    git("branch", "-m", "main", "master");
    bare("branch", "-m", "main", "master");
    bare("symbolic-ref", "HEAD", "refs/heads/master");
    git("fetch", "-q", "--prune", "origin");
    git("branch", "-q", "--set-upstream-to=origin/master", "master");
    // Then renamed to main on origin.
    bare("branch", "-m", "master", "main");
    bare("symbolic-ref", "HEAD", "refs/heads/main");

    const page = await open(demos.notebook, { width: 1152, height: 580 });
    const pull = page.locator(".toolbar .tool-button", { hasText: "Pull" }).first();
    await pull.waitFor({ timeout: 10_000 });
    const banner = page.locator(".error-explained");
    const dialog = page.locator(".dialog", { hasText: "Which branch on origin does master go with?" });
    await record(
      page,
      { x: 0, y: 0, width: 1152, height: 500 },
      async () => {
        await pause(page, 700);
        await press(page, point, pause, pull, 300);
        await banner.getByRole("button", { name: "Use origin/main" }).waitFor({ timeout: 15_000 });
        await pause(page, 2800);
        await press(page, point, pause, banner.getByRole("button", { name: "Choose another…" }), 300);
        await dialog.locator(".merge-method").first().waitFor({ timeout: 10_000 });
        await pause(page, 2400);
        await press(page, point, pause, dialog.getByRole("button", { name: "Use origin/main" }), 300);
        await page.locator(".toast", { hasText: "Renamed master to main, which now goes with origin/main" }).waitFor({ timeout: 15_000 });
        await point(page, { x: 1151, y: 579 });
        await pause(page, 1600);
      },
      // The branch can't be put back on screen: the end fades back to the start.
      { fadeBack: true },
    );
    await page.close();
  },
};
