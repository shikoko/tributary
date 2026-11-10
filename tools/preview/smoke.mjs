// Clicks through the main parts of Tributary in a real browser, on freshly built demo
// repositories, with the app's own Rust code answering: open a repository, select and
// search commits, check out a branch (with uncommitted changes in the way), undo it,
// fetch, open a second tab, and look at Git LFS locks and big files.
//
//   npm run preview:build && npm run preview:smoke [-- --screenshots <folder>]
//
// Needs Playwright with Chromium (`npm install --no-save playwright` and
// `npx playwright install chromium`, if they aren't installed already).

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDemos, demoEnv, STUDIO_PULL_REQUEST_CONVERSATIONS, STUDIO_PULL_REQUEST_DETAILS, STUDIO_PULL_REQUESTS } from "./demo.mjs";
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
    // Two labels on that commit: the one that doesn't fit is a click away.
    await row("Tidy up the settings screen").locator(".ref-pill.more").click();
    await page.locator(".menu-item", { hasText: /origin\/(main|feature\/onboarding)/ }).first().click();
    await page.locator(".menu-item", { hasText: /Highlight origin\/(main|feature\/onboarding)'s history/ }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
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

  await step("offers a hard reset from a branch label, and uses your own colours", async () => {
    await page.locator(".commit-list .ref-pill[title^='Branch feature/export (local']").first().click({ button: "right" });
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
    // may be reading the repository right then, holding git's lock for a moment.)
    for (let tries = 0; ; tries++) {
      try {
        git("stash", "push", "-q", "--include-untracked", "-m", "smoke: bisect");
        break;
      } catch (e) {
        if (tries >= 20 || !String(e).includes("index.lock")) throw e;
        await page.waitForTimeout(150);
      }
    }
    try {
      await page.keyboard.press("F5");
      await row("Fix the note counter in the sidebar").click({ button: "right" });
      await page.locator(".menu-item", { hasText: "Find what broke since this commit (bisect)…" }).click();
      const dialog = page.locator(".dialog", { hasText: "Find the commit that broke it" });
      await dialog.getByRole("button", { name: "Start bisecting" }).click();
      const bar = page.locator(".bisect-bar");
      await bar.filter({ hasText: "then say whether it's good or bad" }).waitFor({ timeout: 10_000 });
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
    // The pull requests' comments from the start: news is what changes after the first look.
    await page.evaluate(
      ([pick, pullRequests, conversations]) => Object.assign(window.__PREVIEW__, { pick, pullRequests, conversations }),
      [demos.studio, STUDIO_PULL_REQUESTS, structuredClone(STUDIO_PULL_REQUEST_CONVERSATIONS)],
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

  await step("shows the team's activity, and highlights a branch from it", async () => {
    await page.locator(".menu-bar-item", { hasText: "View" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "Team Activity" }).click();
    const view = page.locator(".team-view");
    await view.locator(".team-person-card", { hasText: "Rosa Bell" }).waitFor({ timeout: 10_000 });
    const barber = view.locator(".team-branch-card", { has: page.locator(".team-branch-card-name", { hasText: "art/barber-v2" }) });
    await barber.locator(".team-overlap", { hasText: "1 of your files" }).waitFor({ timeout: 5000 });
    await view.locator(".team-lock-card", { hasText: "Tavern.umap" }).waitFor({ timeout: 10_000 });
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

  await step("shows a pull request's reviews and checks", async () => {
    await page.evaluate((details) => Object.assign(window.__PREVIEW__, { pullRequestDetails: details }), STUDIO_PULL_REQUEST_DETAILS);
    await page.locator(".pr-badge", { hasText: "#14" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-merge", { hasText: "changes were asked for" }).waitFor({ timeout: 10_000 });
    await view.locator(".request-check.failure", { hasText: "Audio loudness" }).waitFor({ timeout: 5000 });
    await view.locator(".request-status-said", { hasText: "diego-ramos asked for changes" }).waitFor({ timeout: 5000 });
    // The description and comments are Markdown, shown as such.
    await view.locator(".request-comment-text").first().waitFor({ timeout: 5000 });
    // A check's name opens its page.
    await view.locator(".request-check", { hasText: "Audio loudness" }).getByRole("button").click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/actions/runs/7")), "the check's page didn't open");
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
