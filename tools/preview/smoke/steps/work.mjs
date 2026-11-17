// The smoke test: Local history, why a file is ignored, shelves and Simple mode, cherry-picking by dragging, and tours.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default async function ({ page, demos, step, expect, toast, dismissToast, row, openNotebook }) {
  await openNotebook();

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
}
