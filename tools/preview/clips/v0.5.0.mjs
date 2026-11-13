// What's new in 0.5.0, for What's New and the release page (see clips.mjs).
const label = (page, name) => page.locator(".refs-cell .ref-pill", { hasText: name }).first();
const branch = (page, name) => page.locator(".sidebar-item", { hasText: new RegExp(`^${name}`) }).first();

export default {
  /** A branch's lane lights up: from the sidebar, then from its label in the graph. */
  async "lane-lights-up"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio);
    await pause(page, 600);
    await record(page, { x: 0, y: 84, width: 720, height: 450 }, async () => {
      await pause(page, 500);
      await point(page, branch(page, "fix/door"));
      await pause(page, 1600);
      await point(page, label(page, "stool"));
      await pause(page, 1600);
      await point(page, { x: 640, y: 120 });
      await pause(page, 900);
    });
    await page.close();
  },

  /** The marks beside the scrollbar: each says what it is, and the ones under the pointer glow. */
  async "scrollbar-marks"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio);
    await pause(page, 600);
    const strip = await page.locator(".list-markers").boundingBox();
    const at = (y) => ({ x: strip.x + strip.width / 2, y });
    const right = strip.x + strip.width + 8;
    await record(page, { x: right - 560, y: 96, width: 560, height: 350 }, async () => {
      await pause(page, 500);
      await point(page, at(strip.y + 63));
      await pause(page, 1600);
      await point(page, at(strip.y + 166));
      await pause(page, 1600);
      await point(page, { x: strip.x - 260, y: 300 });
      await pause(page, 900);
    });
    await page.close();
  },

  /** A commit you jump to is outlined for a moment, so your eye finds it. In a shorter window, so it's a jump. */
  async "jump-outline"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio, { height: 560 });
    await pause(page, 600);
    await record(page, { x: 0, y: 84, width: 720, height: 450 }, async () => {
      await pause(page, 500);
      await point(page, branch(page, "art/barber-v2"));
      await pause(page, 300);
      await page.mouse.click(page.pointerAt.x, page.pointerAt.y);
      await pause(page, 1900);
      await point(page, branch(page, "main"));
      await pause(page, 300);
      await page.mouse.click(page.pointerAt.x, page.pointerAt.y);
      await pause(page, 1900);
    });
    await page.close();
  },
};
