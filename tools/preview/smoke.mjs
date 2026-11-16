// Clicks through the main parts of Tributary in a real browser, on freshly built demo
// repositories, with the app's own Rust code answering: open a repository, select and
// search commits, check out a branch (with uncommitted changes in the way), undo it,
// fetch, open a second tab, and look at Git LFS locks and big files.
//
//   npm run preview:build && npm run preview:smoke [-- --browser webkit] [--screenshots <folder>]
//
// It runs in Chromium, or with --browser webkit in WebKit, Safari's engine, which the Mac
// app's window uses. Needs Playwright with that browser, and axe-core (`npm install --no-save
// playwright axe-core` and `npx playwright install chromium`, or webkit, if they aren't
// installed already).

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildDemos, demoEnv, studioCommitRuns, STUDIO_PULL_REQUEST_CONVERSATIONS, STUDIO_PULL_REQUEST_DETAILS, STUDIO_PULL_REQUESTS } from "./demo.mjs";
import { CONTROLS, describe as describeAligned, EXCEPT, misaligned } from "./aligned.mjs";
import { describeOffCentre, moving, offCentre as offInPixels, probe, restore } from "../e2e/centred.mjs";
import { decodePng } from "../e2e/png.mjs";
import { startLockServer } from "./lfs-locks.mjs";
import { startPreview } from "./server.mjs";
import { crowded } from "./fits.mjs";

const browserAt = process.argv.indexOf("--browser");
const browserName = browserAt > 0 ? process.argv[browserAt + 1] : "chromium";

/** The browser's own user agent, with Linux in place of the Mac it runs on. */
async function notOnAMac(browser) {
  const probe = await browser.newPage();
  const agent = await probe.evaluate(() => navigator.userAgent);
  await probe.close();
  return agent.replace(/\(Macintosh;[^)]*\)/, "(X11; Linux x86_64)");
}

function loadPlaywright() {
  try {
    // Through require, so a globally installed Playwright (NODE_PATH) is found too.
    return createRequire(import.meta.url)("playwright");
  } catch {
    console.error(`The smoke test needs Playwright: npm install --no-save playwright && npx playwright install ${browserName}`);
    process.exit(2);
  }
}

// axe-core, which checks a page against WCAG's success criteria, as a script for the page.
function loadAxe() {
  try {
    return readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    console.error("The smoke test needs axe-core: npm install --no-save axe-core");
    process.exit(2);
  }
}
const axeSource = loadAxe();

const screenshotsAt = process.argv.indexOf("--screenshots");
const screenshots = screenshotsAt > 0 ? resolve(process.argv[screenshotsAt + 1]) : null;
if (screenshots) mkdirSync(screenshots, { recursive: true });

const engine = loadPlaywright()[browserName];
if (!engine?.launch) {
  console.error(`There's no browser called ${browserName} in Playwright: chromium or webkit.`);
  process.exit(2);
}
const folder = mkdtempSync(join(tmpdir(), "tributary-smoke-"));
const locks = await startLockServer({ port: 0 });
const demos = buildDemos(folder, { lockServer: locks.url });
const preview = await startPreview({ port: 0, quiet: true, env: demoEnv(demos) });
const browser = await engine.launch();
// On a Mac, Tributary's menus are in the Mac's own menu bar, which a page in a browser hasn't
// got, and the steps open them from the window's: so the page is told it's on Linux. The
// engine drawing it and running it is still the browser's own.
const userAgent = process.platform === "darwin" ? await notOnAMac(browser) : undefined;
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, userAgent });
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

let failed = 0;
let shot = 0;
async function step(name, run) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    // What went wrong, and where Playwright's call log ended up (what it was waiting for).
    const lines = String(error.message ?? error).split("\n");
    const said = lines.length > 8 ? [...lines.slice(0, 3), "…", ...lines.slice(-4)] : lines;
    console.log(`  ✗ ${name}\n      ${said.join("\n      ")}`);
    if (screenshots) await page.screenshot({ path: join(screenshots, `${String(++shot).padStart(2, "0")}.png`) }).catch(() => {});
    await recover();
    return;
  }
  if (screenshots) await page.screenshot({ path: join(screenshots, `${String(++shot).padStart(2, "0")}.png`) }).catch(() => {});
}

/**
 * After a step that failed: what it left open (a dialog, a menu, a file's changes) is said, for
 * the log, then closed with Esc, so the steps after it start from the repository's view
 * rather than failing behind it.
 */
