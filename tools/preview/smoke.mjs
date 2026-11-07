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
