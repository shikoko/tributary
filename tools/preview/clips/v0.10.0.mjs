// What's new in 0.10.0, for What's New and the release page (see clips.mjs).

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
   * In a narrow window, the sidebar as a strip: Branches opened over the list, Locked files
   * chosen from the strip, and Esc closing it.
   */
  async "sidebar-strip"({ open, point, pause, demos, record }) {
    // Narrower than 1100 pixels, where the sidebar folds into the strip; 16:10.
    const page = await open(demos.studio, { width: 960, height: 600 });
    await page.locator(".sidebar-strip").waitFor({ timeout: 10_000 });
    // The pointer starts and ends in the strip, under its icons, off the commits (where a row
    // lights up under it).
    const rest = { x: 24, y: 520 };
    await page.mouse.move(rest.x, rest.y);
    page.pointerAt = rest;
    await pause(page, 600);
    const icon = (section) => page.locator(`.sidebar-strip-button[data-section=${section}]`);
    const over = page.locator(".sidebar-over");
    await record(page, { x: 0, y: 0, width: 960, height: 600 }, async () => {
      await pause(page, 800);
      await press(page, point, pause, icon("branches"), 1600);
      await press(page, point, pause, icon("locks"), 1600);
      await page.keyboard.press("Escape");
      await over.waitFor({ state: "detached", timeout: 5000 });
      await pause(page, 400);
      // Back where it started, and a click there takes the focus off the icon, as it started.
      await press(page, point, pause, rest, 800);
    });
    await page.close();
  },
};
