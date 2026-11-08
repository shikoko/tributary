// Clicks through the main parts of Tributary in a real browser, on freshly built demo
// repositories, with the app's own Rust code answering: open a repository, select and
// search commits, check out a branch (with uncommitted changes in the way), undo it,
// fetch, open a second tab, and look at Git LFS locks and big files.
//
//   npm run preview:build && npm run preview:smoke [-- --screenshots <folder>]
//
// Needs Playwright with Chromium (`npm install --no-save playwright` and
// `npx playwright install chromium`, if they aren't installed already).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDemos, DEMO_IDENTITY, STUDIO_PULL_REQUESTS } from "./demo.mjs";
import { startLockServer } from "./lfs-locks.mjs";
import { startPreview } from "./server.mjs";

function loadPlaywright() {
  try {
    // Through require, so a globally installed Playwright (NODE_PATH) is found too.
    return createRequire(import.meta.url)("playwright");
  } catch {
    console.error("The smoke test needs Playwright: npm install --no-save playwright && npx playwright install chromium");
    process.exit(2);
  }
}

const screenshotsAt = process.argv.indexOf("--screenshots");
const screenshots = screenshotsAt > 0 ? resolve(process.argv[screenshotsAt + 1]) : null;
if (screenshots) mkdirSync(screenshots, { recursive: true });

const { chromium } = loadPlaywright();
const folder = mkdtempSync(join(tmpdir(), "tributary-smoke-"));
const locks = await startLockServer({ port: 0 });
const demos = buildDemos(folder, { lockServer: locks.url });
const preview = await startPreview({ port: 0, quiet: true, env: DEMO_IDENTITY });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript((pick) => {
  window.__PREVIEW__ = { pick, pullRequests: [] };
  // No background fetches: the test fetches when it means to.
  localStorage.setItem("tributary.fetch.auto", "false");
}, demos.notebook);

let failed = 0;
let shot = 0;
async function step(name, run) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(error.message ?? error).split("\n")[0]}`);
  }
  if (screenshots) await page.screenshot({ path: join(screenshots, `${String(++shot).padStart(2, "0")}.png`) }).catch(() => {});
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

console.log("Tributary smoke test");
try {
  await page.goto(preview.url);

  await step("shows the welcome screen", async () => {
    await page.getByText("Open repository").first().waitFor();
  });

  await step("opens a repository", async () => {
    await page.getByText("Open repository").first().click();
    await page.waitForSelector(".commit-row");
    const rows = await page.locator(".commit-row").count();
    expect(rows > 20, `only ${rows} rows`);
    await page.waitForSelector(".summary.wip", { timeout: 5000 });
  });

  await step("shows a commit's details", async () => {
    await row("Add the note model").click();
    await page.locator(".details", { hasText: "Sam Okafor" }).waitFor({ timeout: 5000 });
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
    await dismissToast();
  });

  await step("makes a tag in a dialog, and undoes it", async () => {
    await row("Add the note model").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "New tag here" }).click();
    await page.getByPlaceholder("v1.2.0").fill("v0.0.9");
    await page.getByRole("button", { name: "Create tag" }).click();
    const tag = page.locator(".ref-pill", { hasText: "v0.0.9" });
    await tag.first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".ref-pill")].some((pill) => pill.textContent?.includes("v0.0.9")), null, { timeout: 10_000 });
    await dismissToast();
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

  await step("hides a branch, then shows everything again", async () => {
    const themes = page.locator(".sidebar-item", { hasText: /^themes/ }).first();
    await themes.hover();
    await themes.locator(".sidebar-eye").click();
    await page.locator(".sidebar-visibility", { hasText: "1 hidden" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).waitFor({ state: "detached", timeout: 10_000 });
    await page.locator(".sidebar-visibility").getByRole("button", { name: "Show all" }).click();
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().waitFor({ timeout: 10_000 });
  });

  await step("opens a second repository in a new tab", async () => {
    await page.evaluate(
      ([pick, pullRequests]) => Object.assign(window.__PREVIEW__, { pick, pullRequests }),
      [demos.studio, STUDIO_PULL_REQUESTS],
    );
    await page.getByRole("button", { name: "New tab" }).click();
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

  await step("shows who holds Git LFS locks", async () => {
    await page.locator(".sidebar-locked", { hasText: "Tavern" }).waitFor({ timeout: 15_000 });
  });

  await step("warns about big files that aren't in Git LFS", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".file-warning.large").waitFor({ timeout: 10_000 });
  });

  await step("shows pull requests on their branches", async () => {
    await page.locator(".pr-badge").first().waitFor({ timeout: 10_000 });
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
  }

  await step("opens a branch in a new worktree", async () => {
    await page.locator(".tab", { hasText: "notebook" }).first().dispatchEvent("mousedown", { button: 0 });
    await page.locator(".head-chip", { hasText: "main" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Open in a new worktree" }).click();
    await page.getByRole("button", { name: "Create worktree" }).click();
    await page.locator(".head-chip", { hasText: "feature/themes" }).waitFor({ timeout: 15_000 });
    await page.locator(".tab.active", { hasText: "notebook-feature-themes" }).waitFor({ timeout: 5000 });
    const entries = await page.locator(".sidebar-worktree").count();
    expect(entries === 2, `${entries} worktrees in the sidebar`);
    await dismissToast();
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
    await page.keyboard.press("Escape");
    await page.locator(".context-menu").waitFor({ state: "detached" });
    expect(first && second && first !== second && nextMenu !== second, `focus went ${first} → ${second} → ${nextMenu}`);
  });

  await step("signs in to GitHub with a token", async () => {
    await page.evaluate(() => (window.__PREVIEW__.github = { account: null }));
    await page.keyboard.press("Control+Comma");
    await page.getByRole("button", { name: "Sign in…" }).click();
    await page.getByPlaceholder(/ghp_/).fill("ghp_example");
    await page.locator(".dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    const text = await toast();
    expect(text.includes("Signed in to GitHub as maya-chen"), `toast "${text}"`);
    await page.getByText("Signed in as maya-chen").waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
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

  await step("had no errors on the page", async () => {
    expect(errors.length === 0, errors.join("; "));
  });
} finally {
  await browser.close();
  await preview.close();
  await locks.close();
  rmSync(folder, { recursive: true, force: true });
}

console.log(failed ? `${failed} failed` : "All good");
process.exit(failed ? 1 : 0);
