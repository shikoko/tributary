// What's new in 0.18.0, for What's New and the release page (see clips.mjs).

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
   * The notebook, each branch in a colour of its own: the View panel colours them by kind
   * instead, its features all blue and main amber.
   */
  async "branch-colours"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 960, height: 600 });
    const button = page.getByRole("button", { name: "View options" });
    await button.waitFor({ timeout: 15_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    // From the toolbar down, as far right as the View button and its panel: the graph's
    // under it.
    const toolbar = await page.locator(".toolbar").boundingBox();
    const view = await button.boundingBox();
    const top = Math.round(toolbar.y);
    // Down to just under the panel's colours.
    const region = { x: 0, y: top, width: Math.round(view.x + view.width + 24), height: 440 - top };
    await rest(page, { x: 959, y: 599 });
    await record(
      page,
      region,
      async () => {
        await pause(page, 600);
        await press(page, point, pause, button, 500);
        const panel = page.locator(".view-panel");
        await press(page, point, pause, panel.getByRole("button", { name: "By kind" }), 1000);
        await page.keyboard.press("Escape");
        await pause(page, 1300);
        await point(page, { x: 959, y: 599 });
        await pause(page, 300);
      },
      { fadeBack: true },
    );
    await page.close();
  },
};