async function recover() {
  const open = await page
    .evaluate(() =>
      [...document.querySelectorAll(".dialog, [role='dialog'], [role='menu'], .diff-view")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.innerText.replace(/\s+/g, " ").trim().slice(0, 300)),
    )
    .catch(() => []);
  for (const text of open) console.log(`      left open: ${text}`);
  for (let tries = 0; tries < 4; tries++) {
    const still = await page.locator(".dialog, [role='dialog'], [role='menu'], .diff-view").count().catch(() => 0);
    if (still === 0) break;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
}
/**
 * Back to `size` after a narrower window, once the full sidebar is back from its strip (a
 * narrow window has one) and has finished coming in: a click while it slides in can land
 * on another row than meant, or rest on a lane and dim the others.
 */
async function restoreSize(size) {
  await page.setViewportSize(size);
  await page.waitForFunction(() => !document.querySelector(".sidebar-strip"), null, { timeout: 5000 });
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
}

/**
 * What's on screen meets WCAG 2.1's level A and AA criteria that can be checked automatically.
 * Other branches' labels in the graph are left out of the contrast check: they're faded on
 * purpose until their row is pointed at or selected.
 */
async function accessible(where, frame = page) {
  // Once what's moving has stopped: halfway through fading in, text reads as fainter than it is.
  await frame.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
  if (!(await frame.evaluate(() => "axe" in window))) await frame.addScriptTag({ content: axeSource });
  const problems = await frame.evaluate(async (faded) => {
    const { violations } = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return violations.flatMap((violation) =>
      violation.nodes
        .filter((node) => violation.id !== "color-contrast" || !document.querySelector(node.target.join(" "))?.closest(faded))
        .map((node) => `${violation.id} at ${node.target.join(" ")}${violation.id === "color-contrast" ? ` (${node.any[0]?.data?.contrastRatio} to 1)` : ""}`),
    );
  }, ".refs-cell .ref-pill:not(.current)");
  expect(problems.length === 0, `${where}: ${[...new Set(problems)].slice(0, 6).join("; ")}`);
  await centred(where, frame);
}

/**
 * The words on what's on screen (buttons, menu items, tabs, chips, badges) sit in the middle
 * of them, at every display scale (aligned.mjs). With ALIGNED=report, what isn't is listed at
 * the end instead of failing the step.
 */
const offCentre = new Map();
async function centred(where, frame = page) {
  const found = describeAligned(await misaligned(frame));
  // And in the window's own pixels, at 100%, where letters land on whole pixels: a control's
  // words can be in its middle by their measurements and still be a pixel off (centred.mjs).
  if (frame === page) {
    await page.waitForFunction(`(${moving})() === 0`, null, { timeout: 3000 }).catch(() => {});
    const measured = await page.evaluate(`(${probe})(${JSON.stringify(CONTROLS)}, ${JSON.stringify(EXCEPT)})`);
    let shot;
    try {
      shot = await page.screenshot();
    } finally {
      await page.evaluate(`(${restore})()`);
    }
    found.push(...describeOffCentre(offInPixels(shot, measured)).map((line) => `in pixels: ${line}`));
  }
  if (process.env.ALIGNED === "report") {
    for (const line of found) offCentre.set(line, [...(offCentre.get(line) ?? []), where]);
    return;
  }
  expect(found.length === 0, `${where}: ${[...new Set(found)].slice(0, 6).join("; ")}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const toast = async () => {
  const element = page.locator(".toast");
  await element.waitFor({ timeout: 15_000 });
  return (await element.innerText()).replace(/\s+/g, " ");
};
const dismissToast = async () => {
  if (await page.locator(".toast").count()) await page.locator(".toast span").first().click();
  await page.locator(".toast").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
};
const row = (text) => page.locator(".commit-row", { hasText: text }).first();
/** Scroll the commit list to its end (only the rows on screen are drawn), or back to the top. */
const scrollList = (where) => page.locator(".list-scroller").evaluate((el, end) => el.scrollTo(0, end ? el.scrollHeight : 0), where === "end");

console.log("Tributary smoke test");
try {
  await page.goto(preview.url);

  await step("shows the welcome screen", async () => {
    await page.getByText("Open repository").first().waitFor();
    await accessible("the welcome screen");
  });

  await step("opens a repository", async () => {
    await page.getByText("Open repository").first().click();
    await page.waitForSelector(".commit-row");
    const rows = await page.locator(".commit-row").count();
    expect(rows > 20, `only ${rows} rows`);
    await page.waitForSelector(".summary.wip", { timeout: 5000 });
  });

  await step("offers to update a submodule a pull left behind, and updates it", async () => {
    const banner = page.locator(".notice-banner", { hasText: "editor-kit" });
    await banner.waitFor({ timeout: 10_000 });
    await page.locator(".sidebar-submodule", { hasText: "out of date" }).waitFor({ timeout: 5000 });
    await banner.getByRole("button", { name: "Update it" }).click();
    await banner.waitFor({ state: "detached", timeout: 15_000 });
    await page.locator(".sidebar-submodule", { hasText: "out of date" }).waitFor({ state: "detached", timeout: 5000 });
    await dismissToast();
  });

  await step("shows a submodule's change as the commits it moved by", async () => {
    await row("Use the editor kit's faster rendering").click();
    await page.locator(".details .file", { hasText: "editor-kit" }).click();
    const view = page.locator(".diff-submodule");
    await view.waitFor({ timeout: 10_000 });
    const text = await view.innerText();
    expect(text.includes("Moved forward by 2 commits") && text.includes("Render long notes faster"), `diff "${text.slice(0, 80)}"`);
    await page.keyboard.press("Escape");
  });

  await step("shows a commit's details", async () => {
    // It's near the end, which isn't drawn until it's scrolled to: how near depends on how
    // many days the commits cross, which depends on the time of day the demo is made.
    await scrollList("end");
    await row("Add the note model").click();
    await page.locator(".details", { hasText: "Sam Okafor" }).waitFor({ timeout: 5000 });
    await accessible("a commit's details");
    await scrollList("top");
  });

  await step("searches commits", async () => {
    await page.keyboard.press("Control+f");
    await page.keyboard.type("sync");
    const count = await page.locator(".search-count").innerText();
    expect(/\d/.test(count), `search count "${count}"`);
    await page.keyboard.press("Escape");
  });

  await step("checks out a branch, taking the changes along", async () => {
    await page.locator(".ref-pill", { hasText: "feature/tags" }).first().dblclick();
    const text = await toast();
    expect(/feature\/tags/.test(text), `toast "${text}"`);
    await page.locator(".head-chip", { hasText: "feature/tags" }).waitFor({ timeout: 5000 });
  });

  await step("undoes the checkout", async () => {
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(".head-chip", { hasText: "main" }).waitFor({ timeout: 15_000 });
    await dismissToast();
  });

  await step("stashes changes in the way of a checkout, and puts them back", async () => {
    // A change to a file that's different on the other branch.
    const store = join(demos.notebook, "src", "store.ts");
    writeFileSync(store, `// Draft: batch writes\n${readFileSync(store, "utf8")}`);
    await page.locator(".ref-pill", { hasText: "feature/tags" }).first().dblclick();
    await page.getByRole("button", { name: "Stash changes and retry" }).click({ timeout: 15_000 });
    const text = await toast();
    expect(/feature\/tags/.test(text), `toast "${text}"`);
    expect(readFileSync(store, "utf8").startsWith("// Draft"), "the change wasn't put back");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(".head-chip", { hasText: "main" }).waitFor({ timeout: 15_000 });
    expect(readFileSync(store, "utf8").startsWith("// Draft"), "the change was lost on undo");
    await dismissToast();
  });

  await step("fetches a teammate's commit", async () => {
    await page.locator(".tool-button", { hasText: "Fetch" }).click();
    await toast();
    await row("Tidy up the settings screen").waitFor({ timeout: 10_000 });
    // Two labels on that commit: the one that doesn't fit is a click away.
    await row("Tidy up the settings screen").locator(".ref-pill.more").click();
    await page.locator(".menu-item", { hasText: /origin\/(main|feature\/onboarding)/ }).first().click();
    await page.locator(".menu-item", { hasText: /Highlight origin\/(main|feature\/onboarding)'s history/ }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    // A teammate merged main into feature/export: the local branch's label says it's behind.
    const exportLabel = page.locator(".commit-list .ref-pill:is([title^='Branch feature/export (local)'], [data-hint^='Branch feature/export (local)'])");
    await exportLabel.locator(".ref-sync", { hasText: "↓" }).waitFor({ timeout: 10_000 });
    expect((await exportLabel.getAttribute("data-hint"))?.includes("behind origin/feature/export"), "the label doesn't say it's behind");
    await dismissToast();
  });

  await step("makes a tag in a dialog, and undoes it", async () => {
    await scrollList("end");
    await row("Add the note model").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "New tag here" }).click();
    await page.getByPlaceholder("v1.2.0").fill("v0.0.9");
    await accessible("the new tag dialog");
    await page.getByRole("button", { name: "Create tag" }).click();
    const tag = page.locator(".ref-pill", { hasText: "v0.0.9" });
    await tag.first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".ref-pill")].some((pill) => pill.textContent?.includes("v0.0.9")), null, { timeout: 10_000 });
    await dismissToast();
    await scrollList("top");
  });

  await step("offers a hard reset from a branch label, and uses your own colours", async () => {
    await page.locator(".commit-list .ref-pill:is([title^='Branch feature/export (local'], [data-hint^='Branch feature/export (local'])").first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Hard reset main to feature/export…" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.locator(".settings-nav").getByText("Graph").click();
    await settings.getByRole("radio", { name: /Your own/ }).click();
    expect((await settings.locator(".lane-editor-swatch").count()) >= 8, "your own colours didn't start from the vivid ones");
    // Drag the first colour to the third's place, then move it back with the keyboard.
    const colours = () => settings.locator(".lane-editor-swatch input").evaluateAll((inputs) => inputs.map((input) => input.value));
    const before = await colours();
    const swatches = settings.locator(".lane-editor-swatch");
    const from = await swatches.nth(0).boundingBox();
    const to = await swatches.nth(2).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    const dragged = await colours();
    expect(dragged[2] === before[0] && dragged[0] === before[1] && dragged[1] === before[2], `dragging didn't move the colour (${dragged.slice(0, 3)})`);
    await swatches.nth(2).locator("input").focus();
    for (const _ of [1, 2]) {
      await page.keyboard.press("Alt+ArrowLeft");
      await page.waitForTimeout(100);
    }
    expect(JSON.stringify(await colours()) === JSON.stringify(before), "Alt+arrows didn't move it back");
    // Back up to Appearance from the title ("Appearance › Graph").
    await settings.locator(".settings-panel-parent", { hasText: "Appearance" }).click();
    await settings.getByLabel("Accent colour, as a hex code").fill("#e8702a");
    const accent = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"));
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--accent") === "#e8702a", null, { timeout: 5000 });
    await settings.getByRole("button", { name: "Reset appearance" }).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--accent") === "#1fb5ff", null, { timeout: 5000 });
    expect((await accent()) === "#1fb5ff", "the accent wasn't reset");
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("highlights a file's history, until Esc", async () => {
    await row("Speed up opening large notebooks").click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Show this file's history" }).click();
    const banner = page.locator(".view-banner", { hasText: "store.ts" });
    await banner.waitFor({ timeout: 10_000 });
    await page.locator("body").press("Escape");
    await banner.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows a file's changes in a commit, with the changed words marked", async () => {
    await row("Speed up opening large notebooks").click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-row.added mark").first().waitFor({ timeout: 10_000 });
    const stats = await view.locator(".diff-stats").innerText();
    expect(/^\+\d+ −\d+$/.test(stats.trim()), `stats "${stats}"`);
    await accessible("a file's changes");
    // Side by side: a removed line next to the line that replaced it, then back to one column.
    await view.getByRole("button", { name: "Side by side" }).click();
    await view.locator(".diff-split-row", { has: page.locator(".diff-half.removed") }).filter({ has: page.locator(".diff-half.added") }).first().waitFor({ timeout: 5000 });
    expect((await view.locator(".diff-row").count()) === 0, "lines in one column while side by side");
    await view.getByRole("button", { name: "Side by side" }).click();
    await view.locator(".diff-row").first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // Esc closed the changes, not the details.
    await page.locator(".details", { hasText: "Priya Nair" }).waitFor({ timeout: 5000 });
  });

  await step("wraps long lines when asked, and remembers it", async () => {
    const store = join(demos.notebook, "src", "store.ts");
    const before = readFileSync(store, "utf8");
    writeFileSync(store, `${before}// ${"How notebooks are kept, a note that goes on and on. ".repeat(6).trim()}\n`);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
      const open = async () => {
        await page.locator(".details .file", { hasText: "store.ts" }).first().click();
        await view.locator(".diff-row.added", { hasText: "goes on and on" }).waitFor({ timeout: 10_000 });
      };
      const close = async () => {
        await view.getByRole("button", { name: "Close the changes" }).click();
        await view.waitFor({ state: "detached", timeout: 5000 });
      };
      const view = page.locator(".diff-view");
      const wrap = view.getByRole("button", { name: "Wrap lines" });
      const pressed = async () => (await wrap.getAttribute("aria-pressed")) === "true";
      const sideways = () => view.locator(".diff-body").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      await open();
      expect(!(await pressed()) && (await sideways()), "the long line didn't need scrolling to");
      await wrap.click();
      expect(!(await sideways()), "wrapped, the changes still scroll sideways");
      const tall = (await view.locator(".diff-row.added", { hasText: "goes on and on" }).boundingBox()).height;
      expect(tall >= 40, `the wrapped line is ${tall}px tall`);
      // Remembered the next time.
      await close();
      await open();
      expect(await pressed(), "Wrap lines wasn't remembered");
      // Side by side, lines always wrap: pressed, and not to be turned off there.
      await view.getByRole("button", { name: "Side by side" }).click();
      await view.locator(".diff-split-row").first().waitFor({ timeout: 5000 });
      expect((await pressed()) && (await wrap.isDisabled()), "side by side, Wrap lines isn't pressed and greyed");
      await view.getByRole("button", { name: "Side by side" }).click();
      await view.locator(".diff-row").first().waitFor({ timeout: 5000 });
      await wrap.click();
      expect(await sideways(), "unwrapped again, the long line doesn't need scrolling to");
      await close();
    } finally {
      writeFileSync(store, before);
    }
  });

  await step("shows your changes, and follows a file you stage", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .file", { hasText: "README.md" }).click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-row.added", { hasText: "Onboarding" }).first().waitFor({ timeout: 10_000 });
    await view.locator(".diff-source", { hasText: "Not staged" }).waitFor({ timeout: 5000 });
    await accessible("your changes");
    // Step to another file and back with [ and ].
    const [at, of] = (await view.locator(".diff-count").innerText()).split(" of ").map(Number);
    await page.keyboard.press(at < of ? "]" : "[");
    await view.locator(".diff-name", { hasText: "README.md" }).waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press(at < of ? "[" : "]");
    await view.locator(".diff-name", { hasText: "README.md" }).waitFor({ timeout: 5000 });
    await page.locator(".details .file", { hasText: "README.md" }).hover();
    await page.getByRole("button", { name: "Stage README.md", exact: true }).click();
    await view.locator(".diff-source", { hasText: "Staged" }).waitFor({ timeout: 10_000 });
    // The row moved to Staged, under the pointer or not: the pointer moves away and onto it
    // until its button shows, as WebKit only looks at what's under the pointer when it moves.
    const unstage = page.getByRole("button", { name: "Unstage README.md", exact: true });
    for (let tries = 0; tries < 5 && !(await unstage.isVisible()); tries++) {
      await page.mouse.move(0, 0);
      await page.locator(".details .file.shown", { hasText: "README.md" }).hover();
      await page.waitForTimeout(200);
    }
    await unstage.click();
    await view.locator(".diff-source", { hasText: "Not staged" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows your changes in a tree, and stages and unstages a folder", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" });
    const staged = () => git("diff", "--cached", "--name-only").trim().split("\n").filter(Boolean).sort().join(", ");
    const before = staged();
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const panel = page.locator("aside.details[aria-label='Uncommitted changes']");
    await panel.getByRole("button", { name: "Tree", exact: true }).click();
    // The new file's folders, with nothing else in them, are one row in Unstaged.
    const unstaged = panel.locator("section.files").nth(1);
    const folder = unstaged.locator(".file-folder", { has: page.locator(".file-folder-toggle[title='src/ui/onboarding']") });
    await folder.waitFor({ timeout: 5000 });
    await accessible("your changes as a tree");
    await folder.hover();
    await panel.getByRole("button", { name: "Stage folder src/ui/onboarding", exact: true }).click();
    await folder.waitFor({ state: "detached", timeout: 10_000 });
    expect(staged() === "src/ui/onboarding/tour.tsx, src/ui/onboarding/welcome.tsx", `staged ${staged()}`);
    // Both files are in the folder in Staged now, and its button unstages them both.
    const stagedFolder = panel.locator("section.files").first().locator(".file-folder", { has: page.locator(".file-folder-toggle[title='src/ui/onboarding']") });
    await stagedFolder.hover();
    await panel.getByRole("button", { name: "Unstage folder src/ui/onboarding", exact: true }).click();
    await stagedFolder.waitFor({ state: "detached", timeout: 10_000 });
    expect(staged() === "", `still staged: ${staged()}`);
    // Back as it was, and to the list, which the steps after expect (the choice is remembered).
    git("add", "src/ui/onboarding/welcome.tsx");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await panel.getByRole("button", { name: "List", exact: true }).click();
    await panel.locator(".file-folder").first().waitFor({ state: "detached", timeout: 5000 });
    expect(staged() === before, `staged ${staged()}, not ${before}`);
  });

  await step("stages two chosen lines, then discards a hunk and puts it back", async () => {
    const store = join(demos.notebook, "src", "store.ts");
    const before = readFileSync(store, "utf8");
    writeFileSync(store, `${before.replace("const VERSION = 2;", "const VERSION = 3;")}\n// Old notes are compacted once a week.\n`);
    // The file is read again when the window gets the focus.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-row.added", { hasText: "VERSION = 3" }).waitFor({ timeout: 10_000 });
    await view.locator(".diff-row.removed", { hasText: "VERSION = 2" }).locator(".diff-number").first().click();
    await view.locator(".diff-row.added", { hasText: "VERSION = 3" }).locator(".diff-number").nth(1).click({ modifiers: ["Shift"] });
    await view.locator(".line-bar").getByRole("button", { name: "Stage 2 lines" }).click();
    await page.locator(".toast", { hasText: "Staged 2 lines of src/store.ts" }).waitFor({ timeout: 10_000 });
    const staged = execFileSync("git", ["-C", demos.notebook, "show", ":src/store.ts"], { encoding: "utf8" });
    expect(staged.includes("const VERSION = 3;") && !staged.includes("compacted"), "staged more than the two lines");
    await dismissToast();
    // Throw away the new comment at the end, and put it back.
    const hunk = view.locator(".diff-hunk", { hasText: "compacted" });
    await hunk.getByRole("button", { name: "Discard" }).click();
    await page.locator(".toast", { hasText: "Discarded" }).waitFor({ timeout: 10_000 });
    expect(!readFileSync(store, "utf8").includes("compacted"), "the lines weren't discarded");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(".toast", { hasText: "Put the discarded lines back" }).waitFor({ timeout: 10_000 });
    expect(readFileSync(store, "utf8").includes("compacted"), "the lines didn't come back");
    await dismissToast();
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // Back as it was, for the steps after this one.
    execFileSync("git", ["-C", demos.notebook, "reset", "-q", "--", "src/store.ts"]);
    writeFileSync(store, before);
  });

  await step("discards all changes, new files too, showing it's working, and puts them back", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" });
    const status = () => git("status", "--porcelain", "--untracked-files=all");
    const sketches = join(demos.notebook, "sketches");
    mkdirSync(sketches, { recursive: true });
    writeFileSync(join(sketches, "idea.md"), "A note that isn't committed yet.\n");
    const before = status();
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    // A new folder is listed as itself. The files are read again when the window gets the
    // focus, at most every 2 seconds.
    const listed = page.locator(".details .file", { hasText: "sketches" }).first();
    for (let tries = 0; tries < 20 && !(await listed.isVisible()); tries++) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(500);
    }
    await listed.waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Discard all changes" }).click();
    const dialog = page.locator(".dialog", { hasText: "Discard all uncommitted changes?" });
    // The new folder, with everything in it: not "1 new file".
    await dialog.locator("li", { hasText: "1 new folder will be deleted, with everything in it" }).waitFor({ timeout: 5000 });
    // git says nothing while it puts thousands of files away. Held back here for a moment, as
    // a big discard is, it shows it's working, with how many files go, and no Cancel: stopped
    // halfway, some of the files would be gone and some not.
    const slowly = async (route) => {
      if (route.request().postData()?.includes('"discardAll"')) await new Promise((done) => setTimeout(done, 1500));
      // Already let through if the step stopped holding requests back while this one waited.
      await route.continue().catch(() => {});
    };
    await page.route("**/__preview/invoke", slowly);
    try {
      await dialog.getByRole("button", { name: "Discard changes" }).click();
      const strip = page.locator(".progress-strip");
      await strip.waitFor({ timeout: 5000 });
      const said = (await strip.innerText()).replace(/\s+/g, " ");
      expect(/Discarding \d+ files? and 1 new folder…/.test(said), `the progress said "${said}"`);
      expect((await strip.getByRole("button", { name: "Cancel" }).count()) === 0, "a discard can be cancelled halfway");
      await page.locator(".toast", { hasText: "Discarded all uncommitted changes" }).waitFor({ timeout: 10_000 });
    } finally {
      await page.unroute("**/__preview/invoke", slowly);
    }
    expect(!existsSync(sketches), "the new file wasn't deleted");
    expect(status() === "", "changes were left");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(".toast", { hasText: "Put the discarded changes back" }).waitFor({ timeout: 10_000 });
    expect(status() === before, "the changes didn't all come back as they were");
    rmSync(sketches, { recursive: true, force: true });
    await dismissToast();
  });

  await step("fixes up an earlier commit with the staged changes, and undoes it", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    const head = git("rev-parse", "HEAD");
    const staged = git("diff", "--cached", "--name-only");
    expect(staged !== "", "nothing staged in the demo");
    await row("Fix the note counter in the sidebar").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Fix up this commit with the staged changes" }).click();
    // main is protected: rewriting it is confirmed first.
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("textbox").fill("main", { timeout: 5000 });
    await dialog.getByRole("button", { name: "Fix it up" }).click();
    await page.locator(".toast", { hasText: "with your staged changes" }).waitFor({ timeout: 15_000 });
    expect(git("log", "-3", "--format=%s") === "Prepare the 0.3 release notes\nUse the editor kit's faster rendering\nFix the note counter in the sidebar", "the commits changed");
    expect(git("diff", "--cached", "--name-only") === "", "the staged changes weren't folded in");
    expect(git("show", "--name-only", "--format=", "HEAD~2").split("\n").includes(staged.split("\n")[0]), "the fix went into the wrong commit");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    for (let tries = 0; git("rev-parse", "HEAD") !== head && tries < 50; tries++) await page.waitForTimeout(100);
    expect(git("rev-parse", "HEAD") === head, "undo didn't put the branch back");
    expect(git("diff", "--cached", "--name-only") === staged, "undo didn't stage the changes again");
    await dismissToast();
  });

  await step("bisects to the first bad commit", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    const head = git("rev-parse", "HEAD");
    // Bisecting checks out older commits: the demo's changes go aside meanwhile. (The app
    // may be reading the repository right then, holding one of git's locks for a moment, so
    // it's tried again for a few seconds whatever went wrong.)
    for (let tries = 0; ; tries++) {
      try {
        git("stash", "push", "-q", "--include-untracked", "-m", "smoke: bisect");
        break;
      } catch (e) {
        if (tries >= 20) throw e;
        await page.waitForTimeout(150);
      }
    }
    try {
      await page.keyboard.press("F5");
      // Once the app has read the repository again, with the stash: its row goes in near the
      // top and the commits below move down one. A right-click while they move landed on the
      // row that took the commit's place (High-contrast theme, on feature/themes, not in
      // main's history), and bisecting from there failed.
      await row("smoke: bisect").waitFor({ timeout: 10_000 });
      await row("Fix the note counter in the sidebar").click({ button: "right" });
      await page.locator(".menu-item", { hasText: "Find what broke since this commit (bisect)…" }).click();
      const dialog = page.locator(".dialog", { hasText: "Find the commit that broke it" });
      await dialog.waitFor({ timeout: 5000 });
      expect((await dialog.innerText()).includes("Fix the note counter in the sidebar"), `bisecting from the wrong commit: ${(await dialog.innerText()).replace(/\s+/g, " ")}`);
      await dialog.getByRole("button", { name: "Start bisecting" }).click();
      const bar = page.locator(".bisect-bar");
      const prompt = bar.filter({ hasText: "then say whether it's good or bad" });
      const failed = page.locator(".error-banner");
      // Started, or said why not: either way, without waiting the whole time for it.
      await prompt.or(failed).first().waitFor({ timeout: 15_000 }).catch(() => {});
      if (!(await prompt.count())) {
        // What the bar, an error and git said, so a failure here says why.
        const said = async (locator) => ((await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, " ").trim() : "nothing");
        let log;
        try {
          log = git("bisect", "log").split("\n").filter((line) => !line.startsWith("#")).join("; ");
        } catch {
          log = "not bisecting";
        }
        throw new Error(`no bisect prompt. The bar: ${await said(bar)}. An error: ${await said(failed)}. git bisect log: ${log}. git status: ${git("status", "--short") || "clean"}`);
      }
      // Everything after the good commit is bad: the first one after it is the culprit.
      for (let tries = 0; tries < 5 && !(await bar.filter({ hasText: "Found it" }).count()); tries++) {
        await bar.getByRole("button", { name: "Bad", exact: true }).click();
        await page.waitForTimeout(300);
        await page.locator(".progress-strip").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      }
      await bar.filter({ hasText: "Found it" }).filter({ hasText: "Use the editor kit's faster rendering" }).waitFor({ timeout: 10_000 });
      await page.locator(".bisect-tag.found").first().waitFor({ timeout: 5000 });
      await page.locator(".bisect-tag.good").first().waitFor({ timeout: 5000 });
      await bar.getByRole("button", { name: "Done" }).click();
      await bar.waitFor({ state: "detached", timeout: 10_000 });
      expect(git("rev-parse", "HEAD") === head && git("branch", "--show-current") === "main", "not back on main");
      await dismissToast();
    } finally {
      git("stash", "pop", "-q", "--index");
      await page.keyboard.press("F5");
    }
  });

  await step("resolves a merge conflict here, conflict by conflict, and undoes it", async () => {
    const folder = demos.notebook;
    const who = { GIT_AUTHOR_NAME: "Priya Nair", GIT_AUTHOR_EMAIL: "priya@example.com", GIT_COMMITTER_NAME: "Priya Nair", GIT_COMMITTER_EMAIL: "priya@example.com" };
    const git = (args, env = {}, input) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", env: { ...process.env, ...who, ...env }, input });
    const store = join(folder, "src", "store.ts");
    const before = readFileSync(store, "utf8");
    const head = git(["rev-parse", "HEAD"]).trim();
    const staged = git(["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean);
    // Theirs, on a branch made without checking it out; mine, committed on main.
    const blob = git(["hash-object", "-w", "--stdin"], {}, before.replace("const VERSION = 2;", "const VERSION = 4;"));
    const index = join(folder, ".git", "smoke-theirs.index");
    git(["read-tree", "HEAD"], { GIT_INDEX_FILE: index });
    git(["update-index", "--cacheinfo", `100644,${blob.trim()},src/store.ts`], { GIT_INDEX_FILE: index });
    const tree = git(["write-tree"], { GIT_INDEX_FILE: index }).trim();
    rmSync(index, { force: true });
    git(["branch", "smoke/version", git(["commit-tree", tree, "-p", "HEAD", "-m", "Version 4"]).trim()]);
    writeFileSync(store, before.replace("const VERSION = 2;", "const VERSION = 3;"));
    git(["commit", "-q", "-m", "Version 3", "--", "src/store.ts"]);
    // A merge needs nothing staged.
    if (staged.length) git(["reset", "-q", "--", ...staged]);
    try {
      git(["merge", "smoke/version"]);
    } catch {
      // It stops with the conflict, as it should.
    }
    expect(git(["ls-files", "-u"]).includes("src/store.ts"), "no conflict to resolve");
    await page.keyboard.press("F5");
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .conflicts .file", { hasText: "store.ts" }).click();
    const card = page.locator(".conflict-card").first();
    await card.waitFor({ timeout: 10_000 });
    const save = page.getByRole("button", { name: "Save and mark resolved" });
    expect(await save.isDisabled(), "saving before every conflict was resolved");
    await card.getByRole("button", { name: "Theirs", exact: true }).click();
    await save.click();
    await page.locator(".toast", { hasText: "Resolved the conflicts in store.ts" }).waitFor({ timeout: 10_000 });
    expect(git(["ls-files", "-u"]).trim() === "", "still conflicted after saving");
    expect(readFileSync(store, "utf8").includes("const VERSION = 4;"), "theirs wasn't kept");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.locator(".toast", { hasText: "Put the conflicts back" }).waitFor({ timeout: 10_000 });
    expect(readFileSync(store, "utf8").includes("<<<<<<<"), "the conflict didn't come back");
    await dismissToast();
    await page.keyboard.press("Escape");
    // Back as it was, for the steps after this one.
    git(["merge", "--abort"]);
    git(["reset", "-q", "--soft", head]);
    git(["reset", "-q", "--", "src/store.ts"]);
    writeFileSync(store, before);
    if (staged.length) git(["add", "--", ...staged]);
    git(["branch", "-q", "-D", "smoke/version"]);
    await page.keyboard.press("F5");
    await page.locator(".operation-bar").waitFor({ state: "detached", timeout: 10_000 });
  });

  await step("compares a branch with the checked-out one, and opens a file's change", async () => {
    await page.locator(".commit-list .ref-pill:is([title^='Branch feature/export (local'], [data-hint^='Branch feature/export (local'])").first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Compare with main" }).click();
    const panel = page.locator(".compare-panel");
    await panel.locator(".file", { hasText: "zip.ts" }).click({ timeout: 10_000 });
    const facts = await panel.locator(".compare-facts").innerText();
    expect(/feature\/export has \d+ commits? that main doesn't/.test(facts), `facts "${facts}"`);
    const view = page.locator(".diff-view");
    await view.locator(".diff-source", { hasText: "main → feature/export" }).waitFor({ timeout: 10_000 });
    await view.locator(".diff-row.added").first().waitFor({ timeout: 10_000 });
    // Esc closes the file's changes, then the comparison.
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    await panel.getByRole("button", { name: "Directly" }).click();
    await panel.locator(".files h3", { hasText: /different files/ }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows who changed each line of a file, and goes to their commit", async () => {
    await row("Speed up opening large notebooks").click();
    await page.locator(".details .file", { hasText: "store.ts" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Who changed each line" }).click();
    const view = page.locator(".blame-view");
    await view.locator(".blame-gutter", { hasText: "Maya Chen" }).first().waitFor({ timeout: 10_000 });
    expect((await view.locator(".blame-gutter", { hasText: "Priya Nair" }).count()) > 0, "Priya's lines aren't credited to her");
    await accessible("who changed each line");
    // Step back to the version before Priya's change: those lines were Maya's then.
    const priya = view.locator(".blame-gutter-cell", { has: page.locator(".blame-gutter", { hasText: "Priya Nair" }) }).first();
    await priya.hover();
    await priya.locator(".blame-back").click();
    await view.locator(".diff-source", { hasText: /^Before / }).waitFor({ timeout: 10_000 });
    await view.locator(".blame-gutter", { hasText: "Maya Chen" }).first().waitFor({ timeout: 10_000 });
    expect((await view.locator(".blame-gutter", { hasText: "Priya Nair" }).count()) === 0, "Priya's change is still there before it");
    await view.getByRole("button", { name: "Back", exact: true }).click();
    await view.locator(".blame-gutter", { hasText: "Priya Nair" }).first().waitFor({ timeout: 10_000 });
    // Maya's lines come from "Store notes in IndexedDB": clicking goes there.
    await view.locator(".blame-gutter", { hasText: "Maya Chen" }).first().click();
    await page.locator(".details", { hasText: "Store notes in IndexedDB" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // Back near the top, where the next steps expect the list.
    await scrollList("top");
    await row("Speed up opening large notebooks").click();
  });

  await step("searches every branch for commits that changed a file, or some code", async () => {
    const box = page.getByLabel("Search commits");
    const count = page.locator(".search-count");
    const settled = () =>
      page.waitForFunction(() => {
        const text = document.querySelector(".search-count")?.textContent ?? "";
        return text !== "" && !text.includes("Searching");
      }, null, { timeout: 10_000 });
    await page.getByLabel("Search in").selectOption("files");
    await box.fill("store");
    await settled();
    expect(/of 2/.test(await count.innerText()), `files: "${await count.innerText()}"`);
    await page.locator(".commit-row.primary", { hasText: "Speed up opening large notebooks" }).waitFor({ timeout: 5000 });
    await page.getByLabel("Search in").selectOption("code");
    await box.fill("PAGE_SIZE");
    await page.waitForTimeout(100);
    await settled();
    expect(/1 of 1/.test(await count.innerText()), `code: "${await count.innerText()}"`);
    await box.press("Escape");
    await page.getByLabel("Search in").selectOption("message");
    await box.press("Escape");
  });

  await step("lists each branch once, with the remote's others folded away", async () => {
    const sidebar = page.locator(".sidebar");
    // feature/export is here and on origin: one row, whose menu offers origin's copy too.
    const exportRows = sidebar.locator(".sidebar-item .sidebar-name").filter({ hasText: /^export$/ });
    expect((await exportRows.count()) === 1, `export is listed ${await exportRows.count()} times`);
    await exportRows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete feature/export from origin…" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    // feature/onboarding is only on origin: folded away until its group is opened.
    const onlyOnOrigin = sidebar.getByRole("button", { name: /Only on origin/ });
    expect((await sidebar.locator(".sidebar-name", { hasText: "onboarding" }).count()) === 0, "a branch only on origin is shown before its group is opened");
    await onlyOnOrigin.click();
    await sidebar.locator(".sidebar-name", { hasText: "onboarding" }).waitFor({ timeout: 5000 });
    await onlyOnOrigin.click();
  });

  await step("hides a branch, then shows everything again", async () => {
    const themes = page.locator(".sidebar-item", { hasText: /^themes/ }).first();
    await themes.hover();
    await themes.locator(".sidebar-eye").click();
    await page.locator(".sidebar-visibility", { hasText: "1 hidden" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).waitFor({ state: "detached", timeout: 10_000 });
    await page.locator(".sidebar-visibility").getByRole("button", { name: "Show all" }).click();
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().waitFor({ timeout: 10_000 });
  });

  await step("says what a mark beside the scrollbar is, and lights it up", async () => {
    // The marks, from their canvas: the middle of each run of painted rows.
    const strip = await page.evaluate(() => {
      const canvas = document.querySelector(".list-markers");
      const box = canvas.getBoundingClientRect();
      const data = canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data;
      const marks = [];
      for (let y = 0, start = -1; y <= canvas.height; y++) {
        const painted = y < canvas.height && data[y * 4 + 3] > 0;
        if (painted && start < 0) start = y;
        if (!painted && start >= 0) {
          marks.push(((start + y) / 2) * (box.height / canvas.height));
          start = -1;
        }
      }
      return { x: box.left + box.width / 2, top: box.top, marks };
    });
    expect(strip.marks.length > 0, "no marks beside the scrollbar");
    await page.mouse.move(strip.x, strip.top + strip.marks[0]);
    const card = page.locator(".mark-card");
    await card.locator(".mark-entry-name").first().waitFor({ timeout: 5000 });
    expect((await page.locator(".mark-glow").count()) > 0, "the mark doesn't light up");
    expect((await card.locator(".mark-entry-summary").count()) > 0, "the card doesn't say which commit");
    // The row under the pointer doesn't show its preview over the card.
    await page.mouse.move(strip.x, strip.top + strip.marks[0] + 1);
    await page.waitForTimeout(900);
    expect((await page.locator(".commit-preview").count()) === 0, "a row's preview opened over the mark's card");
    await page.mouse.move(strip.x - 300, strip.top + 200);
    await card.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("says what a branch's label is in the row's hover card, not in a tooltip as well", async () => {
    const label = page.locator(".commit-row .ref-pill.branch").first();
    expect((await label.getAttribute("title")) === null, "a branch's label in the list still has a tooltip");
    const box = await label.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    const hint = page.locator(".commit-preview .preview-hint");
    await hint.waitFor({ timeout: 5000 });
    expect(/^(Checked out branch|Branch) /.test(await hint.textContent()), `the card says "${await hint.textContent()}"`);
    await page.mouse.move(box.x + box.width / 2, box.y + 400);
    await page.mouse.move(10, 10);
    await page.locator(".commit-preview").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("lights up a branch's lane while the pointer is on it", async () => {
    await page.locator(".sidebar-item", { hasText: /^themes/ }).first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
    // Its tip lights up beside the scrollbar too.
    expect((await page.locator(".mark-glow").count()) > 0, "the branch's mark doesn't light up");
    await page.locator(".commit-row .summary").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ state: "detached", timeout: 5000 });
    // And from its label in the graph.
    await page.locator(".commit-row .ref-pill.branch").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
    await page.locator(".commit-row .summary").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("outlines a commit you jump to for a moment, not one you click in the list", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.waitForTimeout(300);
    expect((await page.locator(".arrival").count()) === 0, "a commit clicked in the list was outlined");
    await page.locator(".sidebar-item", { hasText: /^themes/ }).first().click();
    await page.locator(".commit-row.selected .arrival").waitFor({ timeout: 5000 });
    await page.locator(".arrival").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows About Tributary, and what's new from it", async () => {
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "About Tributary" }).click();
    const whatsNew = page.locator(".about-link", { hasText: "What's New" });
    await whatsNew.waitFor({ timeout: 5000 });
    await accessible("About Tributary");
    await whatsNew.click();
    const dialog = page.locator(".whats-new-dialog");
    await dialog.waitFor({ timeout: 5000 });
    await accessible("What's New");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("changes how the window looks from the View panel, and closes it with Esc", async () => {
    const button = page.getByRole("button", { name: "View options" });
    await button.click();
    const panel = page.locator(".view-panel");
    await panel.waitFor({ timeout: 5000 });
    await accessible("the View panel");
    // Compact rows, straight away; then back.
    await panel.getByRole("button", { name: "Compact" }).click();
    await page.locator(".commit-list.dense").waitFor({ timeout: 5000 });
    await panel.getByRole("button", { name: "Roomy" }).click();
    await page.locator(".commit-list.dense").waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    expect(await button.evaluate((element) => element === document.activeElement), "the focus didn't go back to the View button");
  });

  await step("opens the View panel from the keyboard and the command palette", async () => {
    const panel = page.locator(".view-panel");
    // The shortcut opens it under the View button, and closes it again.
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ timeout: 5000 });
    const button = page.getByRole("button", { name: "View options" });
    const [at, under] = await Promise.all([panel.boundingBox(), button.boundingBox()]);
    expect(Math.abs(at.y - (under.y + under.height + 6)) < 2, `the panel is at ${at.y}, not under the button at ${under.y}`);
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    // With nothing focused (as on a Mac, where a click doesn't focus a button), the focus
    // goes to the View button when it closes, not back to the page.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    expect(await button.evaluate((element) => element === document.activeElement), "the focus didn't go to the View button");
    // View Options in the command palette, with its shortcut beside it.
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Commands" });
    await palette.locator("input").fill("view options");
    await palette.locator("li", { hasText: "View Options" }).filter({ hasText: "Ctrl+Shift+O" }).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await panel.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("opens a second repository in a new tab", async () => {
    // The pull requests' comments from the start: news is what changes after the first look.
    // And a failed check on every commit (the steps between change which is checked out),
    // which can be run again.
    const commitChecks = {
      site: "GitHub",
      canRerun: true,
      checks: [
        { name: "Build (Windows)", state: "success", url: "https://github.com/example/feast/actions/runs/31", detail: null, startedAt: null, finishedAt: null, workflow: "Checks", trigger: "on push to main" },
        { name: "Audio loudness", state: "failure", url: "https://github.com/example/feast/actions/runs/32", detail: "2 files too loud", startedAt: null, finishedAt: null, workflow: "Checks", trigger: "on push to main" },
      ],
    };
    await page.evaluate(
      ([pick, pullRequests, conversations, ciStates, commitChecks]) => Object.assign(window.__PREVIEW__, { pick, pullRequests, conversations, ciStates, commitChecks }),
      [demos.studio, STUDIO_PULL_REQUESTS, structuredClone(STUDIO_PULL_REQUEST_CONVERSATIONS), { "": "failure" }, commitChecks],
    );
    await page.getByRole("button", { name: "New tab" }).click();
    // The recent notebook shows where it stands: its branch and uncommitted changes.
    const notebook = page.locator(".recent li", { hasText: "notebook" }).first();
    await notebook.locator(".recent-chip.changes").waitFor({ timeout: 10_000 });
    await notebook.locator(".recent-branch", { hasText: "main" }).waitFor({ timeout: 5000 });
    await page.getByText("Open repository").first().click();
    await row("Add a tavern chair").waitFor({ timeout: 15_000 });
    expect((await page.locator(".tab").count()) >= 2, "only one tab");
  });

  await step("remembers the selection and the commit message in each tab", async () => {
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.getByPlaceholder("Commit summary").fill("Half-written message");
    await row("Export notes as Markdown").click();
    await page.waitForTimeout(600);
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".commit-row.selected", { hasText: "Export notes as Markdown" }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const kept = await page.getByPlaceholder("Commit summary").inputValue();
    expect(kept === "Half-written message", `message "${kept}"`);
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("says what arrived since you were last here, without moving the list", async () => {
    const tab = (name) => page.locator(".tab", { hasText: name });
    // Away from the studio, and as if its main had been 6 commits back then, two days ago.
    await tab(/^notebook$/).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    const git = (...args) => execFileSync("git", ["-C", demos.studio, ...args], { encoding: "utf8" }).trim();
    const was = git("rev-parse", "origin/main~6");
    // Your own commits (Maya Chen's, in the demos) aren't counted.
    const others = git("log", "--format=%ae", `${was}..origin/main`).split("\n").filter((email) => email && email !== "maya@example.com").length;
    await page.evaluate(([path, was]) => localStorage.setItem(`tributary.seen.${path}`, JSON.stringify({ at: Date.now() - 2 * 86_400_000, tips: { "origin/main": was } })), [demos.studio, was]);
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    const banner = page.locator(".since-banner");
    await banner.waitFor({ timeout: 10_000 });
    const said = (await banner.innerText()).replace(/\s+/g, " ").trim();
    expect(new RegExp(`^Since \\w+: ${others} new commits on main from \\w+`).test(said), `it said "${said}" (${others} new commits by others)`);
    // Nothing moved: the list is at its top, with the newest commits.
    expect((await page.locator(".list-scroller").evaluate((list) => list.scrollTop)) === 0, "the list was scrolled");
    await accessible("what arrived since you were last here");
    // The count goes to where you left off.
    await banner.getByRole("button", { name: `${others} new commits` }).click();
    await page.locator(`#commit-${was}.selected`).waitFor({ timeout: 10_000 });
    // Dismissed, it's gone, and coming back finds nothing new.
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await banner.waitFor({ state: "detached", timeout: 5000 });
    await tab(/^notebook$/).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    expect((await banner.count()) === 0, "it said what arrived again, with nothing new since");
  });

  await step("checks the spelling of commit messages, with the webview's menu for suggestions", async () => {
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const summary = page.getByPlaceholder("Commit summary");
    const description = page.getByLabel("Commit description");
    await summary.waitFor({ timeout: 5000 });
    for (const field of [summary, description]) {
      const checked = await field.evaluate((element) => element.spellcheck);
      expect(checked, `${await field.getAttribute("aria-label")} isn't spell-checked`);
    }
    // A right-click keeps the webview's own menu, with its suggestions, only in text fields.
    const prevented = (locator) =>
      locator.evaluate((element) => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(!(await prevented(description)), "the description's own menu was stopped");
    expect(!(await prevented(summary)), "the summary's own menu was stopped");
    expect(await prevented(page.locator("body")), "the webview's menu showed outside a text field");
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("puts a tab elsewhere by dragging it, or from the keyboard", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const order = async () => (await tabs.allTextContents()).map((name) => name.trim()).join(", ");
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("tributary.tabs.list")).map((tab) => tab.name).join(", "));
    const before = await order();
    // The last tab, dragged in steps past the first one's middle: it goes first, and stays.
    const last = tabs.last();
    const name = (await last.textContent()).trim();
    const from = await last.boundingBox();
    const to = await tabs.first().boundingBox();
    const y = from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + 8 - from.x - from.width / 2) * i) / 10, y);
    await page.mouse.up();
    await page.waitForFunction((first) => document.querySelector(".tabs > .tab[data-path]")?.textContent.trim() === first, name, { timeout: 5000 });
    expect((await stored()).startsWith(name), `the new order wasn't kept: ${await stored()}`);
    // Ctrl+Shift+Page Down moves it (now open) back one place.
    await page.keyboard.press("Control+Shift+PageDown");
    await page.waitForFunction((expected) => [...document.querySelectorAll(".tabs > .tab[data-path]")].map((tab) => tab.textContent.trim()).join(", ") === expected, before, { timeout: 5000 });
    // Escape halfway through a drag puts it back.
    const again = await tabs.last().boundingBox();
    await page.mouse.move(again.x + again.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(again.x + again.width / 2 - i * 25, y);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect((await order()) === before, `Escape didn't put it back: ${await order()}`);
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("reopens closed tabs in their places, from the keyboard or a tab's menu", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const tab = (name) => tabs.filter({ hasText: name });
    const order = async () => (await tabs.allTextContents()).map((name) => name.trim()).join(", ");
    const tabMenu = async (name, item) => {
      await tab(name).click({ button: "right" });
      await page.locator(".menu-item", { hasText: item }).click();
    };
    const before = await order();
    // A tab closed from its menu comes back with Ctrl+Shift+R, where it was, and open.
    await tabMenu(/^notebook$/, "Close tab");
    await tab(/^notebook$/).waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Control+Shift+R");
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    expect((await order()) === before, `reopened, the tabs are ${await order()}, not ${before}`);
    // The others, closed at once, come back one by one from a tab's menu, each in its place.
    await tabMenu("studio", "Close other tabs");
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    expect((await tabs.count()) === 1, `${await tabs.count()} tabs after closing the others`);
    for (let left = before.split(", ").length - 1; left > 0; left--) {
      await tabMenu("studio", "Reopen closed tab");
      await page.waitForFunction((count) => document.querySelectorAll(".tabs > .tab[data-path]").length === count, before.split(", ").length - left + 1, { timeout: 10_000 });
    }
    expect((await order()) === before, `reopened, the tabs are ${await order()}, not ${before}`);
    // Nothing left to reopen.
    await tab("studio").click({ button: "right" });
    expect(await page.locator(".menu-item", { hasText: "Reopen closed tab" }).isDisabled(), "Reopen closed tab with nothing to reopen");
    await page.keyboard.press("Escape");
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("sizes tabs to their names, with the close button on the open one and over the name's end on hover", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const notebook = tabs.filter({ hasText: /^notebook$/ });
    const close = notebook.locator(".tab-close");
    const opacity = (locator) => locator.evaluate((element) => getComputedStyle(element).opacity);
    // A tab is its name, the padding either side (26px) and a new commits dot if it has one
    // (11px), or 64px for a short name. Only the open one has room for its close button (26px):
    // with room for it in every tab, each was the name and about 50px.
    const widths = await tabs.evaluateAll((all) =>
      all.map((tab) => {
        const name = tab.querySelector(".tab-name > span");
        return { name: name.textContent, width: tab.getBoundingClientRect().width, text: name.scrollWidth, open: tab.classList.contains("active") };
      }),
    );
    for (const { name, width, text, open } of widths) expect(width <= Math.max(64, text + 38 + (open ? 26 : 0)), `${name}'s tab is ${width}px wide, for a name ${text}px wide`);
    await page.mouse.move(5, 400);
    // The open tab's close button shows, after its name.
    const open = page.locator(".tabs > .tab.active[data-path]");
    const openName = await open.locator(".tab-name").boundingBox();
    expect((await opacity(open.locator(".tab-close"))) === "1", "the open tab's close button doesn't show");
    expect((await open.locator(".tab-close").boundingBox()).x >= openName.x + openName.width, "the open tab's close button is over its name");
    expect((await opacity(close)) === "0", "the close button shows without the pointer on the tab");
    // On another tab: over the end of the name, which fades out under it.
    await notebook.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".tabs > .tab[data-path]:hover .tab-close")).opacity === "1", null, { timeout: 2000 });
    const x = await close.boundingBox();
    const tab = await notebook.boundingBox();
    const name = await notebook.locator(".tab-name").boundingBox();
    expect(x.x + x.width <= tab.x + tab.width && x.x < name.x + name.width, "the close button isn't over the end of the name");
    // Its X lines up with the middle of the name's small letters, in the screen's own pixels:
    // "no", where notebook starts, has nothing taller. (The pointer is still on the tab.)
    const scale = await page.evaluate(() => devicePixelRatio);
    const shot = decodePng(await page.screenshot());
    const screen = (box) => ({ x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.width * scale), h: Math.round(box.height * scale) });
    const area = screen(await notebook.boundingBox());
    const behind = shot.at(area.x + 4, area.y + area.h - 4);
    const inked = (from, width) => {
      const rows = [];
      for (let y = area.y; y < area.y + area.h; y++)
        for (let at = from; at < from + width; at++) {
          const pixel = shot.at(at, y);
          if (pixel.reduce((sum, value, index) => sum + Math.abs(value - behind[index]), 0) > 120) {
            rows.push(y);
            break;
          }
        }
      return (rows[0] + rows[rows.length - 1]) / 2;
    };
    const letters = inked(screen(await notebook.locator(".tab-name").boundingBox()).x, Math.round(12 * scale));
    const button = screen(await close.boundingBox());
    const cross = inked(button.x + 2, button.w - 4);
    expect(Math.abs(cross - letters) <= 1, `the X's middle is ${letters - cross} screen pixels above the letters'`);
    await close.click();
    await notebook.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Control+Shift+R");
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    // Only a name cut short fades out at the tab's end: none at full width (two tabs), and
    // notebook's in a window too narrow for both tabs (at 560px they just fit; at 440px the open
    // tab shrinks to 64px). On a timeout, each tab's measurements say why.
    const measured = () =>
      tabs.evaluateAll((all) =>
        all.map((tab) => {
          const name = tab.querySelector(".tab-name > span");
          return `${name.textContent}: tab ${tab.getBoundingClientRect().width}px, name ${name.scrollWidth}px in ${name.clientWidth}px${tab.hasAttribute("data-clipped") ? ", cut short" : ""}`;
        }),
      );
    const until = async (clipped, why, which = ".tabs > .tab[data-clipped]") => {
      for (let tries = 0; tries < 50; tries++) {
        if ((await page.locator(which).count()) > 0 === clipped) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`${why}: ${(await measured()).join("; ")}`);
    };
    await until(false, "a name is cut short at full width");
    const size = page.viewportSize();
    await page.setViewportSize({ width: 440, height: size.height });
    try {
      await until(true, "notebook's name isn't cut short in a narrow window", '.tabs > .tab.active[data-clipped]');
    } finally {
      await restoreSize(size);
    }
    await until(false, "a name is still cut short at full width again");
    await tabs.filter({ hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("shows who holds Git LFS locks", async () => {
    await page.locator(".sidebar-locked", { hasText: "Tavern" }).waitFor({ timeout: 15_000 });
    await accessible("the repository, with its locks");
  });

  await step("warns about big files that aren't in Git LFS", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".file-warning.large").waitFor({ timeout: 10_000 });
  });

  await step("warns about assets also changed on other branches", async () => {
    const warning = page.locator(".file-warning.elsewhere.assets");
    await warning.waitFor({ timeout: 15_000 });
    const text = await warning.innerText();
    expect(text.includes("Barber.uasset") && text.includes("art/barber-v2"), `warning "${text.slice(0, 90)}"`);
    await page.locator(".status-item.elsewhere").waitFor({ timeout: 5000 });
  });

  await step("lists the branches your files are also changed on, from the status bar", async () => {
    await page.locator(".status-item.elsewhere").click();
    const panel = page.getByRole("dialog", { name: "Also changed on other branches" });
    await panel.waitFor({ timeout: 5000 });
    const branch = panel.locator(".elsewhere-branch-entry", { hasText: "art/barber-v2" });
    const text = await branch.innerText();
    expect(text.includes("Barber.uasset") && text.includes("Rosa Bell"), `panel "${text.slice(0, 90)}"`);
    // The eye highlights that branch's history.
    await branch.getByRole("button", { name: "Highlight art/barber-v2" }).click();
    await page.locator(".view-banner", { hasText: "art/barber-v2" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.locator(".view-banner", { hasText: "art/barber-v2" }).waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows the team's activity, and highlights a branch from it", async () => {
    await page.locator(".menu-bar-item", { hasText: "View" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Team Activity" }).click();
    const view = page.locator(".team-view");
    await view.locator(".team-person-card", { hasText: "Rosa Bell" }).waitFor({ timeout: 10_000 });
    const barber = view.locator(".team-branch-card", { has: page.locator(".team-branch-card-name", { hasText: "art/barber-v2" }) });
    await barber.locator(".team-overlap", { hasText: "1 of your files" }).waitFor({ timeout: 5000 });
    await view.locator(".team-lock-card", { hasText: "Tavern.umap" }).waitFor({ timeout: 10_000 });
    await accessible("the team's activity");
    await barber.click();
    await view.waitFor({ state: "detached", timeout: 5000 });
    await page.locator(".view-banner", { hasText: "art/barber-v2" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.locator(".view-banner").waitFor({ state: "detached", timeout: 5000 });
    // The toolbar's button, the shortcut and the status bar open and close it too.
    await page.getByRole("button", { name: "Team activity", exact: true }).click();
    await view.waitFor({ timeout: 5000 });
    await page.keyboard.press("Control+Shift+T");
    await view.waitFor({ state: "detached", timeout: 5000 });
    await page.locator(".status-bar button", { hasText: "this week" }).click();
    await view.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("offers to release your locks after pushing", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.getByRole("button", { name: "Unstage all" }).click();
    // Wait for the lists to settle: Theme.wav moves above Barber.uasset.
    await page.locator(".files h3", { hasText: "Staged" }).locator(".hint", { hasText: "0 files" }).waitFor({ timeout: 10_000 });
    await page.locator(".file", { hasText: "Barber.uasset" }).hover();
    await page.getByRole("button", { name: "Stage Content/Characters/Barber.uasset" }).click();
    await page.getByPlaceholder("Commit summary").fill("Tweak the barber's apron");
    await page.locator(".commit-box .primary-small-button").click();
    await page.locator(".commit-row", { hasText: "Tweak the barber's apron" }).waitFor({ timeout: 10_000 });
    await dismissToast();
    await page.locator(".tool-button", { hasText: "Push" }).first().click();
    const banner = page.locator(".notice-banner.info");
    await banner.waitFor({ timeout: 15_000 });
    const text = await banner.innerText();
    expect(text.includes("Barber.uasset"), `banner "${text}"`);
    await banner.getByRole("button", { name: "Release lock" }).click();
    await page.locator(".sidebar-locked", { hasText: "Barber" }).waitFor({ state: "detached", timeout: 15_000 });
    await dismissToast();
  });

  await step("shows an image before and after", async () => {
    await row("Shinier coins for the tip jar").click();
    await page.locator(".details .file", { hasText: "Coin.png" }).click();
    await page.locator(".diff-image img").nth(1).waitFor({ timeout: 10_000 });
    const sizes = await page.locator(".diff-binary-sizes").innerText();
    expect(/→/.test(sizes), `sizes "${sizes}"`);
    await page.keyboard.press("Escape");
  });

  await step("shows Photoshop and Targa textures, and the pixels that changed", async () => {
    await row("Sign: paint a mug of ale next to the mark").click();
    await page.locator(".details .file", { hasText: "TavernSign.psd" }).click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-image img").nth(1).waitFor({ timeout: 10_000 });
    await view.locator(".diff-media-facts", { hasText: "256 × 256" }).first().waitFor({ timeout: 10_000 });
    await view.locator(".diff-image-modes button", { hasText: "Changed pixels" }).click();
    const summary = view.locator(".diff-pixels-summary", { hasText: "pixels changed" });
    await summary.waitFor({ timeout: 10_000 });
    expect((await summary.innerText()).includes("in a 73 × 83 area"), await summary.innerText());
    await view.locator(".diff-image-modes button", { hasText: "Side by side" }).click();
    await page.keyboard.press("Escape");
  });

  await step("names Unreal actors saved in their own files", async () => {
    await row("Move the fireplace to the back wall").click();
    const names = page.locator(".details .file .file-name.actor");
    await names.first().waitFor({ timeout: 10_000 });
    const listed = await names.allInnerTexts();
    expect(["SM_Bench_Old", "SM_Bench_Long", "PointLight_Hearth", "BP_Fireplace"].every((name) => listed.includes(name)), listed.join(", "));
  });

  await step("shows a commit's files in a tree of their folders, and closes one", async () => {
    // The fireplace commit, from the step before: actors in the level's folders, the folders
    // with nothing else in them joined into one row, with what changed inside it.
    const files = page.locator(".details .files");
    await files.getByRole("button", { name: "Tree", exact: true }).click();
    const top = files.locator(".file-folder-toggle").first();
    await top.waitFor({ timeout: 5000 });
    const said = await top.evaluate((button) => `${button.querySelector(".file-folder-name").textContent}: ${document.getElementById(button.getAttribute("aria-describedby")).textContent}`);
    expect(/^Content\/__ExternalActors__\/Maps\/Tavern: .*\d+ changed/.test(said), `said "${said}"`);
    const open = await files.locator(".file").count();
    expect(open > 2, `${open} rows`);
    await files.locator(".file-name.actor", { hasText: "SM_Bench_Long" }).waitFor({ timeout: 5000 });
    await accessible("a commit's files as a tree");
    await top.click();
    expect((await top.getAttribute("aria-expanded")) === "false" && (await files.locator(".file").count()) === 1, "closed");
    await top.click();
    expect((await files.locator(".file").count()) === open, "open again");
    // Back to the list, which the steps after expect (the choice is remembered).
    await files.getByRole("button", { name: "List", exact: true }).click();
    await top.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows a sound, a video, a Blender file's preview and a 3D model as what they are", async () => {
    await row("A slower door with a longer creak").click();
    await page.locator(".details .file", { hasText: "DoorCreak.wav" }).click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-waveform").nth(1).waitFor({ timeout: 10_000 });
    await view.locator(".diff-media-facts", { hasText: "0:01.6" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("]");
    await view.locator(".diff-media-facts", { hasText: "0:03.0 · 320×180" }).waitFor({ timeout: 10_000 });
    // The preview Blender saved in the file, before and after, and who owns it (CODEOWNERS).
    await page.keyboard.press("]");
    await view.locator("img").nth(1).waitFor({ timeout: 10_000 });
    await view.locator(".diff-owners", { hasText: "@theo and @rosa" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("]");
    const facts = view.locator(".diff-model-facts");
    await facts.waitFor({ timeout: 20_000 });
    const text = (await facts.innerText()).replace(/\s+/g, " ");
    expect(text.includes("Vertices 120 192"), `facts "${text}"`);
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("lists every file of a huge commit, and filters them", async () => {
    await row("Import the generated level instances").click();
    const files = page.locator(".details .files");
    await files.locator(".details-section-head", { hasText: "Changed files" }).filter({ hasText: "2,400" }).waitFor({ timeout: 10_000 });
    // Only the rows on screen are drawn, but the last file is there to scroll to.
    const drawn = await files.locator(".file").count();
    expect(drawn < 400, `${drawn} rows drawn`);
    await page.locator(".details-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await files.locator(".file", { hasText: "Instance_0599.json" }).last().waitFor({ timeout: 5000 });
    // Narrow it down.
    await page.getByLabel("Filter files by name or folder").fill("level03 instance_01");
    await files.locator(".file-filter-count", { hasText: "100 of 2,400" }).waitFor({ timeout: 5000 });
    expect((await files.locator(".file").count()) === 100, "filtered rows");
    await page.getByLabel("Filter files by name or folder").press("Escape");
    await files.locator(".file-filter-count").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("chooses a diff tool from a file it can't show line by line", async () => {
    await row("Rig the barber").click();
    await page.locator(".details .file", { hasText: "Barber.uasset" }).click();
    const message = page.locator(".diff-message");
    await message.getByRole("button", { name: "Choose a diff tool…" }).click();
    const settings = page.locator(".dialog", { hasText: "Diff and merge" });
    await settings.getByLabel("Diff tool").selectOption("vscode");
    await page.locator(".toast", { hasText: "Diffs open in Visual Studio Code" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await message.getByRole("button", { name: "Open in Visual Studio Code" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await dismissToast();
  });

  await step("shows pull requests on their branches", async () => {
    await page.locator(".pr-badge").first().waitFor({ timeout: 10_000 });
    // On the commit list's labels, the icon for the checks alone (a cross for #14's failed
    // ones), with the number in the badge's name for screen readers. The sidebar has both.
    const label = page.locator(".commit-list .pr-badge.failure", { hasText: "#14" }).first();
    expect(await label.locator(".pr-check-icon").isVisible(), "no icon for the failed checks");
    expect(!(await label.locator(".pr-number").isVisible()), "the number shows on the label");
    expect((await label.getAttribute("aria-label")).includes("#14"), `the badge's name is ${await label.getAttribute("aria-label")}`);
    expect(await page.locator(".sidebar-item .pr-badge.failure .pr-number", { hasText: "#14" }).first().isVisible(), "no number in the sidebar");
  });

  await step("keeps the words in the middle of badges and buttons at 150% and 200% too", async () => {
    // The checks so far are at 100%. At other scales letters round differently: their baseline
    // goes on a whole CSS pixel and a control's edges on the nearest screen pixel, so a control
    // starting half a pixel down had its words a screen pixel low (the sidebar's pull request
    // badges, and the toolbar's buttons and branch). In a page of its own at each scale, in
    // Chromium: WebKit's rounding hasn't been looked at at these scales.
    if (browserName !== "chromium") return;
    for (const scale of [1.5, 2]) {
      const scaled = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: scale, userAgent });
      try {
        await scaled.addInitScript(([pick, pullRequests]) => {
          window.__PREVIEW__ = { pick, pullRequests };
          localStorage.setItem("tributary.fetch.auto", "false");
          localStorage.setItem("tributary.whatsNew.seen", JSON.stringify("999.0.0"));
          localStorage.setItem("tributary.tours.off", "true");
        }, [demos.studio, STUDIO_PULL_REQUESTS]);
        await scaled.goto(preview.url);
        await scaled.getByText("Open repository").first().click();
        await scaled.locator(".sidebar-item .pr-badge").first().waitFor({ timeout: 15_000 });
        await scaled.evaluate(() => document.fonts.ready);
        await scaled.waitForFunction(`(${moving})() === 0`, null, { timeout: 3000 }).catch(() => {});
        const measured = await scaled.evaluate(`(${probe})(${JSON.stringify(CONTROLS)}, ${JSON.stringify(EXCEPT)})`);
        expect(measured.some((control) => control.classes === "pr-badge"), "no pull request badge measured");
        const shot = await scaled.screenshot();
        const found = describeOffCentre(offInPixels(shot, measured, { tolerance: 1 }));
        expect(found.length === 0, `at ${scale * 100}%: ${found.slice(0, 6).join("; ")}`);
      } finally {
        await scaled.close();
      }
    }
  });

  await step("shows pull requests' numbers on their labels when asked", async () => {
    const number = page.locator(".commit-list .pr-badge.failure", { hasText: "#14" }).first().locator(".pr-number");
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.locator(".settings-nav").getByText("Commit list").click();
    const toggle = settings.getByRole("switch", { name: "Pull request numbers" });
    await toggle.click();
    await number.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();
    await number.waitFor({ state: "hidden", timeout: 5000 });
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("colours checks as you pick, and as the theme does again", async () => {
    // A pull request whose checks failed, in the failed checks' colour: the theme's, yours, then the theme's.
    const badge = page.locator(".commit-list .pr-badge.failure").first();
    const fill = () => badge.evaluate((element) => getComputedStyle(element).backgroundColor);
    const theirs = await fill();
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.locator(".settings-nav").getByText("Appearance").click();
    await settings.getByLabel("Failed checks' colour").fill("#cc00ff");
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--check-failure") === "#cc00ff", null, { timeout: 5000 });
    expect((await fill()) === "rgb(204, 0, 255)", `the badge is ${await fill()}, not the colour picked`);
    await settings.locator(".check-colors").scrollIntoViewIfNeeded();
    await accessible("the checks' colours in Settings");
    await settings.getByRole("button", { name: "The theme's", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--check-failure") === "", null, { timeout: 5000 });
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
    expect((await fill()) === theirs, `the badge is ${await fill()}, not the theme's ${theirs}`);
  });

  await step("shows a commit's failed check, and runs it again", async () => {
    // The checked-out commit (every commit has the checks above).
    await page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first().click();
    const checks = page.locator(".details .commit-checks");
    await checks.getByText("Audio loudness").first().waitFor({ timeout: 10_000 });
    await accessible("a commit's checks, one failed");
    await checks.getByRole("button", { name: "Re-run failed" }).click();
    await page.locator(".toast", { hasText: "Running the failed jobs again" }).waitFor({ timeout: 5000 });
    await dismissToast();
  });

  await step("says why a check failed, and runs its job again", async () => {
    // The failed check's row says Why?, and opens a window with its job's steps, the failed
    // one marked, and the end of its log, scrolled to its end, the errors marked.
    const row = page.locator(".details .commit-check.failure .commit-check-row");
    await row.locator(".check-why-chip", { hasText: "Why?" }).waitFor({ timeout: 5000 });
    await row.click();
    const why = page.locator(".dialog.check-why");
    await why.getByRole("heading", { name: "Audio loudness failed" }).waitFor({ timeout: 5000 });
    await why.locator(".check-why-line.error", { hasText: "2 files are louder than -14 LUFS" }).waitFor({ timeout: 5000 });
    await why.locator(".check-why-said", { hasText: /^Checks, on push to main · at step 4 of 5$/ }).waitFor({ timeout: 5000 });
    expect((await why.locator(".check-why-steps li.failed-here").textContent()) === "Check loudness", "the failed step isn't the one marked");
    const log = why.locator(".check-why-log");
    expect(await log.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1), "the log doesn't start at its end");
    expect((await page.evaluate(() => window.__PREVIEW__.askedLogs)).at(-1).endsWith("/actions/runs/32"), "it didn't ask for the check's log");
    await accessible("why a check failed");
    await why.getByRole("button", { name: "Re-run job" }).click();
    await page.locator(".toast", { hasText: "Running the job again: Audio loudness" }).waitFor({ timeout: 5000 });
    await why.waitFor({ state: "detached", timeout: 5000 });
    expect((await page.evaluate(() => window.__PREVIEW__.reranJobs)).at(-1).endsWith("/actions/runs/32"), "it didn't run the check's job again");
    await dismissToast();
  });

  await step("shows a commit's checks as a graph of each run, and opens a job's page", async () => {
    await page.evaluate((runs) => Object.assign(window.__PREVIEW__, { commitRuns: runs }), studioCommitRuns());
    const current = page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first();
    await page.locator(".details .commit-checks").getByRole("button", { name: "Open" }).click();
    const view = page.locator(".checks-view");
    const build = view.locator(".run-card", { hasText: "Build" }).first();
    // The platforms in one box, the one still running at its step, and the jobs still waiting.
    await build.locator(".run-group", { hasText: "3 jobs" }).waitFor({ timeout: 10_000 });
    await build.locator(".run-job.running .run-step-name", { hasText: "Cook the tavern level" }).waitFor({ timeout: 5000 });
    expect((await build.locator(".run-card-job.waiting").count()) === 2, "the jobs still waiting aren't shown");
    // A line from each group to each that waits for it, left to right: Version and Lint to
    // Build, Build to Package, Package to Upload.
    await page.waitForFunction(() => document.querySelector(".checks-view .run-card")?.querySelectorAll(".run-edge path").length === 4, null, { timeout: 5000 });
    const ends = await build.locator(".run-edge path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d").match(/^M([\d.]+) [\d.]+ C.* ([\d.]+) [\d.]+$/)));
    expect(ends.every((found) => found && Number(found[1]) < Number(found[2])), `a line doesn't go left to right: ${JSON.stringify(ends)}`);
    // Wider than the view beside the panels: the graph scrolls rather than squeezing, with an
    // arrow on the side there's more of.
    const graph = build.locator(".run-graph-scroll");
    expect(await graph.evaluate((element) => element.scrollWidth > element.clientWidth), "the Build graph was squeezed to fit");
    await build.locator(".run-graph-more.right").click();
    await build.locator(".run-graph-more.left").waitFor({ timeout: 5000 });
    expect(await graph.evaluate((element) => element.scrollLeft > 0), "the arrow didn't scroll the graph");
    await view.locator(".checks-count.failure", { hasText: "1 failed" }).waitFor({ timeout: 5000 });
    await accessible("a commit's checks as graphs");
    // A failed job says why, with its page a click away; a job that passed opens its page.
    await view.locator(".run-card-job", { hasText: "Audio loudness" }).click();
    const why = page.locator(".dialog.check-why");
    await why.locator(".check-why-said", { hasText: /^Asset checks, on push to main · after 2m 0s · at step 4 of 5$/ }).waitFor({ timeout: 5000 });
    await why.getByRole("button", { name: "Open on GitHub" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/42/job/7")), "the job's page didn't open");
    await page.keyboard.press("Escape");
    await why.waitFor({ state: "detached", timeout: 5000 });
    expect(await view.isVisible(), "Esc closed the checks under the window too");
    await view.locator(".run-card-job", { hasText: "Texture sizes" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/42/job/6")), "a job's page didn't open");
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // The commit's menu opens them too.
    await current.click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Show checks" }).click();
    await view.locator(".run-card", { hasText: "Asset checks" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // And its CI dot in the list, which selects the commit too: here, one further down.
    const older = page.locator(".commit-row", { has: page.locator(".graph-ci") }).nth(3);
    await older.locator(".graph-ci").click();
    await view.locator(".run-card", { hasText: "Asset checks" }).waitFor({ timeout: 10_000 });
    expect(await older.evaluate((row) => row.classList.contains("selected")), "clicking the dot didn't select its commit");
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    await current.click();
  });

  await step("shows a pull request's reviews and checks", async () => {
    await page.evaluate((details) => Object.assign(window.__PREVIEW__, { pullRequestDetails: details }), STUDIO_PULL_REQUEST_DETAILS);
    // Pressing the badge opens the pull request, and leaves the selected commit as it was: a
    // press that selected the badge's row could scroll it, and the click would miss the badge.
    const selected = () => page.evaluate(() => document.querySelector(".commit-row.selected")?.id ?? "");
    const before = await selected();
    await page.locator(".pr-badge", { hasText: "#14" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-merge", { hasText: "changes were asked for" }).waitFor({ timeout: 10_000 });
    await view.locator(".request-check.failure", { hasText: "Audio loudness" }).waitFor({ timeout: 5000 });
    await view.locator(".request-status-said", { hasText: "diego-ramos asked for changes" }).waitFor({ timeout: 5000 });
    // How they went is said beside the river: what failed first, then the rest of the counts.
    await view.locator(".tributaries-title", { hasText: /^Audio loudness failed$/ }).waitFor({ timeout: 5000 });
    await view.locator(".tributaries-line", { hasText: /^1 of 6 checks failed, 2 still running, 1 skipped$/ }).waitFor({ timeout: 5000 });
    expect((await view.locator(".request-status .site-checks").count()) === 0, "the pull request's checks say how they went above the river as well as beside it");
    // In the smallest window, with the details open, the river's streams don't run under its
    // verdict (it goes under them when there's no room beside them), and the checks under it
    // keep their names.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 900, height: size.height });
    try {
      await page.waitForFunction(() => {
        const streams = document.querySelector(".request-view .tributaries-streams")?.getBoundingClientRect();
        const verdict = document.querySelector(".request-view .tributaries-verdict")?.getBoundingClientRect();
        const name = document.querySelector(".request-view .request-timeline-row .request-check-name")?.getBoundingClientRect();
        return streams && verdict && name && (verdict.top >= streams.bottom || verdict.left >= streams.right) && name.width > 40;
      }, null, { timeout: 5000 });
    } finally {
      await restoreSize(size);
    }
    // The description and comments are Markdown, shown as such.
    await view.locator(".request-comment-text").first().waitFor({ timeout: 5000 });
    await accessible("a pull request");
    // A failed check's name says why it failed, with its page a click away.
    await view.locator(".request-check", { hasText: "Audio loudness" }).getByRole("button").click();
    const why = page.locator(".dialog.check-why");
    await why.getByRole("button", { name: "Open on GitHub" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/actions/runs/7")), "the check's page didn't open");
    await page.keyboard.press("Escape");
    await why.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    expect((await selected()) === before, `pressing the badge selected ${await selected()}, not ${before}`);
  });

  await step("shows an open pull request from its branch's commit", async () => {
    // The commit at the tip of fix/door: its pull request, saying where it stands as its view
    // does, with its title, who opened it and Show, under a heading with the site's chip, and
    // its checks under it, built the same way.
    await page.locator(".commit-row", { has: page.locator(".pr-badge", { hasText: "#14" }) }).first().click();
    const card = page.locator(".details .commit-request", { hasText: "#14" });
    await card.locator(".commit-request-standing", { hasText: "Can't be merged yet: changes were asked for" }).waitFor({ timeout: 5000 });
    expect(await card.evaluate((item) => item.classList.contains("bad")), "a pull request that can't be merged isn't shown in red");
    await card.locator(".commit-request-name", { hasText: "Make the door creak · theo-park" }).waitFor({ timeout: 5000 });
    await page.locator(".details .commit-requests h3", { hasText: "Pull request" }).waitFor({ timeout: 5000 });
    await page.locator(".details .commit-requests .site-chip", { hasText: "GitHub" }).waitFor({ timeout: 5000 });
    // Its checks, built the same way, with a pip for each.
    const headline = page.locator(".details .commit-checks-headline");
    await headline.filter({ hasText: /^\d+ of \d+ checks failed$/ }).waitFor({ timeout: 5000 });
    const total = Number((await headline.textContent()).match(/of (\d+)/)[1]);
    expect((await page.locator(".details .check-pips > span").count()) === total, `not a pip for each of the ${total} checks`);
    expect((await page.locator(".details .mentioned-issue", { hasText: "#14" }).count()) === 0, "the pull request is listed with the issues too");
    // With no label under the pointer, no lane is lit: the graph's nodes are at full strength.
    await page.waitForFunction(() => !document.querySelector(".commit-list.lane-lit"), null, { timeout: 2000 }).catch(async () => {
      const under = await page.evaluate(() => [...document.querySelectorAll(":hover")].map((element) => element.className).filter(Boolean).slice(-2).join(" > "));
      throw new Error(`a lane is lit with the pointer on ${under}`);
    });
    await accessible("an open pull request in a commit's details");
    await card.getByRole("button", { name: "Show" }).click();
    const view = page.locator(".request-view");
    await view.locator(".request-merge", { hasText: "changes were asked for" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("comments on, approves and merges a pull request", async () => {
    await page.locator(".pr-badge", { hasText: "#12" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-comment", { hasText: "the build script reads it" }).waitFor({ timeout: 10_000 });
    await view.locator(".request-reply").first().click();
    await view.locator(".comment-box textarea").first().fill("Thanks!");
    await view.locator(".comment-box button", { hasText: "Reply" }).click();
    await view.locator(".request-comment.reply", { hasText: "Thanks!" }).waitFor({ timeout: 5000 });
    // The reply is done once it says so.
    await page.locator(".toast", { hasText: "Replied" }).waitFor({ timeout: 5000 });
    await view.locator(".request-toolbar").getByRole("button", { name: "Review", exact: true }).click();
    await view.locator(".review-box button", { hasText: "Approve" }).click();
    await page.locator(".toast", { hasText: "Approved #12" }).waitFor({ timeout: 5000 });
    await view.locator(".request-status button", { hasText: "Merge…" }).click();
    await page.locator(".dialog button.primary-button", { hasText: "Squash and merge" }).click();
    await page.locator(".toast", { hasText: "Merged #12" }).waitFor({ timeout: 5000 });
    const merged = await page.evaluate(() => window.__PREVIEW__.merged);
    expect(merged?.method === "squash" && merged.deleteBranch, JSON.stringify(merged));
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("opens a pull request from a branch's menu", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.studio, ...args], { encoding: "utf8" }).trim();
    // On a commit with no other labels, so its label shows (not folded into "+N").
    git("branch", "smoke/lights", git("log", "-1", "--format=%H", "--grep=Seat guests by the fire", "--all"));
    git("push", "-q", "origin", "smoke/lights");
    await page.evaluate(() => Object.assign(window.__PREVIEW__, { newRequest: { commits: [{ summary: "Warmer lights in the tavern", body: "Candles flicker now." }] } }));
    await page.keyboard.press("F5");
    await page.locator(".ref-pill", { hasText: "smoke/lights" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Create pull request…" }).click();
    const dialog = page.locator(".request-dialog");
    const title = dialog.getByLabel("Title");
    await title.waitFor({ timeout: 10_000 });
    expect((await title.inputValue()) === "Warmer lights in the tavern", "the title wasn't suggested from the commit");
    await dialog.getByLabel("Draft: not ready for review yet").check();
    await dialog.getByRole("button", { name: "Open pull request" }).click();
    await page.locator(".toast", { hasText: "Opened pull request #15" }).waitFor({ timeout: 10_000 });
    const created = await page.evaluate(() => window.__PREVIEW__.created);
    expect(created.branch === "smoke/lights" && created.base === "main" && created.draft && created.body === "Candles flicker now.", JSON.stringify(created));
    await page.locator(".pr-badge", { hasText: "#15" }).first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Show" }).click();
    await page.locator(".request-view", { hasText: "Warmer lights in the tavern" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    // As it was, for the steps after this one.
    git("branch", "-D", "smoke/lights");
    git("push", "-q", "origin", "--delete", "smoke/lights");
    await page.evaluate((list) => Object.assign(window.__PREVIEW__, { pullRequests: list }), STUDIO_PULL_REQUESTS);
    await page.keyboard.press("F5");
    await dismissToast();
  });

  if (demos.assets) {
    await step("clones a repository without its Git LFS files", async () => {
      await page.evaluate((pick) => Object.assign(window.__PREVIEW__, { pick }), folder);
      await page.getByRole("button", { name: "New tab" }).click();
      await page.getByRole("button", { name: "Clone…" }).click();
      await page.getByPlaceholder(/github\.com/).fill(demos.assets);
      await page.getByRole("button", { name: "Choose…" }).click();
      await page.getByRole("button", { name: /Options for big repositories/ }).click();
      await page.getByLabel("Download Git LFS files later").check();
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await row("Add the main theme").waitFor({ timeout: 20_000 });
      const banner = page.locator(".notice-banner");
      await banner.waitFor({ timeout: 10_000 });
      const text = await banner.innerText();
      expect(/3 files stored with Git LFS haven't been downloaded/.test(text), `banner "${text}"`);
    });

    await step("downloads the Git LFS files", async () => {
      await page.getByRole("button", { name: "Download them" }).click();
      const text = await toast();
      expect(text.includes("Downloaded 3 files"), `toast "${text}"`);
      await page.locator(".notice-banner").waitFor({ state: "detached", timeout: 10_000 });
      await dismissToast();
    });

    await step("chooses which folders' Git LFS files to download", async () => {
      await page.getByRole("button", { name: "Repository settings" }).click();
      const dialog = page.locator(".dialog", { hasText: "Settings for" });
      await dialog.getByRole("tab", { name: "Git LFS" }).click();
      await dialog.getByLabel("Download Git LFS files").selectOption("only");
      await dialog.getByRole("button", { name: /^Add Concept/ }).click();
      await page.locator(".toast", { hasText: "Git LFS files are downloaded only from Concept" }).waitFor({ timeout: 10_000 });
      await dialog.locator(".name-chip", { hasText: "Concept" }).waitFor({ timeout: 10_000 });
      await dismissToast();
      await dialog.getByLabel("Download Git LFS files").selectOption("all");
      await page.locator(".toast", { hasText: "from every folder again" }).waitFor({ timeout: 10_000 });
      await dismissToast();
      await dialog.getByRole("button", { name: "Done" }).click();
      await dialog.waitFor({ state: "detached", timeout: 5000 });
    });
  }

  await step("opens a branch in a new worktree", async () => {
    await page.locator(".tab", { hasText: "notebook" }).first().dispatchEvent("mousedown", { button: 0 });
    await page.locator(".head-chip", { hasText: "main" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Open in a new worktree" }).click();
    await page.getByRole("button", { name: "Create worktree" }).click();
    await page.locator(".head-chip", { hasText: "feature/themes" }).waitFor({ timeout: 15_000 });
    await page.locator(".tab.active", { hasText: "notebook-feature-themes" }).waitFor({ timeout: 5000 });
    // The sidebar reads the worktrees after the tab opens: counted once they're there, as
    // counting straight away found none now and then.
    await page.waitForFunction(() => document.querySelectorAll(".sidebar-worktree").length === 2, null, { timeout: 10_000 }).catch(() => {});
    const entries = await page.locator(".sidebar-worktree").count();
    expect(entries === 2, `${entries} worktrees in the sidebar`);
    await dismissToast();
  });

  await step("lists the keyboard shortcuts in groups, finds one, and fits a short window", async () => {
    const size = page.viewportSize();
    // Shorter than the list: it used to run past the window's top and bottom.
    await page.setViewportSize({ width: 1100, height: 560 });
    try {
      await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
      await page.locator(".menu-item", { hasText: "Keyboard Shortcuts" }).click();
      const dialog = page.locator(".shortcuts-window");
      const rows = dialog.locator(".shortcut-row");
      await rows.filter({ hasText: "Cherry-pick it onto that branch" }).waitFor({ timeout: 5000 });
      const box = await dialog.boundingBox();
      expect(box.y >= 0 && box.y + box.height <= 560, `the window runs from ${box.y} to ${box.y + box.height}, past the 560px window`);
      expect(await dialog.locator(".shortcuts-body").evaluate((element) => element.scrollHeight > element.clientHeight), "the list doesn't scroll inside the window");
      // Each key a keycap of its own: Ctrl and K apart.
      expect((await rows.filter({ hasText: "Command palette" }).locator("kbd").count()) === 2, "the palette's keys aren't two keycaps");
      await accessible("the keyboard shortcuts");
      // Typing finds them in every group: the search box has the keyboard from the start.
      await page.keyboard.type("cherry");
      await page.waitForFunction(() => document.querySelectorAll(".shortcuts-window .shortcut-row").length === 1, null, { timeout: 5000 });
      expect((await rows.first().textContent()).includes("Cherry-pick"), "searching for cherry didn't find the cherry-pick");
      await dialog.locator(".shortcuts-find").fill("");
      // A group on its own, then all again.
      await dialog.locator(".shortcuts-nav button", { hasText: "Tabs" }).click();
      await page.waitForFunction(() => [...document.querySelectorAll(".shortcuts-window .shortcuts-group h3")].map((h) => h.textContent).join() === "Tabs", null, { timeout: 5000 });
      await dialog.locator(".shortcuts-nav button", { hasText: "All" }).click();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 5000 });
    } finally {
      await restoreSize(size);
    }
  });

  await step("works the menus from the keyboard", async () => {
    await page.locator("body").press("F10");
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    await page.locator(".context-menu").waitFor();
    const first = await focused();
    await page.keyboard.press("ArrowDown");
    const second = await focused();
    await page.keyboard.press("ArrowRight");
    const nextMenu = await focused();
    await accessible("a menu");
    await page.keyboard.press("Escape");
    await page.locator(".context-menu").waitFor({ state: "detached" });
    expect(first && second && first !== second && nextMenu !== second, `focus went ${first} → ${second} → ${nextMenu}`);
  });

  await step("fits the smallest window: the sidebar as a strip, every window a command opens, Settings, About, the View panel and a long menu", async () => {
    // 900 by 560, the smallest the window can be (tauri.conf.json), with the sidebar and the
    // details open: no window inside it runs past its edges out of reach, and no words sit on
    // other words or are cut off without an ellipsis (fits.mjs).
    const size = page.viewportSize();
    await page.setViewportSize({ width: 900, height: 560 });
    const fits = async (where) => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
      const found = await page.evaluate(`(${crowded})()`);
      expect(found.length === 0, `${where}, in the smallest window: ${found.slice(0, 4).join("; ")}`);
    };
    const open = ".dialog-backdrop, .context-menu, .view-panel";
    const closeAll = async () => {
      for (let tries = 0; tries < 4 && (await page.locator(open).count()) > 0; tries++) await page.keyboard.press("Escape");
      await page.locator(open).first().waitFor({ state: "detached", timeout: 5000 });
    };
    const palette = page.getByRole("dialog", { name: "Commands" });
    const command = async (label) => {
      await page.keyboard.press("Control+k");
      await palette.locator("input").fill(label);
      const first = palette.locator("li").first();
      await first.waitFor({ timeout: 5000 });
      // One this repository doesn't offer just now is left out.
      if (!((await first.textContent()) ?? "").startsWith(label)) {
        await page.keyboard.press("Escape");
        return false;
      }
      await page.keyboard.press("Enter");
      await palette.waitFor({ state: "detached", timeout: 5000 });
      await page.waitForTimeout(300);
      return true;
    };
    try {
      await closeAll();
      await fits("the repository");
      // The sidebar is a strip of icons beside the list. One opens it over the list, at its
      // section; Esc closes it, with the focus back on the icon.
      await page.locator(".sidebar-strip").waitFor({ timeout: 5000 });
      expect((await page.locator(".sidebar-frame").count()) === 0, "the sidebar takes its full width in the smallest window");
      const tagsIcon = page.locator(".sidebar-strip-button[data-section=tags]");
      await tagsIcon.click();
      const over = page.locator(".sidebar-over");
      await over.locator('[data-tour="section-tags"] .sidebar-heading[aria-expanded="true"]').waitFor({ timeout: 5000 });
      await fits("the sidebar over the list");
      await accessible("the sidebar's strip, open at Tags");
      // A tag's lane lights up from its label there too, and goes out with the sidebar when
      // Esc closes it under the pointer.
      await over.locator('[data-tour="section-tags"] .sidebar-item').first().hover();
      await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await over.waitFor({ state: "detached", timeout: 5000 });
      await page.waitForFunction(() => !document.querySelector(".commit-list.lane-lit"), null, { timeout: 2000 }).catch(() => {
        throw new Error("a tag's lane stayed lit after its label went with the sidebar");
      });
      expect(await tagsIcon.evaluate((element) => element === document.activeElement), "the focus didn't go back to the strip's Tags icon");
      for (const label of ["Go to Commit", "New Branch", "New Tag", "New Worktree", "Stash Changes", "Prune Branches", "Restore Branch", "Recover Commits", "Repository Settings", "Shelves", "Local History", "What Makes It Big", "Check Project Setup", "Clean Up Git LFS Files", "Force Push", "Clone Repository", "Tours", "Third-Party Licences", "Why Is a File Ignored", "Keyboard Shortcuts"]) {
        if (!(await command(label))) continue;
        await fits(label);
        await closeAll();
      }
      // Settings, section by section.
      await page.keyboard.press("Control+,");
      const sections = page.locator(".settings-nav [role=tab]");
      await sections.first().waitFor({ timeout: 5000 });
      for (let index = 0; index < (await sections.count()); index++) {
        await sections.nth(index).click();
        await fits(`Settings → ${((await sections.nth(index).textContent()) ?? "").trim()}`);
      }
      await closeAll();
      // About is taller than the window: it scrolls, from its top down to its buttons.
      expect(await command("About Tributary"), "About Tributary isn't in the command palette");
      await fits("About");
      const about = page.locator(".about-window");
      const backdrop = page.locator(".dialog-backdrop");
      await backdrop.evaluate((element) => element.scrollTo(0, 0));
      expect((await about.boundingBox()).y >= 0, "About's top is out of reach");
      await backdrop.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      const buttons = await about.locator(".dialog-buttons").boundingBox();
      expect(buttons.y + buttons.height <= 560, "About's buttons are out of reach");
      await closeAll();
      // The View panel ends inside the window, and scrolls to the rest.
      await page.keyboard.press("Control+Shift+O");
      const panel = page.locator(".view-panel");
      await panel.waitFor({ timeout: 5000 });
      await fits("the View panel");
      expect(await panel.evaluate((element) => element.scrollHeight > element.clientHeight), "the View panel doesn't scroll in the smallest window");
      await closeAll();
      // The menu bar's View menu, taller than the window: its last item is in reach.
      await page.locator("body").press("F10");
      await page.locator(".context-menu").waitFor({ timeout: 5000 });
      await page.keyboard.press("ArrowRight");
      await fits("the View menu");
      await page.keyboard.press("End");
      const last = await page.evaluate(() => document.activeElement?.getBoundingClientRect().bottom ?? 0);
      expect(last > 0 && last <= 560, `the View menu's last item ends ${Math.round(last)}px down, below the window`);
      await closeAll();
    } finally {
      await restoreSize(size);
    }
  });

  await step("signs in to GitHub with a token", async () => {
    await page.evaluate(() => (window.__PREVIEW__.github = { account: null }));
    await page.keyboard.press("Control+Comma");
    await page.getByRole("tab", { name: "Accounts" }).click();
    await page.locator(".settings-row", { hasText: "GitHub" }).getByRole("button", { name: "Sign in…" }).click();
    await page.getByPlaceholder(/ghp_/).fill("ghp_example");
    await page.locator(".dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    const text = await toast();
    expect(text.includes("Signed in to GitHub as maya-chen"), `toast "${text}"`);
    await page.getByText("Signed in as maya-chen").waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await dismissToast();
  });

  await step("signs in to GitLab with a token, on a company's server", async () => {
    await page.evaluate(() => (window.__PREVIEW__.gitlab = { account: null }));
    await page.keyboard.press("Control+Comma");
    await page.getByRole("tab", { name: "Accounts" }).click();
    await page.locator(".settings-row", { hasText: "GitLab" }).getByRole("button", { name: "Sign in…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Sign in to GitLab" });
    await dialog.getByPlaceholder(/your company's/).fill("https://GitLab.example.com/");
    await dialog.getByPlaceholder("glpat-…").fill("glpat-example");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    const text = await toast();
    expect(text.includes("Signed in to gitlab.example.com as maya.chen"), `toast "${text}"`);
    await page.getByText("Signed in as maya.chen").waitFor({ timeout: 5000 });
    await page.locator(".settings-row", { hasText: "GitLab (gitlab.example.com)" }).waitFor();
    await page.keyboard.press("Escape");
    await dismissToast();
  });

  await step("sets who you commit as in one repository, from its tab's menu", async () => {
    await page.locator(".tab", { hasText: "notebook" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Repository Settings…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Settings for notebook" });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel("Name for commits in this repository").fill("Maya Chen");
    await dialog.getByLabel("Email for commits in this repository").fill("maya@work.example.com");
    // "Save" when the repository already has a name and email of its own (the demos do).
    await dialog.getByRole("button", { name: /^(Save|Use for this repository)$/ }).click();
    await dialog.getByText("Here you commit as Maya Chen <maya@work.example.com>").waitFor({ timeout: 10_000 });
    await dialog.getByRole("tab", { name: "Branches" }).click();
    await dialog.getByText("Protected branches").waitFor();
    // The notebook doesn't use Git LFS: it can start here.
    await dialog.getByRole("tab", { name: "Git LFS" }).click();
    const lfsInstalled = (await dialog.getByText("Git LFS isn't installed").count()) === 0;
    if (lfsInstalled) {
      await dialog.getByRole("button", { name: "Store *.psd files with Git LFS" }).click();
      await dialog.locator(".name-chip", { hasText: "*.psd" }).waitFor({ timeout: 10_000 });
      await dialog.getByRole("button", { name: "Remove *.psd" }).click();
      await dialog.locator(".name-chip", { hasText: "*.psd" }).waitFor({ state: "detached", timeout: 10_000 });
      await dismissToast();
    }
    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await dismissToast();
    // The toolbar's gear opens it too.
    await page.getByRole("button", { name: "Repository settings" }).click();
    await dialog.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    // The app's own Settings don't have it any more.
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.waitFor();
    expect((await settings.getByRole("tab", { name: /This repository/ }).count()) === 0, "Settings still has This repository");
    await page.keyboard.press("Escape");
  });

  await step("signs commits with a GPG key set for the repository, and shows them verified", async () => {
    const gpg = spawnSync("gpg", ["--version"]);
    if (gpg.error || gpg.status !== 0) {
      console.log("    (skipped: GPG isn't installed)");
      return;
    }
    // A throwaway key, in a short folder (GPG's agent puts its socket there), used through gpg.program.
    const home = mkdtempSync(join(tmpdir(), "trg"));
    chmodSync(home, 0o700);
    const made = spawnSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-gen-key", "Maya Chen <maya@example.com>", "ed25519", "sign", "never"], {
      env: { ...process.env, GNUPGHOME: home },
    });
    expect(made.status === 0, `GPG couldn't make a key: ${made.stderr}`);
    const wrapper = join(home, "gpg.sh");
    writeFileSync(wrapper, `#!/bin/sh\nGNUPGHOME='${home}' exec gpg "$@"\n`, { mode: 0o755 });
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8", env: { ...process.env, ...demoEnv(demos) } }).trim();
    git("config", "gpg.program", wrapper);
    try {
      await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
      await row("Prepare the 0.3 release notes").waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "Repository settings" }).click();
      const dialog = page.locator(".dialog", { hasText: "Settings for notebook" });
      await dialog.getByRole("tab", { name: "Signing" }).click();
      await dialog.getByLabel("How to sign commits in this repository").selectOption("gpg");
      await dialog.getByLabel("Key to sign with").selectOption({ label: "Maya Chen <maya@example.com>" });
      await dialog.getByRole("button", { name: "Use for this repository" }).click();
      await dialog.getByText(/^Commits here are signed with GPG/).waitFor({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 5000 });
      await dismissToast();
      git("commit", "-q", "--allow-empty", "-m", "Signed in the smoke test");
      await page.keyboard.press("F5");
      await row("Signed in the smoke test").click();
      const mark = page.locator(".details .signature-mark.good", { hasText: "Verified" });
      await mark.waitFor({ timeout: 10_000 });
      await page.locator(".details .signature-signer", { hasText: "Maya Chen" }).waitFor({ timeout: 5000 });
      // A commit that isn't signed has no mark.
      await row("Prepare the 0.3 release notes").click();
      await page.locator(".details", { hasText: "Prepare the 0.3 release notes" }).waitFor({ timeout: 5000 });
      expect((await page.locator(".details .signature-mark").count()) === 0, "an unsigned commit shows a signature");
    } finally {
      // As it was, for the steps after this one.
      git("reset", "-q", "--soft", "HEAD~1");
      for (const key of ["commit.gpgsign", "gpg.format", "user.signingkey", "gpg.program"]) spawnSync("git", ["-C", demos.notebook, "config", "--local", "--unset", key]);
      spawnSync("gpgconf", ["--kill", "gpg-agent"], { env: { ...process.env, GNUPGHOME: home } });
      rmSync(home, { recursive: true, force: true });
      await page.keyboard.press("F5");
    }
  });

  await step("adds, renames and removes a remote", async () => {
    await page.getByRole("button", { name: "Manage remotes" }).click();
    const dialog = page.locator(".dialog", { hasText: "Settings for notebook" });
    await dialog.getByRole("tab", { name: "Remotes", selected: true }).waitFor({ timeout: 10_000 });
    await dialog.getByLabel("New remote's name").fill("upstream");
    await dialog.getByLabel("New remote's address").fill("https://maya:ghp_example@github.com/example/notebook.git");
    await dialog.getByRole("button", { name: "Add remote" }).click();
    await page.locator(".toast", { hasText: "Added the remote upstream" }).waitFor({ timeout: 10_000 });
    // The token isn't shown.
    await dialog.getByText("https://github.com/example/notebook.git · (with a saved password or token)").waitFor({ timeout: 5000 });
    expect((await dialog.getByText("ghp_example").count()) === 0, "the token is shown");
    await dialog.getByRole("button", { name: "Edit upstream" }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("mirror");
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.locator(".toast", { hasText: "Renamed the remote upstream to mirror" }).waitFor({ timeout: 10_000 });
    expect(execFileSync("git", ["-C", demos.notebook, "remote"], { encoding: "utf8" }).split("\n").includes("mirror"), "not renamed");
    await dialog.getByRole("button", { name: "Remove mirror" }).click();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await page.locator(".toast", { hasText: "Removed the remote mirror" }).waitFor({ timeout: 10_000 });
    expect(!execFileSync("git", ["-C", demos.notebook, "remote"], { encoding: "utf8" }).includes("mirror"), "not removed");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await dismissToast();
  });

  await step("shows diagnostics to copy", async () => {
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Copy Diagnostics" }).click();
    const text = page.locator(".diagnostics-text");
    await text.filter({ hasText: "Repository:" }).waitFor({ timeout: 10_000 });
    const shown = await text.innerText();
    expect(shown.includes("Tributary") && shown.includes("Git:"), `diagnostics "${shown.slice(0, 80)}"`);
    await page.locator(".dialog").getByRole("button", { name: "Close", exact: true }).click();
  });

  await step("checks for updates in Help → About Tributary", async () => {
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "About Tributary" }).click();
    const about = page.locator(".about-window");
    // Opening it checks; the preview has no newer version.
    await about.locator(".about-status.current", { hasText: "You're up to date" }).waitFor({ timeout: 10_000 });
    const auto = about.getByRole("switch", { name: "Check for updates automatically" });
    const before = await auto.getAttribute("aria-checked");
    await auto.click();
    expect((await auto.getAttribute("aria-checked")) !== before, "the automatic check didn't change");
    await auto.click();
    // Betas: off to begin with; turning them on looks again, and they're turned off again.
    const beta = about.getByRole("switch", { name: "Get beta versions" });
    expect((await beta.getAttribute("aria-checked")) === "false", "betas are on to begin with");
    await beta.click();
    expect((await beta.getAttribute("aria-checked")) === "true", "betas didn't turn on");
    await about.locator(".about-status.current").waitFor({ timeout: 10_000 });
    await beta.click();
    await about.getByRole("button", { name: "Check again" }).click();
    await about.locator(".about-status.current").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await about.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("downloads an update, and waits for git before restarting for it", async () => {
    await page.evaluate(() => {
      window.__PREVIEW__.update = { version: "9.9.0", notes: "## Fixes\n- Faster start-up", date: null };
      window.__PREVIEW__.gitBusy = true;
    });
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "About Tributary" }).click();
    const about = page.locator(".about-window");
    // It checked a moment ago (the step before), so it's checked again by hand.
    await about.getByRole("button", { name: "Check again" }).click();
    // Found, downloaded in the background, then ready.
    await about.locator(".about-status", { hasText: "Tributary 9.9.0 is ready" }).waitFor({ timeout: 15_000 });
    await page.locator(".update-pill", { hasText: "Restart to update" }).waitFor({ timeout: 5000 });
    await about.getByRole("button", { name: "Restart now" }).click();
    await about.locator(".about-status", { hasText: "Restarting when git is done" }).waitFor({ timeout: 5000 });
    await about.getByRole("button", { name: "Don't restart" }).click();
    await about.getByRole("button", { name: "Restart now" }).waitFor({ timeout: 5000 });
    expect(!(await page.evaluate(() => window.__PREVIEW__.installed)), "installed while git was busy");
    await page.keyboard.press("Escape");
    await about.waitFor({ state: "detached", timeout: 5000 });
    // It said so too, once ready, with Restart.
    const notice = await toast();
    expect(/Tributary 9\.9\.0 is ready/.test(notice), `toast "${notice}"`);
    await dismissToast();
  });

  await step("keeps a local history snapshot and puts a file back from it", async () => {
    const file = join(demos.notebook, "README.md");
    const before = readFileSync(file, "utf8");
    writeFileSync(file, `${before}\nA line worth keeping.\n`);
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Local History" }).click();
    const dialog = page.locator(".local-history-dialog");
    await dialog.getByRole("button", { name: "Keep a snapshot now" }).click();
    await dialog.locator(".history-files li", { hasText: "README.md" }).waitFor({ timeout: 10_000 });
    writeFileSync(file, "Overwritten by mistake\n");
    await dialog.locator(".history-files li", { hasText: "README.md" }).getByRole("button", { name: "Restore" }).click();
    const text = await toast();
    expect(text.includes("Restored README.md from the local history"), `toast "${text}"`);
    expect(readFileSync(file, "utf8").includes("A line worth keeping."), "not restored");
    writeFileSync(file, before);
    await dismissToast();
  });

  await step("explains Why Is a File Ignored first, then finds the rule", async () => {
    const ignore = join(demos.notebook, ".gitignore");
    const before = existsSync(ignore) ? readFileSync(ignore, "utf8") : null;
    writeFileSync(ignore, `${before ?? ""}\n# Scratch\n*.scratch\n`);
    writeFileSync(join(demos.notebook, "notes.scratch"), "scratch");
    const openTool = async () => {
      await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
      await page.getByRole("menuitem", { name: "Tools" }).click();
      await page.getByRole("menuitem", { name: "Why Is a File Ignored…" }).click();
    };
    await openTool();
    const intro = page.locator(".ignore-window", { hasText: "Choose the file" });
    await intro.waitFor({ timeout: 10_000 });
    await page.evaluate((pick) => Object.assign(window.__PREVIEW__, { pick }), join(demos.notebook, "notes.scratch"));
    await intro.getByRole("button", { name: "Choose a file…" }).click();
    const answer = page.locator(".ignore-window", { hasText: "Why notes.scratch is left out" });
    await answer.locator(".ignore-rule-card", { hasText: "*.scratch" }).waitFor({ timeout: 10_000 });
    await answer.locator("button.secondary-button", { hasText: "Close" }).click();
    // Without the introduction: straight to choosing a file.
    await openTool();
    await intro.getByText("Don't show this again").click();
    await intro.getByRole("button", { name: "Cancel" }).click();
    await page.evaluate((pick) => Object.assign(window.__PREVIEW__, { pick }), join(demos.notebook, "README.md"));
    await openTool();
    await page.locator(".ignore-window", { hasText: "README.md isn't ignored" }).waitFor({ timeout: 10_000 });
    await page.locator(".ignore-window button.secondary-button", { hasText: "Close" }).click();
    // Settings brings it back.
    await page.keyboard.press("Control+Comma");
    const toggle = page.getByRole("switch", { name: "Introduce Why Is a File Ignored…" }).or(page.getByLabel("Introduce Why Is a File Ignored…"));
    expect(!(await toggle.isChecked()), "the introduction is still on");
    await toggle.click();
    await page.keyboard.press("Escape");
    await openTool();
    await intro.waitFor({ timeout: 10_000 });
    await intro.getByRole("button", { name: "Cancel" }).click();
    if (before === null) rmSync(ignore);
    else writeFileSync(ignore, before);
    rmSync(join(demos.notebook, "notes.scratch"));
  });

  await step("shows the shelves, and switches to Simple mode and back", async () => {
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Shelves" }).click();
    const shelves = page.locator(".shelves-dialog");
    await shelves.getByText("On the shelves").waitFor({ timeout: 10_000 });
    await shelves.locator(".shelves-status").waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    await shelves.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".menu-bar-item", { hasText: "View" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Simple Mode" }).click();
    await page.locator(".simple-view").getByRole("heading", { name: "My changes" }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Full view" }).click();
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("cherry-picks a commit dragged onto a branch that isn't checked out, and undoes it", async () => {
    const was = (await page.locator('.tabs > .tab[aria-selected="true"]').textContent()).trim();
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, "-c", "user.name=Sam Okafor", "-c", "user.email=sam@example.com", ...args], { encoding: "utf8" }).trim();
    // A commit on a branch of its own, and a branch to pick it onto: on a commit with no
    // other labels, so its label is the one the row shows.
    const bare = git("log", "--format=%H%x09%D", "-30", "main").split("\n").slice(1).find((line) => line.endsWith("\t"))?.split("\t")[0];
    expect(bare, "no commit without labels to put the branch on");
    // Made with git's plumbing, so the files on disk stay as they are.
    const head = git("rev-parse", "HEAD");
    const blob = execFileSync("git", ["-C", demos.notebook, "hash-object", "-w", "--stdin"], { input: "Things to pick up.\n", encoding: "utf8" }).trim();
    const listing = `${git("ls-tree", "HEAD")}\n100644 blob ${blob}\tPICK.md\n`;
    const tree = execFileSync("git", ["-C", demos.notebook, "mktree"], { input: listing, encoding: "utf8" }).trim();
    git("branch", "pick-source", git("commit-tree", tree, "-p", head, "-m", "Add a pick list"));
    git("branch", "pick-target", bare);
    await page.keyboard.press("F5");
    const source = row("Add a pick list");
    await source.waitFor({ timeout: 10_000 });
    const dragOnto = async (target) => {
      const from = await source.locator(".cell.description").first().boundingBox();
      await page.mouse.move(from.x + 40, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 50, from.y + from.height / 2, { steps: 3 });
      // Where it is once the press has selected the row: the list can move.
      await page.waitForTimeout(300);
      const to = await target.boundingBox();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      expect(await target.evaluate((element) => element.classList.contains("drop-target")), "the branch isn't marked as where it goes");
      await page.mouse.up();
    };
    // Onto its label in the graph: picked without checking it out, and Undo takes it back off.
    await dragOnto(page.locator('.commit-row .ref-pill[data-drop-branch="pick-target"]'));
    let text = await toast();
    expect(/Cherry-picked [0-9a-f]{7} onto pick-target/.test(text), `toast "${text}"`);
    expect(git("log", "-1", "--format=%s", "pick-target") === "Add a pick list", "pick-target doesn't have the commit");
    expect(git("rev-parse", "pick-target^") === bare, "the commit wasn't put on pick-target's tip");
    expect(git("rev-parse", "HEAD") === head && git("branch", "--show-current") === "main", "the checkout changed");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    text = await toast();
    expect(/Took [0-9a-f]{7} back off pick-target/.test(text), `toast "${text}"`);
    expect(git("rev-parse", "pick-target") === bare, "Undo didn't move pick-target back");
    await dismissToast();
    // Onto it in the sidebar too; a second time, it says the branch has it already.
    const inSidebar = page.locator('.sidebar-item[data-drop-branch="pick-target"]');
    await dragOnto(inSidebar);
    text = await toast();
    expect(/onto pick-target/.test(text), `toast "${text}"`);
    await dismissToast();
    await dragOnto(inSidebar);
    await page.locator(".error-banner", { hasText: "pick-target already has" }).waitFor({ timeout: 10_000 });
    // A refresh (as after a fetch, or when files change) leaves it there to be read.
    await page.keyboard.press("F5");
    await page.waitForTimeout(1500);
    expect(await page.locator(".error-banner", { hasText: "pick-target already has" }).isVisible(), "a refresh took the error away");
    await page.locator(".error-banner").getByRole("button", { name: "Dismiss" }).click();
    git("branch", "-D", "pick-source", "pick-target");
    await page.keyboard.press("F5");
    await page.locator(".tabs > .tab[data-path]").filter({ hasText: new RegExp(`^${was}$`) }).dispatchEvent("mousedown", { button: 0 });
    await page.locator('.tabs > .tab[aria-selected="true"]', { hasText: was }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("takes a tour from Help → Tours", async () => {
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Tours" }).click();
    await page.locator(".tours-dialog li", { hasText: "Getting started" }).getByRole("button").click();
    const card = page.locator(".tour-card");
    await card.getByRole("heading", { name: "The graph" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("ArrowRight");
    await card.locator("h3").filter({ hasNotText: "The graph" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("syncs a branch with commits on both sides, and force pushes it when it was rewritten", async () => {
    const was = (await page.locator('.tabs > .tab[aria-selected="true"]').textContent()).trim();
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    // A teammate pushes a commit of their own to main.
    const teammate = join(folder, "sync-teammate");
    execFileSync("git", ["clone", "-q", git("remote", "get-url", "origin"), teammate]);
    // Lea's commits are hers, whatever identity git has in the environment here.
    const lea = { GIT_AUTHOR_NAME: "Lea Fischer", GIT_AUTHOR_EMAIL: "lea@example.com", GIT_COMMITTER_NAME: "Lea Fischer", GIT_COMMITTER_EMAIL: "lea@example.com" };
    const theirs = (...args) => execFileSync("git", ["-C", teammate, ...args], { encoding: "utf8", env: { ...process.env, ...lea } }).trim();
    writeFileSync(join(teammate, "TEAM.md"), "Who looks after what.\n");
    theirs("add", "TEAM.md");
    theirs("commit", "-qm", "Say who looks after what");
    theirs("push", "-q", "origin", "HEAD:main");
    // Fetched, main has commits on both sides: Push becomes Sync.
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    const sync = page.locator(".split-button .tool-button").first();
    await sync.filter({ hasText: "Sync" }).waitFor({ timeout: 15_000 });
    await sync.click();
    // git won't merge while changes are staged (the notebook has some): Sync offers to put
    // them aside, sync, and bring them back, as a pull does.
    const synced = page.locator(".toast", { hasText: /Synced main: pulled \d+ commits?, then pushed \d+ commits?/ });
    const aside = page.getByRole("button", { name: "Stash changes and retry" });
    await synced.or(aside).first().waitFor({ timeout: 20_000 });
    if (await aside.isVisible()) await aside.click();
    await synced.waitFor({ timeout: 20_000 });
    expect(git("rev-parse", "main") === git("rev-parse", "origin/main"), "main and origin/main differ after syncing");
    expect(git("ls-tree", "--name-only", "main").split("\n").includes("TEAM.md"), "the teammate's commit wasn't pulled");
    await dismissToast();
    // Amended after it was pushed: Sync stops before pulling the old version back, and asks
    // for a force push instead. Nothing is pushed.
    const pushed = git("rev-parse", "main");
    // --only: just the message, not what's staged.
    git("-c", "user.name=Sam Okafor", "-c", "user.email=sam@example.com", "commit", "-q", "--amend", "--only", "--allow-empty", "-m", "Sync with the team, amended");
    // The remote moves on too, so main has commits on both sides again.
    theirs("pull", "-q", "--no-rebase", "origin", "main");
    writeFileSync(join(teammate, "TEAM.md"), "Who looks after what, and when.\n");
    theirs("commit", "-qam", "Say when, too");
    theirs("push", "-q", "origin", "HEAD:main");
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await sync.filter({ hasText: "Sync" }).waitFor({ timeout: 15_000 });
    await sync.click();
    const dialog = page.locator(".dialog", { hasText: "Force push main?" });
    await dialog.getByText("Sync stopped.", { exact: false }).waitFor({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(git("rev-parse", "origin/main") !== git("rev-parse", "main"), "something was pushed");
    // Force pushed, the dialog goes and the push shows its progress, like any push. A slow
    // pre-push hook gives it time to show.
    const theirTip = git("rev-parse", "origin/main");
    const hook = join(demos.notebook, git("rev-parse", "--git-path", "hooks/pre-push"));
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\nsleep 2\n");
    chmodSync(hook, 0o755);
    await sync.click();
    await dialog.getByText("Sync stopped.", { exact: false }).waitFor({ timeout: 20_000 });
    // main is protected here: its name is typed first.
    await dialog.getByLabel("Type main to confirm").fill("main");
    await dialog.getByRole("button", { name: "Force push", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await page.locator(".progress-strip", { hasText: "Force pushing" }).waitFor({ timeout: 5000 });
    await page.locator(".toast", { hasText: "Force pushed main to origin" }).waitFor({ timeout: 20_000 });
    expect(git("rev-parse", "origin/main") === git("rev-parse", "main"), "main wasn't force pushed");
    await dismissToast();
    rmSync(hook);
    // The teammate pushes again before main is fetched, and main is amended again: a force
    // push stops for the teammate's commit, says whose it is, and lists it.
    theirs("fetch", "-q");
    theirs("reset", "-q", "--hard", "origin/main");
    writeFileSync(join(teammate, "TEAM.md"), "Who looks after what, when, and why.\n");
    theirs("commit", "-qam", "Say why, too");
    theirs("push", "-q", "origin", "HEAD:main");
    const theirNew = theirs("rev-parse", "HEAD");
    git("-c", "user.name=Sam Okafor", "-c", "user.email=sam@example.com", "commit", "-q", "--amend", "--only", "--allow-empty", "-m", "Sync with the team, amended again");
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Commands" }).locator("input").fill("force push");
    await page.keyboard.press("Enter");
    await dialog.getByLabel("Type main to confirm").fill("main");
    expect(!(await dialog.getByRole("checkbox").isChecked()), "the box to replace someone else's commits starts ticked");
    await dialog.getByRole("button", { name: "Force push", exact: true }).click();
    const stopped = page.locator(".error-explained", { hasText: "Force push stopped: origin/main has a commit you haven't fetched, by Lea Fischer" });
    await stopped.locator(".error-commits li", { hasText: "Say why, too" }).waitFor({ timeout: 20_000 });
    expect(git("rev-parse", "origin/main") === theirNew, "the teammate's commit wasn't fetched to be seen");
    expect(git("ls-remote", "origin", "refs/heads/main").startsWith(theirNew), "the safe force push replaced the teammate's commit");
    // git's own message is there too, behind a toggle.
    await stopped.getByRole("button", { name: "Show git's message" }).click();
    await stopped.locator(".error-git", { hasText: "stale info" }).waitFor({ timeout: 5000 });
    // Force push anyway…: the dialog again, with the box ticked; it replaces the commit too.
    await stopped.getByRole("button", { name: "Force push anyway…" }).click();
    await dialog.getByLabel("Type main to confirm").fill("main");
    expect(await dialog.getByRole("checkbox").isChecked(), "the box to replace someone else's commits wasn't ticked");
    await dialog.getByRole("button", { name: "Force push anyway" }).click();
    await page.locator(".toast", { hasText: "Force pushed main to origin" }).waitFor({ timeout: 20_000 });
    expect(git("ls-remote", "origin", "refs/heads/main").startsWith(git("rev-parse", "main")), "main wasn't force pushed over the teammate's commit");
    expect(!(await stopped.isVisible()), "the error stayed after the force push");
    await dismissToast();
    // Back as it was before the amend, for the steps after this one (the working files as they are).
    git("push", "-q", "--force", "origin", `${theirTip}:main`);
    git("reset", "-q", "--soft", pushed);
    await page.keyboard.press("F5");
    await page.locator(".tabs > .tab[data-path]").filter({ hasText: new RegExp(`^${was}$`) }).dispatchEvent("mousedown", { button: 0 });
    await page.locator('.tabs > .tab[aria-selected="true"]', { hasText: was }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("offers to go with another remote branch when a branch's own was renamed on the remote", async () => {
    const was = (await page.locator('.tabs > .tab[aria-selected="true"]').textContent()).trim();
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    const remote = git("remote", "get-url", "origin");
    const bare = (...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8" }).trim();
    // main is renamed to trunk on the remote, which makes it its main branch: pulling fails.
    bare("branch", "-m", "main", "trunk");
    bare("symbolic-ref", "HEAD", "refs/heads/trunk");
    await page.locator(".toolbar .tool-button", { hasText: "Pull" }).first().click();
    const banner = page.locator(".error-explained", { hasText: "origin has no branch called main any more" });
    const use = banner.getByRole("button", { name: "Use origin/trunk" });
    await use.waitFor({ timeout: 20_000 });
    await banner.getByText("It's origin's main branch, and has everything origin/main had.").waitFor({ timeout: 5000 });
    // Choose another…: origin's branches, the likely one first, with a box to rename main to match.
    await banner.getByRole("button", { name: "Choose another…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Which branch on origin does main go with?" });
    const first = dialog.locator(".merge-method").first();
    await first.waitFor({ timeout: 10_000 });
    expect((await first.textContent()).includes("origin/trunk") && (await first.textContent()).includes("origin's main branch"), "origin/trunk isn't first, as origin's main branch");
    expect(await dialog.getByRole("checkbox", { name: /Also rename main to trunk/ }).isChecked(), "the box to rename main to match isn't ticked");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // The likely one, in one click: main goes with origin/trunk.
    await use.click();
    await page.locator(".toast", { hasText: "main now goes with origin/trunk" }).waitFor({ timeout: 20_000 });
    expect(git("config", "branch.main.merge") === "refs/heads/trunk", "main doesn't go with origin/trunk");
    expect(!(await banner.isVisible()), "the error stayed after it was fixed");
    await dismissToast();
    // Back as it was, for the steps after this one.
    bare("branch", "-m", "trunk", "main");
    bare("symbolic-ref", "HEAD", "refs/heads/main");
    git("fetch", "-q", "--prune", "origin");
    git("branch", "-q", "--set-upstream-to=origin/main", "main");
    await page.keyboard.press("F5");
    await page.locator(".tabs > .tab[data-path]").filter({ hasText: new RegExp(`^${was}$`) }).dispatchEvent("mousedown", { button: 0 });
    await page.locator('.tabs > .tab[aria-selected="true"]', { hasText: was }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("exports the settings to a git repository, and imports them back", async () => {
    const remote = join(folder, "settings.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    await page.keyboard.press("Control+,");
    const settings = page.locator(".settings-window");
    await settings.locator(".settings-nav").getByText("Export and import").click();
    await settings.getByRole("button", { name: "Export to a repository…" }).click();
    const dialog = page.locator(".settings-repository-window");
    await dialog.getByLabel("Repository").fill(remote);
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await page.locator(".toast", { hasText: "Exported your settings to the repository" }).waitFor({ timeout: 20_000 });
    const exported = JSON.parse(execFileSync("git", ["--git-dir", remote, "show", "HEAD:tributary-settings.json"], { encoding: "utf8" }));
    expect(exported.app === "Tributary" && Object.keys(exported.settings).length > 3, "the settings weren't committed");
    await settings.getByRole("button", { name: "Import from a repository…" }).click();
    expect((await dialog.getByLabel("Repository").inputValue()) === remote, "the link wasn't remembered");
    const reloaded = page.waitForEvent("load", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator(".toast", { hasText: "Imported" }).waitFor({ timeout: 20_000 });
    // Tributary starts again with them.
    await reloaded;
  });

  await step("goes to a commit by its id, a tag or a day, loading older history to reach it", async () => {
    // A history longer than a page (10,000 commits), made at once with git fast-import: a
    // commit a minute from 2023-11-14 22:13 (UTC).
    const long = join(folder, "long-history");
    mkdirSync(long);
    execFileSync("git", ["init", "-q", "-b", "main", long]);
    let stream = "";
    for (let step = 1; step <= 10_050; step++) {
      const message = `Step ${step}`;
      stream += `commit refs/heads/main\nmark :${step}\ncommitter Ada Wright <ada@example.com> ${1_700_000_000 + step * 60} +0000\ndata ${message.length}\n${message}\n${step > 1 ? `from :${step - 1}\n` : ""}\n`;
    }
    execFileSync("git", ["-C", long, "fast-import", "--quiet"], { input: stream });
    const at = (step) => execFileSync("git", ["-C", long, "rev-parse", `main~${10_050 - step}`], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", long, "tag", "v0.1", at(10)]);
    // The tab that was open, to go back to.
    const was = (await page.locator('.tabs > .tab[aria-selected="true"]').textContent()).trim();
    await page.evaluate((pick) => Object.assign(window.__PREVIEW__, { pick }), long);
    await page.getByRole("button", { name: "New tab" }).click();
    await page.getByText("Open repository").first().click();
    await row("Step 10050").waitFor({ timeout: 20_000 });
    const selected = page.locator(".commit-row.selected .summary");
    const goTo = async (query) => {
      await page.keyboard.press("Control+g");
      const dialog = page.locator(".dialog", { hasText: "Go to commit" });
      await dialog.getByRole("textbox").fill(query);
      await dialog.getByRole("button", { name: "Go" }).click();
      return dialog;
    };
    // The first commit, by the start of its id: past the first page, so older history loads.
    await goTo(at(1).slice(0, 10));
    await page.waitForFunction(() => document.querySelector(".commit-row.selected .summary")?.textContent.trim() === "Step 1", null, { timeout: 30_000 });
    // A tag, and a day: the last commit made by its end (2023-11-15 23:59 is step 1546).
    await goTo("v0.1");
    await page.waitForFunction(() => document.querySelector(".commit-row.selected .summary")?.textContent.trim() === "Step 10", null, { timeout: 10_000 });
    await goTo("2023-11-15");
    await page.waitForFunction(() => document.querySelector(".commit-row.selected .summary")?.textContent.trim() === "Step 1546", null, { timeout: 10_000 });
    // Nothing called that: said in the dialog, which stays open.
    const dialog = await goTo("no-such-thing");
    await dialog.getByText('no commit, branch or tag called "no-such-thing"').waitFor({ timeout: 5000 });
    expect((await selected.textContent()).trim() === "Step 1546", "the selection moved");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Control+w");
    await page.locator(".tab", { hasText: "long-history" }).waitFor({ state: "detached", timeout: 5000 });
    await page.locator(".tabs > .tab[data-path]").filter({ hasText: new RegExp(`^${was}$`) }).dispatchEvent("mousedown", { button: 0 });
    await page.locator('.tabs > .tab[aria-selected="true"]', { hasText: was }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("offers old branches to prune when asked, with how long they've gone without commits, and undoes it", async () => {
    // The tab that was open, to go back to.
    const was = (await page.locator('.tabs > .tab[aria-selected="true"]').textContent()).trim();
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    // A branch with a commit of its own that nobody has touched since March 2024.
    const when = "2024-03-01T12:00:00Z";
    const git = (...args) =>
      execFileSync("git", ["-C", demos.studio, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }).trim();
    const old = git("commit-tree", git("rev-parse", "HEAD^{tree}"), "-p", "HEAD", "-m", "Try a lantern on the sign");
    git("branch", "spike/lantern", old);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Prune branches" }).click();
    const dialog = page.locator(".dialog", { hasText: "Prune branches" });
    const idle = dialog.locator(".prune-idle select");
    await idle.waitFor({ timeout: 20_000 });
    const lantern = dialog.locator(".prune-row", { hasText: "spike/lantern" });
    expect((await lantern.count()) === 0, "an old branch was offered without asking");
    await idle.selectOption("6");
    await lantern.waitFor({ timeout: 10_000 });
    const said = await lantern.innerText();
    expect(/no commits for over (a|\d+) years?/.test(said), `the old branch says "${said.replace(/\s+/g, " ")}"`);
    expect(!(await lantern.locator("input").isChecked()), "the old branch, with a commit in no other branch, was ticked");
    // Just it: deleted, then back with Undo.
    for (const box of await dialog.locator(".prune-row input:checked").all()) await box.uncheck();
    await lantern.locator("input").check();
    await dialog.getByRole("button", { name: "Delete 1 branch" }).click();
    await page.locator(".toast", { hasText: "Deleted branch spike/lantern" }).waitFor({ timeout: 10_000 });
    expect(git("branch", "--list", "spike/lantern") === "", "the branch is still there");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    for (let tries = 0; tries < 20 && git("branch", "--list", "spike/lantern") === ""; tries++) await page.waitForTimeout(250);
    expect(git("rev-parse", "spike/lantern") === old, "Undo didn't bring the branch back");
    await dismissToast();
    git("branch", "-D", "spike/lantern");
    await page.evaluate(() => localStorage.removeItem("tributary.prune.idleMonths"));
    await page.locator(".tabs > .tab[data-path]").filter({ hasText: new RegExp(`^${was}$`) }).dispatchEvent("mousedown", { button: 0 });
    await page.locator('.tabs > .tab[aria-selected="true"]', { hasText: was }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-row").first().waitFor({ timeout: 10_000 });
  });

  await step("reads well in the light theme", async () => {
    await page.keyboard.press("Control+,");
    const settings = page.locator(".settings-window");
    await settings.locator(".settings-nav").getByText("Appearance").click();
    await settings.locator(".theme-choice", { hasText: "Light" }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await accessible("the light theme's Settings");
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
    await row("Speed up opening large notebooks").click();
    await accessible("the repository in the light theme");
    await page.keyboard.press("Control+,");
    await settings.locator(".settings-nav").getByText("Appearance").click();
    await settings.locator(".theme-choice", { hasText: "Dark" }).click();
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows the catalogue of the building blocks, in both themes", async () => {
    await page.goto(`${preview.url}?catalogue`);
    for (const theme of ["Dark", "Light"]) {
      const inside = page.frameLocator(`iframe[title="${theme}"]`);
      await inside.locator(".catalogue-section h2", { hasText: "Buttons" }).waitFor({ timeout: 10_000 });
      expect((await inside.locator(".catalogue-icons > div").count()) > 50, `${theme}: the icons are missing`);
      expect((await inside.locator(".catalogue-colour").count()) > 40, `${theme}: the colours are missing`);
      expect((await inside.locator(".catalogue-row code", { hasText: "--type-sm" }).count()) === 1, `${theme}: the type scale is missing`);
      await accessible(`the catalogue, ${theme.toLowerCase()}`, page.frames().find((frame) => frame.url().includes(`theme=${theme.toLowerCase()}`)));
    }
  });

  await step("had no errors on the page", async () => {
    expect(errors.length === 0, errors.join("; "));
  });
} finally {
  await browser.close();
  await preview.close();
  await locks.close();
  rmSync(folder, { recursive: true, force: true });
}

if (offCentre.size > 0) {
  console.log(`\nWords off the middle of their controls (${offCentre.size}):`);
  for (const [line, where] of offCentre) console.log(`  ${line}  [${[...new Set(where)].join(", ")}]`);
}
console.log(failed ? `${failed} failed` : "All good");
process.exit(failed ? 1 : 0);
