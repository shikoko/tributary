// The smoke test: Worktrees, shortcuts, menus, the smallest window, signing in, who you commit as, signing, remotes, diagnostics and updates.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crowded } from "../../fits.mjs";
import { demoEnv } from "../../demo.mjs";

export default async function ({ page, demos, folder, preview, step, restoreSize, accessible, expect, toast, dismissToast, row, openNotebook }) {
  await openNotebook();

  await step("opens a branch in a new worktree", async () => {
    await page.locator(".tab", { hasText: "notebook" }).first().dispatchEvent("mousedown", { button: 0 });
    await page.locator(".head-chip", { hasText: "main" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Open in a new worktree" }).click();
    await page.getByRole("button", { name: "Create worktree" }).click();
    await page.locator(".head-chip", { hasText: "feature/themes" }).waitFor({ timeout: 15_000 });
    await page.locator(".tab.active", { hasText: "notebook-feature-themes" }).waitFor({ timeout: 5000 });
    // The sidebar reads the worktrees after the tab opens: counted once they're there, as
    // counting straight away found none now and then.
    await page.waitForFunction(() => document.querySelectorAll(".sidebar-worktree").length === 2, null, { timeout: 10_000 }).catch(() => {});
    const entries = await page.locator(".sidebar-worktree").count();
    expect(entries === 2, `${entries} worktrees in the sidebar`);
    await dismissToast();
  });

  await step("lists the keyboard shortcuts in groups, finds one, and fits a short window", async () => {
    const size = page.viewportSize();
    // Shorter than the list: it used to run past the window's top and bottom.
    await page.setViewportSize({ width: 1100, height: 560 });
    try {
      await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
      await page.locator(".menu-item", { hasText: "Keyboard Shortcuts" }).click();
      const dialog = page.locator(".shortcuts-window");
      const rows = dialog.locator(".shortcut-row");
      await rows.filter({ hasText: "Cherry-pick it onto that branch" }).waitFor({ timeout: 5000 });
      const box = await dialog.boundingBox();
      expect(box.y >= 0 && box.y + box.height <= 560, `the window runs from ${box.y} to ${box.y + box.height}, past the 560px window`);
      expect(await dialog.locator(".shortcuts-body").evaluate((element) => element.scrollHeight > element.clientHeight), "the list doesn't scroll inside the window");
      // Each key a keycap of its own: Ctrl and K apart.
      expect((await rows.filter({ hasText: "Command palette" }).locator("kbd").count()) === 2, "the palette's keys aren't two keycaps");
      await accessible("the keyboard shortcuts");
      // Typing finds them in every group: the search box has the keyboard from the start.
      await page.keyboard.type("cherry");
      await page.waitForFunction(() => document.querySelectorAll(".shortcuts-window .shortcut-row").length === 1, null, { timeout: 5000 });
      expect((await rows.first().textContent()).includes("Cherry-pick"), "searching for cherry didn't find the cherry-pick");
      await dialog.locator(".shortcuts-find").fill("");
      // A group on its own, then all again.
      await dialog.locator(".shortcuts-nav button", { hasText: "Tabs" }).click();
      await page.waitForFunction(() => [...document.querySelectorAll(".shortcuts-window .shortcuts-group h3")].map((h) => h.textContent).join() === "Tabs", null, { timeout: 5000 });
      await dialog.locator(".shortcuts-nav button", { hasText: "All" }).click();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 5000 });
    } finally {
      await restoreSize(size);
    }
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
    await accessible("a menu");
    await page.keyboard.press("Escape");
    await page.locator(".context-menu").waitFor({ state: "detached" });
    expect(first && second && first !== second && nextMenu !== second, `focus went ${first} → ${second} → ${nextMenu}`);
  });

  await step("fits the smallest window: the sidebar as a strip, every window a command opens, Settings, About, the View panel and a long menu", async () => {
    // 900 by 560, the smallest the window can be (tauri.conf.json), with the sidebar and the
    // details open: no window inside it runs past its edges out of reach, and no words sit on
    // other words or are cut off without an ellipsis (fits.mjs).
    const size = page.viewportSize();
    await page.setViewportSize({ width: 900, height: 560 });
    const fits = async (where) => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
      const found = await page.evaluate(`(${crowded})()`);
      expect(found.length === 0, `${where}, in the smallest window: ${found.slice(0, 4).join("; ")}`);
    };
    const open = ".dialog-backdrop, .context-menu, .view-panel";
    const closeAll = async () => {
      for (let tries = 0; tries < 4 && (await page.locator(open).count()) > 0; tries++) await page.keyboard.press("Escape");
      await page.locator(open).first().waitFor({ state: "detached", timeout: 5000 });
    };
    const palette = page.getByRole("dialog", { name: "Commands" });
    const command = async (label) => {
      await page.keyboard.press("Control+k");
      await palette.locator("input").fill(label);
      const first = palette.locator("li").first();
      await first.waitFor({ timeout: 5000 });
      // One this repository doesn't offer just now is left out.
      if (!((await first.textContent()) ?? "").startsWith(label)) {
        await page.keyboard.press("Escape");
        return false;
      }
      await page.keyboard.press("Enter");
      await palette.waitFor({ state: "detached", timeout: 5000 });
      await page.waitForTimeout(300);
      return true;
    };
    try {
      await closeAll();
      await fits("the repository");
      // The sidebar is a strip of icons beside the list. One opens it over the list, at its
      // section; Esc closes it, with the focus back on the icon.
      await page.locator(".sidebar-strip").waitFor({ timeout: 5000 });
      expect((await page.locator(".sidebar-frame").count()) === 0, "the sidebar takes its full width in the smallest window");
      const tagsIcon = page.locator(".sidebar-strip-button[data-section=tags]");
      await tagsIcon.click();
      const over = page.locator(".sidebar-over");
      await over.locator('[data-tour="section-tags"] .sidebar-heading[aria-expanded="true"]').waitFor({ timeout: 5000 });
      await fits("the sidebar over the list");
      await accessible("the sidebar's strip, open at Tags");
      // A tag's lane lights up from its label there too, and goes out with the sidebar when
      // Esc closes it under the pointer.
      await over.locator('[data-tour="section-tags"] .sidebar-item').first().hover();
      await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await over.waitFor({ state: "detached", timeout: 5000 });
      await page.waitForFunction(() => !document.querySelector(".commit-list.lane-lit"), null, { timeout: 2000 }).catch(() => {
        throw new Error("a tag's lane stayed lit after its label went with the sidebar");
      });
      expect(await tagsIcon.evaluate((element) => element === document.activeElement), "the focus didn't go back to the strip's Tags icon");
      for (const label of ["Go to Commit", "New Branch", "New Tag", "New Worktree", "Stash Changes", "Prune Branches", "Restore Branch", "Recover Commits", "Find What Broke (Bisect)", "Repository Settings", "Shelves", "Local History", "What Makes It Big", "Check Project Setup", "Clean Up Git LFS Files", "Force Push", "Clone Repository", "Tours", "Third-Party Licences", "Why Is a File Ignored", "Keyboard Shortcuts"]) {
        if (!(await command(label))) continue;
        await fits(label);
        await closeAll();
      }
      // Settings, section by section.
      await page.keyboard.press("Control+,");
      const sections = page.locator(".settings-nav [role=tab]");
      await sections.first().waitFor({ timeout: 5000 });
      for (let index = 0; index < (await sections.count()); index++) {
        await sections.nth(index).click();
        await fits(`Settings → ${((await sections.nth(index).textContent()) ?? "").trim()}`);
      }
      await closeAll();
      // About is taller than the window: it scrolls, from its top down to its buttons.
      expect(await command("About Tributary"), "About Tributary isn't in the command palette");
      await fits("About");
      const about = page.locator(".about-window");
      const backdrop = page.locator(".dialog-backdrop");
      await backdrop.evaluate((element) => element.scrollTo(0, 0));
      expect((await about.boundingBox()).y >= 0, "About's top is out of reach");
      await backdrop.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      const buttons = await about.locator(".dialog-buttons").boundingBox();
      expect(buttons.y + buttons.height <= 560, "About's buttons are out of reach");
      await closeAll();
      // The View panel ends inside the window, and scrolls to the rest.
      await page.keyboard.press("Control+Shift+O");
      const panel = page.locator(".view-panel");
      await panel.waitFor({ timeout: 5000 });
      await fits("the View panel");
      expect(await panel.evaluate((element) => element.scrollHeight > element.clientHeight), "the View panel doesn't scroll in the smallest window");
      await closeAll();
      // The menu bar's View menu, taller than the window: its last item is in reach.
      await page.locator("body").press("F10");
      await page.locator(".context-menu").waitFor({ timeout: 5000 });
      await page.keyboard.press("ArrowRight");
      await fits("the View menu");
      await page.keyboard.press("End");
      const last = await page.evaluate(() => document.activeElement?.getBoundingClientRect().bottom ?? 0);
      expect(last > 0 && last <= 560, `the View menu's last item ends ${Math.round(last)}px down, below the window`);
      await closeAll();
    } finally {
      await restoreSize(size);
    }
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

  await step("lists your SSH keys in Settings, the public key shown only when asked", async () => {
    await page.keyboard.press("Control+,");
    await page.locator(".settings-nav [role=tab]", { hasText: "SSH keys" }).click();
    const card = page.locator(".ssh-key", { hasText: "id_ed25519" });
    await card.waitFor({ timeout: 10_000 });
    expect((await card.innerText()).includes("Ed25519 · maya@studio-laptop"), await card.innerText());
    expect((await card.locator(".ssh-key-fingerprint").innerText()).startsWith("SHA256:"), "no fingerprint");
    // The key itself is hidden until the eye button shows it.
    expect((await card.locator(".ssh-key-public").count()) === 0, "the public key showed before it was asked for");
    await card.getByRole("button", { name: "Show the public key" }).click();
    await card.locator(".ssh-key-public", { hasText: "ssh-ed25519 AAAAC3" }).waitFor({ timeout: 5000 });
    await accessible("Settings → SSH keys");
    await card.getByRole("button", { name: "Hide the public key" }).click();
    await card.locator(".ssh-key-public").waitFor({ state: "detached", timeout: 5000 });
    // Making a new key starts with a name that isn't taken.
    await page.getByRole("button", { name: "Make a new key…" }).click();
    expect((await page.getByLabel("The new key's name").inputValue()) === "id_ed25519_tributary", "the new key's name is one already taken");
    await page.keyboard.press("Escape");
    await page.locator(".settings-window").waitFor({ state: "detached", timeout: 5000 });
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
    // Betas: off to begin with; turning them on looks again, and they're turned off again.
    const beta = about.getByRole("switch", { name: "Get beta versions" });
    expect((await beta.getAttribute("aria-checked")) === "false", "betas are on to begin with");
    await beta.click();
    expect((await beta.getAttribute("aria-checked")) === "true", "betas didn't turn on");
    await about.locator(".about-status.current").waitFor({ timeout: 10_000 });
    await beta.click();
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
    // It said so too, once ready, with Restart.
    const notice = await toast();
    expect(/Tributary 9\.9\.0 is ready/.test(notice), `toast "${notice}"`);
    await dismissToast();
  });
}
