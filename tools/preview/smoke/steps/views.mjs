// The smoke test: Going to a commit, pruning branches, the light theme and the catalogue.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export default async function ({ page, demos, folder, preview, step, accessible, expect, dismissToast, row, openNotebook, openStudio }) {
  await openNotebook();
  await openStudio();
  // Back on the notebook, which the steps start from (prune goes to the studio and back).
  await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
  await row("Export notes as Markdown").waitFor({ timeout: 10_000 });

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
}
