// The smoke test: a branch whose remote branch was rebased elsewhere (on another computer, or
// by an AI working on it) while it still has the old commits: the mark on it, and taking the
// remote branch's version by double-clicking it, with a commit made since put on top.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoEnv } from "../../demo.mjs";

export default async function ({ page, demos, folder, step, expect, accessible, dismissToast, openNotebook }) {
  await openNotebook();
  // As Maya, with the demos' settings: not as whoever runs the test, nor signed as them.
  const maya = { GIT_AUTHOR_NAME: "Maya Chen", GIT_AUTHOR_EMAIL: "maya@example.com", GIT_COMMITTER_NAME: "Maya Chen", GIT_COMMITTER_EMAIL: "maya@example.com" };
  const git = (cwd, ...args) =>
    execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: { ...process.env, ...demoEnv(demos), ...maya } }).trim();
  const notebook = (...args) => git(demos.notebook, ...args);
  const write = (cwd, file, text) => {
    mkdirSync(join(cwd, "rooms"), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };

  // upstairs-rooms, two commits off main, pushed; then, elsewhere, main moves on and the
  // branch is rebased onto it and force-pushed; here, a fetch brings that in.
  const tree = join(folder, "rooms-worktree");
  notebook("worktree", "add", "-q", "-b", "upstairs-rooms", tree, "origin/main");
  for (const [file, text, message] of [
    ["rooms/landing.md", "A narrow landing.\n", "Add the upstairs landing"],
    ["rooms/bedrooms.md", "Three bedrooms.\n", "Sketch the three bedrooms"],
  ]) {
    write(tree, file, text);
    git(tree, "add", file);
    git(tree, "commit", "-q", "-m", message);
  }
  git(tree, "push", "-q", "-u", "origin", "upstairs-rooms");
  notebook("worktree", "remove", "--force", tree);
  const elsewhere = mkdtempSync(join(folder, "elsewhere-"));
  git(elsewhere, "clone", "-q", notebook("remote", "get-url", "origin"), ".");
  writeFileSync(join(elsewhere, "kitchen.md"), "A hearth.\n");
  git(elsewhere, "add", "kitchen.md");
  git(elsewhere, "commit", "-q", "-m", "Furnish the kitchen");
  git(elsewhere, "push", "-q", "origin", "HEAD");
  git(elsewhere, "checkout", "-q", "upstairs-rooms");
  git(elsewhere, "rebase", "-q", "origin/main");
  git(elsewhere, "push", "-q", "--force", "origin", "upstairs-rooms");
  notebook("fetch", "-q", "origin");
  const old = notebook("rev-parse", "upstairs-rooms");
  const rebased = notebook("rev-parse", "origin/upstairs-rooms");
  await page.keyboard.press("F5");

  const remoteLabel = page.locator('.commit-row .ref-pill[data-hint^="Branch origin/upstairs-rooms"]').first();
  const dialog = page.locator(".dialog", { hasText: "origin's" });

  await step("marks a branch whose remote branch was rebased with its commits", async () => {
    const mark = page.locator(".sidebar-item", { hasText: "upstairs-rooms" }).locator(".sidebar-counts.rebased");
    await mark.waitFor({ timeout: 15_000 });
    const title = await mark.getAttribute("title");
    expect(
      title === "Rebased on origin/upstairs-rooms: all 2 of your commits are in its version. Double-click origin/upstairs-rooms to take it.",
      `the mark says "${title}"`,
    );
  });

  await step("offers the rebased version on a double-click, takes it, and undoes it", async () => {
    await remoteLabel.dblclick();
    await dialog.getByRole("heading", { name: "Use origin's upstairs-rooms?" }).waitFor({ timeout: 10_000 });
    expect((await dialog.locator(".rebased-row").count()) === 2, "it doesn't list both commits");
    expect((await dialog.locator(".prune-tag", { hasText: "In origin's" }).count()) === 2, "they aren't both in origin's version");
    await accessible("Use origin's version");
    await dialog.getByRole("button", { name: "Use origin's version" }).click();
    const toast = page.locator(".toast", { hasText: "upstairs-rooms now matches origin/upstairs-rooms" });
    await toast.waitFor({ timeout: 15_000 });
    expect(notebook("rev-parse", "upstairs-rooms") === rebased, "upstairs-rooms isn't origin's version");
    expect(notebook("branch", "--show-current") === "upstairs-rooms", "it isn't checked out");
    await toast.getByRole("button", { name: "Undo" }).click();
    await page.locator(".toast", { hasText: "Moved upstairs-rooms back" }).waitFor({ timeout: 15_000 });
    expect(notebook("rev-parse", "upstairs-rooms") === old, "Undo didn't put its own version back");
    await dismissToast();
  });

  await step("puts a commit made since on top of the rebased version", async () => {
    write(demos.notebook, "rooms/bath.md", "A tub by the window.\n");
    notebook("add", "rooms/bath.md");
    notebook("commit", "-q", "-m", "Add a bath by the window", "--", "rooms/bath.md");
    await page.keyboard.press("F5");
    await page.locator(".sidebar-item", { hasText: "upstairs-rooms" }).locator(".sidebar-counts.rebased").waitFor({ timeout: 15_000 });
    await remoteLabel.dblclick();
    await dialog.getByRole("heading", { name: "1 of your commits isn't in origin's version" }).waitFor({ timeout: 10_000 });
    const onlyHere = dialog.locator(".rebased-row.only-here");
    expect((await onlyHere.count()) === 1, "it doesn't list one commit only here");
    expect((await onlyHere.innerText()).includes("Add a bath by the window"), "the commit only here isn't the bath");
    await dialog.getByRole("button", { name: "Show" }).click();
    await dialog.locator(".prune-tag", { hasText: "In origin's" }).nth(1).waitFor({ timeout: 2000 });
    await dialog.getByRole("button", { name: "Put 1 commit on top" }).click();
    await page.locator(".toast", { hasText: "upstairs-rooms is now origin/upstairs-rooms with 1 commit of yours on top" }).waitFor({ timeout: 15_000 });
    expect(notebook("rev-parse", "upstairs-rooms^") === rebased, "the commit isn't on top of origin's version");
    expect(notebook("log", "-1", "--format=%s", "upstairs-rooms") === "Add a bath by the window", "the bath isn't on top");
    await dismissToast();
  });
}
