// The smoke test: Your changes: staging files, folders and lines, discarding, and fixing up a commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default async function ({ page, demos, folder, step, accessible, expect, dismissToast, row, openNotebook }) {
  // The editor kit as the history steps leave it, updated: the demo has it a version behind,
  // as after a pull, which no discard puts right.
  execFileSync("git", ["-C", demos.notebook, "submodule", "update", "--quiet"]);
  await openNotebook();

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
    // Read the files again (F5): the window getting the focus would too, unless it was just
    // reloaded, as the step before has.
    await page.keyboard.press("F5");
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

  await step("commits to a new branch from the Commit button's menu, as main is protected", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.notebook, ...args], { encoding: "utf8" }).trim();
    const main = git("rev-parse", "main");
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const button = page.locator(".commit-box .commit-button");
    // The button says where the commit goes, and main being protected suggests a new branch.
    await button.locator(".commit-branch", { hasText: "main" }).waitFor({ timeout: 10_000 });
    await page.locator(".commit-protected", { hasText: "main is protected" }).waitFor({ timeout: 5000 });
    await page.getByPlaceholder("Commit summary").fill("Welcome tour for new notebooks");
    await page.getByRole("button", { name: "Where to commit" }).click();
    await page.locator(".menu-item", { hasText: "Commit to a new branch…" }).click();
    // Named from the summary, and the button follows the name.
    const name = page.getByRole("textbox", { name: "New branch's name" });
    expect((await name.inputValue()) === "welcome-tour-for-new-notebooks", `named ${await name.inputValue()}`);
    await button.locator(".commit-branch", { hasText: "welcome-tour-for-new-notebooks" }).waitFor({ timeout: 5000 });
    expect((await page.locator(".commit-protected").count()) === 0, "the protected note stayed with a new branch chosen");
    // A name too long for the button loses its folders first.
    await name.fill("feature/onboarding/welcome-tour-for-new-notebooks");
    await button.locator(".commit-branch-folder", { hasText: "…/" }).waitFor({ timeout: 5000 });
    expect((await button.getAttribute("title")).includes("feature/onboarding/welcome-tour-for-new-notebooks"), "the whole name isn't in the tooltip");
    await name.fill("welcome-tour");
    await accessible("committing to a new branch");
    await button.click();
    await row("Welcome tour for new notebooks").waitFor({ timeout: 15_000 });
    expect(git("branch", "--show-current") === "welcome-tour", `on ${git("branch", "--show-current")}`);
    expect(git("log", "-1", "--format=%s") === "Welcome tour for new notebooks", "the commit isn't on the new branch");
    expect(git("rev-parse", "main") === main, "main moved");
    await button.locator(".commit-branch", { hasText: "welcome-tour" }).waitFor({ timeout: 5000 });
    await dismissToast();
  });
}
