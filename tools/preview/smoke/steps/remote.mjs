// The smoke test: Syncing and force pushing, a remote branch renamed, and settings in a repository.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export default async function ({ page, demos, folder, step, expect, dismissToast, row, openNotebook }) {
  await openNotebook();

  await step("syncs a branch with commits on both sides, force pushes it when it was rewritten, and pushes past a hook that fails", async () => {
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
    // A pre-push hook that fails stops a push: the banner says which hook, shows what it
    // printed, and pushes without it when asked.
    writeFileSync(hook, "#!/bin/sh\necho 'Found 2 problems in TEAM.md' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const sam = { ...process.env, GIT_AUTHOR_NAME: "Sam Okafor", GIT_AUTHOR_EMAIL: "sam@example.com", GIT_COMMITTER_NAME: "Sam Okafor", GIT_COMMITTER_EMAIL: "sam@example.com" };
    execFileSync("git", ["-C", demos.notebook, "commit", "-q", "--allow-empty", "-m", "Tidy the team notes"], { env: sam });
    await page.keyboard.press("F5");
    await sync.filter({ hasText: "Push" }).click({ timeout: 15_000 });
    const hooked = page.locator(".hook-failure", { hasText: "The pre-push hook stopped the push" });
    await hooked.locator(".hook-output", { hasText: "Found 2 problems in TEAM.md" }).waitFor({ timeout: 20_000 });
    expect(!git("ls-remote", "origin", "refs/heads/main").startsWith(git("rev-parse", "main")), "the hook didn't stop the push");
    await hooked.getByRole("button", { name: "Push anyway (skip hooks)" }).click();
    await page.locator(".toast", { hasText: "Pushed main to origin" }).waitFor({ timeout: 20_000 });
    expect(git("ls-remote", "origin", "refs/heads/main").startsWith(git("rev-parse", "main")), "main wasn't pushed without the hook");
    await dismissToast();
    rmSync(hook);
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
}
