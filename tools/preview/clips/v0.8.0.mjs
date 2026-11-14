// What's new in 0.8.0, for What's New and the release page (see clips.mjs).
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
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

/** Opens `repo` in a new tab, with the start screen's Open repository. */
async function openInNewTab(page, repo, name) {
  await page.evaluate((repo) => (window.__PREVIEW__.pick = repo), repo);
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByText("Open repository").first().click();
  await page.locator(".tabs > .tab[data-path]", { hasText: name }).waitFor({ timeout: 20_000 });
  await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
}

/**
 * Drags the tab under the pointer to `to` (a locator's middle, moved by `dx`), slowly enough
 * to see the others slide aside, and lets go.
 */
async function drag(page, pause, to, { dx = 0 } = {}) {
  const box = await to.boundingBox();
  const end = { x: box.x + box.width / 2 + dx, y: page.pointerAt.y };
  await page.mouse.down();
  await pause(page, 150);
  const from = page.pointerAt;
  const steps = Math.max(12, Math.round(Math.abs(end.x - from.x) / 6));
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((end.x - from.x) * i) / steps, end.y);
    await pause(page, 16);
  }
  page.pointerAt = end;
  await pause(page, 200);
  await page.mouse.up();
}

/** More work in the notebook, beside what the demo leaves uncommitted: syncing, across three files in one folder, and more. */
function syncWork(repo) {
  const add = (path, line) => appendFileSync(join(repo, path), `${line}\n`);
  add("src/sync/client.ts", "// Sync again once the network is back.");
  add("src/sync/conflicts.ts", "// Keep both versions of a note changed on two devices.");
  add("src/sync/retry.ts", "// Wait longer after each failed try, up to a minute.");
  add("src/ui/sidebar.tsx", "// Show when the notes last synced.");
  add("docs/sync.md", "Notes sync again by themselves once the network is back.");
}

export default {
  /** Tabs dragged into another order, as in a browser: the open one to the end, and back. */
  async "tab-drag"({ open, point, pause, demos, record }) {
    const projects = dirname(demos.notebook);
    for (const name of ["website", "tools"]) execFileSync("git", ["clone", "-q", demos.notebook, join(projects, name)]);
    const page = await open(demos.studio, { width: 1200, height: 750 });
    await openInNewTab(page, demos.notebook, "notebook");
    await openInNewTab(page, join(projects, "website"), "website");
    await openInNewTab(page, join(projects, "tools"), "tools");
    const tab = (name) => page.locator(".tabs > .tab[data-path]", { hasText: name });
    await tab("studio").click();
    await page.locator(".commit-row").first().waitFor({ timeout: 20_000 });
    // The pointer back out of the way, where the scene starts it.
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await pause(page, 600);
    // The tab bar and the top of the window under it, 16:10.
    await record(page, { x: 0, y: 0, width: 720, height: 450 }, async () => {
      await pause(page, 900);
      // studio, the open tab, to the end: the others slide aside as it passes them.
      await point(page, tab("studio"));
      await pause(page, 300);
      await drag(page, pause, tab("tools"), { dx: 20 });
      await pause(page, 1400);
      // And back to the front, where it started.
      await point(page, tab("studio"));
      await pause(page, 300);
      await drag(page, pause, tab("notebook"), { dx: -20 });
      await pause(page, 1200);
    });
    await page.close();
  },

  /** Uncommitted changes as a tree: switched to, a folder staged and unstaged, and back to the list. */
  async "changes-tree"({ open, point, pause, demos, record }) {
    syncWork(demos.notebook);
    const page = await open(demos.notebook);
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    const panel = page.locator("aside.details[aria-label='Uncommitted changes']");
    await panel.locator(".file").first().waitFor({ timeout: 10_000 });
    await pause(page, 400);
    const layout = (name) => panel.getByRole("button", { name, exact: true });
    const folder = (section, path) => panel.locator("section.files").nth(section).locator(".file-folder", { has: page.locator(`.file-folder-toggle[title='${path}']`) });
    // The commits and the changes beside them, 16:10.
    await record(page, { x: 460, y: 85, width: 820, height: 512 }, async () => {
      await pause(page, 1300);
      await press(page, point, pause, layout("Tree"), 1600);
      // The syncing code, staged as one: its folder moves up to Staged.
      await point(page, folder(1, "src/sync"));
      await pause(page, 500);
      await press(page, point, pause, panel.getByRole("button", { name: "Stage folder src/sync", exact: true }), 1700);
      await point(page, folder(0, "src/sync"));
      await pause(page, 500);
      await press(page, point, pause, panel.getByRole("button", { name: "Unstage folder src/sync", exact: true }), 1500);
      await press(page, point, pause, layout("List"), 1000);
    });
    await page.close();
  },
};
