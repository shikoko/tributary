// What's new in 0.11.0, for What's New and the release page (see clips.mjs).
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

/** The studio's checks in its commit's details: one failed, the rest passed (none running, whose time would tick on). */
function studioChecks() {
  const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
  const check = (name, state, from, to, detail = null) => ({ name, state, url: `https://github.com/example/feast/actions/runs/41/job/${name.length}`, detail, startedAt: ago(from), finishedAt: to === null ? null : ago(to), workflow: "Asset checks", trigger: "on push to main" });
  return {
    site: "GitHub",
    canRerun: true,
    checks: [
      check("Audio loudness", "failure", 410, 290, "2 files too loud"),
      check("Build (Windows)", "success", 365, 41),
      check("Build (macOS)", "success", 365, 61),
      check("Texture sizes", "success", 410, 352),
      check("Lint scripts", "success", 412, 371),
    ],
  };
}

/** Selects the checked-out commit, clicked where it is (Playwright's click would scroll the list first). */
async function selectHead(page) {
  const box = await page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first().locator(".cell.description").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export default {
  /** A failed check's Why?: its steps and the end of its log, then closed again. */
  async "why-failed"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio, { width: 1152, height: 720, fakes: { ciStates: { "": "failure" }, commitChecks: studioChecks() } });
    await selectHead(page);
    const row = page.locator(".details .commit-check.failure .commit-check-row");
    await row.locator(".check-why-chip").waitFor({ timeout: 10_000 });
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await pause(page, 600);
    const why = page.locator(".dialog.check-why");
    await record(page, { x: 0, y: 0, width: 1152, height: 720 }, async () => {
      await pause(page, 700);
      await press(page, point, pause, row.locator(".check-why-chip"), 300);
      await why.locator(".check-why-line.error").first().waitFor({ timeout: 5000 });
      await pause(page, 2600);
      // Closed with the pointer, so no focus ring is left on the row, as it started.
      await press(page, point, pause, why.locator(".dialog-close"), 300);
      await why.waitFor({ state: "detached", timeout: 5000 });
      await point(page, { x: 1151, y: 719 });
      await pause(page, 700);
    });
    await page.close();
  },

  /**
   * Coming back to the studio three days later: what arrived since, where you left off marked
   * beside the scrollbar, the count going there, and back to the newest commit.
   */
  async "since-last-here"({ open, point, pause, demos, record }) {
    const was = execFileSync("git", ["-C", demos.studio, "rev-parse", "origin/main~6"], { encoding: "utf8" }).trim();
    const seen = { at: Date.now() - 3 * 86_400_000, tips: { "origin/main": was } };
    const page = await open(demos.studio, { width: 1152, height: 720, storage: { [`tributary.seen.${demos.studio}`]: seen } });
    const banner = page.locator(".since-banner");
    await banner.waitFor({ timeout: 10_000 });
    // Where its mark beside the scrollbar is: the marks are spread over the strip's height, not
    // level with their rows, so found by pointing down the strip until its card says so.
    const strip = await page.locator(".list-markers").boundingBox();
    const card = page.locator(".mark-card.shown", { hasText: "Where you left off" });
    let mark = null;
    for (let y = strip.y + 2; y < strip.y + strip.height && !mark; y += 3) {
      await page.mouse.move(strip.x + strip.width / 2, y);
      if (await card.isVisible({ timeout: 0 }).catch(() => false)) mark = { x: strip.x + strip.width / 2, y };
      else await page.waitForTimeout(40);
    }
    if (!mark) throw new Error("no mark for where you left off");
    for (let tries = 0; tries < 3 && !(await card.isVisible()); tries++) await pause(page, 200);
    await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
    await card.waitFor({ state: "hidden", timeout: 5000 });
    await pause(page, 600);
    await record(page, { x: 0, y: 0, width: 1152, height: 720 }, async () => {
      await pause(page, 1200);
      // Where you left off, marked beside the scrollbar, and the card saying so.
      await point(page, mark);
      await card.waitFor({ timeout: 5000 });
      await pause(page, 1600);
      // The count goes there.
      await press(page, point, pause, banner.locator(".since-link").first(), 1400);
      await page.locator(`#commit-${was}.selected`).waitFor({ timeout: 5000 });
      // Back to the newest commit, and the pointer to where it started.
      const head = await page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first().locator(".cell.description").boundingBox();
      await press(page, point, pause, { x: head.x + head.width / 2, y: head.y + head.height / 2 }, 300);
      await point(page, { x: 1151, y: 719 });
      await pause(page, 900);
    });
    await page.close();
  },
};
