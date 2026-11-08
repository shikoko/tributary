// Clicks through the main parts of Tributary in a real browser, on freshly built demo
// repositories, with the app's own Rust code answering: open a repository, select and
// search commits, check out a branch (with uncommitted changes in the way), undo it,
// fetch, open a second tab, and look at Git LFS locks and big files.
//
//   npm run preview:build && npm run preview:smoke [-- --screenshots <folder>]
//
// Needs Playwright with Chromium (`npm install --no-save playwright` and
// `npx playwright install chromium`, if they aren't installed already).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDemos, demoEnv, STUDIO_PULL_REQUESTS } from "./demo.mjs";
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
const preview = await startPreview({ port: 0, quiet: true, env: demoEnv(demos) });
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
    console.log(`  ✗ ${name}\n      ${String(error.message ?? error).split("\n").slice(0, 3).join("\n      ")}`);
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
/** Scroll the commit list to its end (only the rows on screen are drawn), or back to the top. */
const scrollList = (where) => page.locator(".list-scroller").evaluate((el, end) => el.scrollTo(0, end ? el.scrollHeight : 0), where === "end");

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
    // A teammate merged main into feature/export: the local branch's label says it's behind.
    const exportLabel = page.locator(".commit-list .ref-pill[title^='Branch feature/export (local)']");
    await exportLabel.locator(".ref-sync", { hasText: "↓" }).waitFor({ timeout: 10_000 });
    expect((await exportLabel.getAttribute("title"))?.includes("behind origin/feature/export"), "the label doesn't say it's behind");
    await dismissToast();
  });

  await step("makes a tag in a dialog, and undoes it", async () => {
    await scrollList("end");
    await row("Add the note model").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "New tag here" }).click();
    await page.getByPlaceholder("v1.2.0").fill("v0.0.9");
    await page.getByRole("button", { name: "Create tag" }).click();
    const tag = page.locator(".ref-pill", { hasText: "v0.0.9" });
    await tag.first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".ref-pill")].some((pill) => pill.textContent?.includes("v0.0.9")), null, { timeout: 10_000 });
    await dismissToast();
    await scrollList("top");
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
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // Esc closed the changes, not the details.
    await page.locator(".details", { hasText: "Priya Nair" }).waitFor({ timeout: 5000 });
  });

  await step("shows your changes, and follows a file you stage", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.locator(".details .file", { hasText: "README.md" }).click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-row.added", { hasText: "Onboarding" }).first().waitFor({ timeout: 10_000 });
    await view.locator(".diff-source", { hasText: "Not staged" }).waitFor({ timeout: 5000 });
    // Step to another file and back with [ and ].
    const [at, of] = (await view.locator(".diff-count").innerText()).split(" of ").map(Number);
    await page.keyboard.press(at < of ? "]" : "[");
    await view.locator(".diff-name", { hasText: "README.md" }).waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press(at < of ? "[" : "]");
    await view.locator(".diff-name", { hasText: "README.md" }).waitFor({ timeout: 5000 });
    await page.locator(".details .file", { hasText: "README.md" }).hover();
    await page.getByRole("button", { name: "Stage README.md", exact: true }).click();
    await view.locator(".diff-source", { hasText: "Staged" }).waitFor({ timeout: 10_000 });
    await page.locator(".details .file.shown", { hasText: "README.md" }).hover();
    await page.getByRole("button", { name: "Unstage README.md", exact: true }).click();
    await view.locator(".diff-source", { hasText: "Not staged" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
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
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
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
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator(".operation-bar").waitFor({ state: "detached", timeout: 10_000 });
  });

  await step("compares a branch with the checked-out one, and opens a file's change", async () => {
    await page.locator(".commit-list .ref-pill[title^='Branch feature/export (local']").first().click({ button: "right" });
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

  await step("shows a sound, a video and a 3D model as what they are", async () => {
    await row("A slower door with a longer creak").click();
    await page.locator(".details .file", { hasText: "DoorCreak.wav" }).click();
    const view = page.locator(".diff-view");
    await view.locator(".diff-waveform").nth(1).waitFor({ timeout: 10_000 });
    await view.locator(".diff-media-facts", { hasText: "0:01.6" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("]");
    await view.locator(".diff-media-facts", { hasText: "0:03.0 · 320×180" }).waitFor({ timeout: 10_000 });
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
    await files.locator("h3", { hasText: "2,400 changed files" }).waitFor({ timeout: 10_000 });
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
    await page.getByRole("tab", { name: "Accounts" }).click();
    await page.getByRole("button", { name: "Sign in…" }).click();
    await page.getByPlaceholder(/ghp_/).fill("ghp_example");
    await page.locator(".dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    const text = await toast();
    expect(text.includes("Signed in to GitHub as maya-chen"), `toast "${text}"`);
    await page.getByText("Signed in as maya-chen").waitFor({ timeout: 5000 });
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
