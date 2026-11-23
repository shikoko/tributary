// What's new in 0.17.0, for What's New and the release page (see clips.mjs).

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Types like a person. */
const type = (page, text) => page.keyboard.type(text, { delay: 70 });

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
   * The notebook on main, which is protected, with a file staged: the Commit button says
   * main, its menu commits to a new branch named from the summary, and the commit lands on
   * the new branch in the history.
   */
  async "commit-branch"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1152, height: 720 });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const box = page.locator(".commit-box");
    await box.locator(".commit-button").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    // From the toolbar down, so the history shows the new branch's commit arrive.
    const toolbar = await page.locator(".toolbar").boundingBox();
    const top = Math.round(toolbar.y + toolbar.height);
    const region = { x: 0, y: top, width: 1152, height: 720 - top };
    await rest(page, { x: 1151, y: 719 });
    await record(
      page,
      region,
      async () => {
        await pause(page, 700);
        await press(page, point, pause, page.getByPlaceholder("Commit summary"), 200);
        await type(page, "Welcome tour for new notebooks");
        await pause(page, 600);
        await press(page, point, pause, page.getByRole("button", { name: "Where to commit" }), 900);
        await press(page, point, pause, page.locator(".menu-item", { hasText: "Commit to a new branch…" }), 1500);
        await press(page, point, pause, box.locator(".commit-button"), 300);
        await page.locator(".commit-row", { hasText: "Welcome tour for new notebooks" }).waitFor({ timeout: 15_000 });
        await pause(page, 2200);
        await point(page, { x: 1151, y: 719 });
        await pause(page, 400);
      },
      { fadeBack: true },
    );
    await page.close();
  },
};
