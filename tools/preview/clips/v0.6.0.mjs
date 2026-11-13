// What's new in 0.6.0, for What's New and the release page (see clips.mjs).

/** What's New for 0.5.0, after 0.4.1, and the part of the window to record: the window, 16:10. */
async function whatsNew(open, pause) {
  const page = await open(null, { version: "0.5.0", storage: { "tributary.whatsNew.seen": "0.4.1" } });
  const dialog = page.locator(".whats-new-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  await pause(page, 800);
  const box = await dialog.boundingBox();
  const height = Math.round(box.height + 24);
  const width = Math.round(height * 1.6);
  return { page, region: { x: Math.round(box.x + box.width / 2 - width / 2), y: Math.round(box.y - 12), width, height } };
}

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

export default {
  /** Each new thing with its moving picture, one after another, then the fixes. */
  async "whats-new"({ open, point, pause, record }) {
    const { page, region } = await whatsNew(open, pause);
    const next = page.getByRole("button", { name: "Next" });
    await record(page, region, async () => {
      await pause(page, 2600);
      for (let step = 0; step < 3; step++) {
        await point(page, next);
        await pause(page, 250);
        await click(page);
        await pause(page, step < 2 ? 2600 : 2000);
      }
      // Back to the first, as it started.
      await point(page, page.locator(".wn-nav button").first());
      await pause(page, 250);
      await click(page);
      await pause(page, 600);
    });
    await page.close();
  },

  /** Every version in the list: an older one opens, the others fold away. */
  async changelog({ open, point, pause, record }) {
    const { page, region } = await whatsNew(open, pause);
    const version = (name) => page.locator(".wn-version", { hasText: name }).first();
    await record(page, region, async () => {
      await pause(page, 1200);
      for (const name of ["0.4.0", "0.3.0", "0.5.0"]) {
        await point(page, version(name).locator(".wn-tag"));
        await pause(page, 300);
        await click(page);
        await pause(page, name === "0.5.0" ? 1200 : 2200);
      }
    });
    await page.close();
  },
};
