// The smoke test: Bisecting, resolving conflicts, comparing branches, blame and searching history.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export default async function ({ page, demos, folder, locks, step, accessible, expect, dismissToast, row, scrollList, openNotebook }) {
  await openNotebook();

  await step("starts bisecting from the menu bar, from the newest tag before the checked-out commit", async () => {
    await page.locator(".menu-bar-item", { hasText: "Repository" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: /^History$/ }).hover();
    await page.locator(".menu-item", { hasText: "Find What Broke (Bisect)…" }).click();
    const dialog = page.locator(".dialog", { hasText: "Find the commit that broke it" });
    await dialog.waitFor({ timeout: 5000 });
    const chosen = await dialog.locator("select").evaluate((select) => select.selectedOptions[0]?.textContent ?? "");
    expect(chosen.startsWith("v0.2.0"), `it offered "${chosen}" first, not the v0.2.0 tag`);
    // Another commit to start from: how many commits it'll test follows it.
    const said = () => dialog.locator(".dialog-note-line").innerText();
    const before = await said();
    await dialog.locator("select").selectOption({ label: await dialog.locator("option").last().innerText() });
    expect((await said()) !== before, "choosing another commit didn't change how many there are to test");
    await accessible("starting a bisect from the menu bar");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
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
    await page.getByLabel("Search in").selectOption("everything");
    await box.press("Escape");
  });

  await step("searches everything at once, and lists what it found by kind beside the history", async () => {
    const box = page.getByLabel("Search commits");
    await box.fill("export");
    const results = page.locator(".search-results");
    await results.waitFor({ timeout: 5000 });
    const group = (title) => results.locator(".search-results-group", { has: page.locator(".search-results-title", { hasText: title }) });
    await group("Messages").locator(".search-result", { hasText: "Export notes as Markdown" }).waitFor({ timeout: 10_000 });
    await group("Branches and tags").locator(".search-result", { hasText: "feature/export" }).first().waitFor({ timeout: 5000 });
    await group("Files").locator(".search-result", { hasText: "src/export/markdown.ts" }).waitFor({ timeout: 5000 });
    // In the sidebar's place and as wide: the history, and the search box above it, stay put.
    const left = async (selector) => Math.round((await page.locator(selector).first().boundingBox()).x);
    expect(Math.abs((await left(".search")) - (await left(".commit-list"))) <= 1, `the search box starts at ${await left(".search")}px, the history at ${await left(".commit-list")}px`);
    // Code comes last: once it's there, nothing is still being searched.
    await page.waitForFunction(() => !document.querySelector(".search-results")?.textContent?.includes("searching…"), null, { timeout: 15_000 });
    // The results (the history beside them is faded on purpose, but for the matches).
    await accessible("the results of a search of everything", page, { within: ".search-results" });
    // A message found goes to its commit in the history.
    await group("Messages").locator(".search-result", { hasText: "Export notes as Markdown" }).click();
    await page.locator(".commit-row.selected", { hasText: "Export notes as Markdown" }).waitFor({ timeout: 5000 });
    // A file found searches the commits that changed it.
    await group("Files").locator(".search-result", { hasText: "src/export/markdown.ts" }).click();
    expect((await page.getByLabel("Search in").inputValue()) === "files", "a file found didn't search files");
    expect((await box.inputValue()) === "src/export/markdown.ts", `searching "${await box.inputValue()}"`);
    await results.waitFor({ state: "detached", timeout: 5000 });
    // A prefix searches one kind.
    await page.getByLabel("Search in").selectOption("everything");
    await box.fill("author:priya");
    expect((await page.getByLabel("Search in").inputValue()) === "authors", "author: didn't search authors");
    expect((await box.inputValue()) === "priya", `searching "${await box.inputValue()}"`);
    await page.getByLabel("Search in").selectOption("everything");
    await box.press("Escape");
    await box.press("Escape");
  });
}
