// What's new in 0.19.0, for What's New and the release page (see clips.mjs).
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
   * The notebook, whose origin has none of its tags: Push tags… lists them, the releases
   * ticked and an experiment's tag not, and pushes the three releases.
   */
  async "push-tags"({ open, point, pause, demos, record }) {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" });
    // v0.1.0 and v0.2.0 are on commits origin has. A third release on origin's main, and an
    // experiment's tag on main's last commit, which origin hasn't got.
    git("tag", "v0.3.0", "origin/main");
    git("tag", "try-webdav", "main");
    const page = await open(demos.notebook, { width: 960, height: 540 });
    const more = page.getByRole("button", { name: "More push options" });
    await more.waitFor({ timeout: 15_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    // The whole height, and the dialog in the middle, which takes in the Push button above
    // it: 16 by 10, the shape What's New shows pictures in.
    await more.click();
    await page.locator(".menu-item", { hasText: "Push tags…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Push tags to origin" });
    await dialog.locator(".prune-row").first().waitFor({ timeout: 10_000 });
    const box = await dialog.boundingBox();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await page.waitForTimeout(500);
    await rest(page, { x: 959, y: 539 });
    await record(
      page,
      { x: Math.round(box.x + box.width / 2 - 432), y: 0, width: 864, height: 540 },
      async () => {
        await pause(page, 600);
        await press(page, point, pause, more, 500);
        await press(page, point, pause, page.locator(".menu-item", { hasText: "Push tags…" }), 300);
        await dialog.locator(".prune-row").first().waitFor({ timeout: 10_000 });
        await pause(page, 1400);
        await press(page, point, pause, dialog.getByRole("button", { name: "Push 3 tags", exact: true }), 0);
        await page.locator(".toast", { hasText: "Pushed 3 tags to origin" }).waitFor({ timeout: 15_000 });
        await pause(page, 1600);
        await point(page, { x: 959, y: 539 });
        await pause(page, 300);
      },
      { fadeBack: true },
    );
    await page.close();
  },
};
