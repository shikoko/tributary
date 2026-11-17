// One run of a smoke test file: its own demo repositories, preview server and page, and the
// helpers its steps use. Each file starts from fresh demos, so what one file's steps do can't
// change what another's find.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTROLS, describe as describeAligned, EXCEPT, misaligned } from "../aligned.mjs";
import { describeOffCentre, moving, offCentre as offInPixels, probe, restore } from "../../e2e/centred.mjs";
import { buildDemos, demoEnv, STUDIO_PULL_REQUEST_CONVERSATIONS, STUDIO_PULL_REQUESTS } from "../demo.mjs";
import { startLockServer } from "../lfs-locks.mjs";
import { startPreview } from "../server.mjs";

/**
 * What the preview fakes for the studio demo: its pull requests and their comments from the
 * start (news is what changes after the first look), and a failed check on every commit,
 * which can be run again.
 */
export function studioFakes(demos) {
  const commitChecks = {
    site: "GitHub",
    canRerun: true,
    checks: [
      { name: "Build (Windows)", state: "success", url: "https://github.com/example/feast/actions/runs/31", detail: null, startedAt: null, finishedAt: null, workflow: "Checks", trigger: "on push to main" },
      { name: "Audio loudness", state: "failure", url: "https://github.com/example/feast/actions/runs/32", detail: "2 files too loud", startedAt: null, finishedAt: null, workflow: "Checks", trigger: "on push to main" },
    ],
  };
  return { pick: demos.studio, pullRequests: STUDIO_PULL_REQUESTS, conversations: structuredClone(STUDIO_PULL_REQUEST_CONVERSATIONS), ciStates: { "": "failure" }, commitChecks };
}

/**
 * A fresh session in `browser`, for the file `name`: its log is kept in `lines`, to print
 * once it's done (files run at the same time), and `failed` counts the steps that failed.
 */
