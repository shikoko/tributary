// What's new in 0.16.0, for What's New and the release page (see clips.mjs).
import { demoForks } from "../demo.mjs";

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
   * The notebook, signed in to GitHub with four made-up forks: the toolbar's Forks button
   * opens them with the window to themselves, one opens to its original's new commits, it's
   * synced, and the button goes back to the history.
   */
  async forks({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, {
      width: 1152,
      height: 720,
      fakes: { github: { account: { login: "maya-chen", name: "Maya Chen" }, forks: demoForks() } },
      // tavern-assets has Auto on, and synced by itself just now: nothing pops up while recording.
      storage: { "tributary.forks.shown": true, "tributary.forks.auto": ["maya-chen/tavern-assets"], "tributary.forks.run": { time: Date.now(), results: [] } },
    });
    const button = page.locator(".toolbar").getByRole("button", { name: "Your forks", exact: true });
    await button.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    // From the toolbar down, so the button shows being pressed.
    const toolbar = await page.locator(".toolbar").boundingBox();
    const top = Math.round(toolbar.y);
    const region = { x: 0, y: top, width: 1152, height: 720 - top };
    await rest(page, { x: 1151, y: 719 });
    await record(
      page,
      region,
      async () => {
        await pause(page, 700);
        await press(page, point, pause, button, 300);
        const view = page.locator(".forks-view");
        const fonts = view.getByRole("listitem", { name: "maya-chen/pixel-fonts" });
        await fonts.locator(".forks-bars").waitFor({ timeout: 10_000 });
        await pause(page, 1100);
        await press(page, point, pause, fonts.locator(".forks-name"), 1500);
        await press(page, point, pause, view.getByRole("button", { name: "Sync maya-chen/pixel-fonts" }), 300);
        await fonts.locator(".forks-note.good").waitFor({ timeout: 10_000 });
        await pause(page, 1500);
        await press(page, point, pause, button, 800);
        await point(page, { x: 1151, y: 719 });
        await pause(page, 500);
      },
      { fadeBack: true },
    );
    await page.close();
  },
};