export async function startSession({ browser, browserName, userAgent, axeSource, screenshots, name }) {
  const lines = [];
  const log = (line) => lines.push(line);
  const folder = mkdtempSync(join(tmpdir(), "tributary-smoke-"));
  const locks = await startLockServer({ port: 0 });
  const demos = buildDemos(folder, { lockServer: locks.url });
  const preview = await startPreview({ port: 0, quiet: true, env: demoEnv(demos) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 }, userAgent });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript((pick) => {
    window.__PREVIEW__ = { pick, pullRequests: [] };
    // No background fetches: the test fetches when it means to.
    localStorage.setItem("tributary.fetch.auto", "false");
    // Not someone new: no welcome tour, no What's new.
    localStorage.setItem("tributary.whatsNew.seen", JSON.stringify("999.0.0"));
    // No tour offers in the way (Help → Tours is tested on its own).
    localStorage.setItem("tributary.tours.off", "true");
  }, demos.notebook);
  const shots = screenshots ? join(screenshots, name) : null;
  if (shots) mkdirSync(shots, { recursive: true });

  const session = { name, lines, log, folder, locks, demos, preview, browser, browserName, userAgent, page, errors, failed: [], offCentre: new Map() };
  let shot = 0;
  const screenshot = () => (shots ? page.screenshot({ path: join(shots, `${String(++shot).padStart(2, "0")}.png`) }).catch(() => {}) : null);

  session.step = async (title, run) => {
    try {
      await run();
      log(`  ✓ ${title}`);
    } catch (error) {
      session.failed.push(title);
      // What went wrong, and where Playwright's call log ended up (what it was waiting for).
      const said = String(error.message ?? error).split("\n");
      const short = said.length > 8 ? [...said.slice(0, 3), "…", ...said.slice(-4)] : said;
      log(`  ✗ ${title}\n      ${short.join("\n      ")}`);
      await screenshot();
      await session.recover();
      return;
    }
    await screenshot();
  };

  /**
   * After a step that failed: what it left open (a dialog, a menu, a file's changes) is said,
   * for the log, then closed with Esc, so the steps after it start from the repository's view
   * rather than failing behind it.
   */
  session.recover = async () => {
    const open = await page
      .evaluate(() =>
        [...document.querySelectorAll(".dialog, [role='dialog'], [role='menu'], .diff-view")]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.innerText.replace(/\s+/g, " ").trim().slice(0, 300)),
      )
      .catch(() => []);
    for (const text of open) log(`      left open: ${text}`);
    for (let tries = 0; tries < 4; tries++) {
      const still = await page.locator(".dialog, [role='dialog'], [role='menu'], .diff-view").count().catch(() => 0);
      if (still === 0) break;
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  };

  /**
   * Back to `size` after a narrower window, once the full sidebar is back from its strip (a
   * narrow window has one) and has finished coming in: a click while it slides in can land
   * on another row than meant, or rest on a lane and dim the others.
   */
  session.restoreSize = async (size) => {
    await page.setViewportSize(size);
    await page.waitForFunction(() => !document.querySelector(".sidebar-strip"), null, { timeout: 5000 });
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
  };

  session.expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  /**
   * The words on what's on screen (buttons, menu items, tabs, chips, badges) sit in the middle
   * of them, at every display scale (aligned.mjs). With ALIGNED=report, what isn't is listed at
   * the end instead of failing the step.
   */
  session.centred = async (where, frame = page) => {
    const found = describeAligned(await misaligned(frame));
    // And in the window's own pixels, at 100%, where letters land on whole pixels: a control's
    // words can be in its middle by their measurements and still be a pixel off (centred.mjs).
    if (frame === page) {
      await page.waitForFunction(`(${moving})() === 0`, null, { timeout: 3000 }).catch(() => {});
      const measured = await page.evaluate(`(${probe})(${JSON.stringify(CONTROLS)}, ${JSON.stringify(EXCEPT)})`);
      let picture;
      try {
        picture = await page.screenshot();
      } finally {
        await page.evaluate(`(${restore})()`);
      }
      found.push(...describeOffCentre(offInPixels(picture, measured)).map((line) => `in pixels: ${line}`));
    }
    if (process.env.ALIGNED === "report") {
      for (const line of found) session.offCentre.set(line, [...(session.offCentre.get(line) ?? []), where]);
      return;
    }
    session.expect(found.length === 0, `${where}: ${[...new Set(found)].slice(0, 6).join("; ")}`);
  };

  /**
   * What's on screen (or just what's `within` a selector) meets WCAG 2.1's level A and AA
   * criteria that can be checked automatically. Other branches' labels in the graph are left out of the contrast check:
   * they're faded on purpose until their row is pointed at or selected.
   */
  session.accessible = async (where, frame = page, { within = null } = {}) => {
    // Once what's moving has stopped: halfway through fading in, text reads as fainter than it is.
    await frame.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
    if (!(await frame.evaluate(() => "axe" in window))) await frame.addScriptTag({ content: axeSource });
    const problems = await frame.evaluate(async ([faded, within]) => {
      const { violations } = await window.axe.run(within ? document.querySelector(within) : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return violations.flatMap((violation) =>
        violation.nodes
          .filter((node) => violation.id !== "color-contrast" || !document.querySelector(node.target.join(" "))?.closest(faded))
          .map((node) => `${violation.id} at ${node.target.join(" ")}${violation.id === "color-contrast" ? ` (${node.any[0]?.data?.contrastRatio} to 1)` : ""}`),
      );
    }, [".refs-cell .ref-pill:not(.current)", within]);
    session.expect(problems.length === 0, `${where}: ${[...new Set(problems)].slice(0, 6).join("; ")}`);
    await session.centred(where, frame);
  };

  session.toast = async () => {
    const element = page.locator(".toast");
    await element.waitFor({ timeout: 15_000 });
    return (await element.innerText()).replace(/\s+/g, " ");
  };
  session.dismissToast = async () => {
    if (await page.locator(".toast").count()) await page.locator(".toast span").first().click();
    await page.locator(".toast").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  };
  session.row = (text) => page.locator(".commit-row", { hasText: text }).first();
  /** Scroll the commit list to its end (only the rows on screen are drawn), or back to the top. */
  session.scrollList = (where) => page.locator(".list-scroller").evaluate((element, end) => element.scrollTo(0, end ? element.scrollHeight : 0), where === "end");

  /** The start screen, then the notebook demo opened from it, as a file's steps start. */
  session.openNotebook = async () => {
    await page.getByText("Open repository").first().click();
    await page.waitForSelector(".commit-row");
    await page.waitForSelector(".summary.wip", { timeout: 5000 });
  };

  /** The studio demo, with its pull requests and checks faked, opened in a new tab. */
  session.openStudio = async () => {
    await page.evaluate((fakes) => Object.assign(window.__PREVIEW__, fakes), studioFakes(demos));
    await page.getByRole("button", { name: "New tab" }).click();
    await page.getByText("Open repository").first().click();
    await session.row("Add a tavern chair").waitFor({ timeout: 15_000 });
  };

  session.close = async () => {
    await context.close().catch(() => {});
    await preview.close();
    await locks.close();
    rmSync(folder, { recursive: true, force: true });
  };

  await page.goto(preview.url);
  return session;
}
