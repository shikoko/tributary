// The smoke test: Git LFS locks and big files, assets changed elsewhere, the team, and what files look like: pictures, textures, sounds, models, trees, huge commits and diff tools.

export default async function ({ page, folder, locks, preview, step, accessible, expect, dismissToast, row, openNotebook, openStudio }) {
  await openNotebook();
  await openStudio();

  await step("shows who holds Git LFS locks", async () => {
    await page.locator(".sidebar-locked", { hasText: "Tavern" }).waitFor({ timeout: 15_000 });
    await accessible("the repository, with its locks");
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
    await accessible("the team's activity");
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

  await step("lists your forks on GitHub once Settings shows them, syncs them, and keeps one in sync by itself", async () => {
    const { demoForks } = await import("../../demo.mjs");
    // The four made-up forks, and one more behind its original, for Auto to sync.
    const maps = structuredClone(demoForks()[1]);
    Object.assign(maps.fork, { name: "inn-maps", url: "https://github.com/maya-chen/inn-maps" });
    Object.assign(maps.fork.parent, { name: "inn-maps", url: "https://github.com/typeforge/inn-maps" });
    maps.status = { new: 2, own: 0, commits: maps.status.commits.slice(0, 2) };
    const before = await page.evaluate((forks) => {
      const was = window.__PREVIEW__.github;
      window.__PREVIEW__.github = { account: { login: "maya-chen", name: "Maya Chen" }, forks };
      localStorage.removeItem("tributary.forks.run");
      return was ?? null;
    }, [...demoForks(), maps]);
    try {
      expect((await page.getByRole("button", { name: "Your forks" }).count()) === 0, "the Forks button showed before Settings showed your forks");
      await page.keyboard.press("Control+Comma");
      await page.getByRole("tab", { name: "Forks" }).click();
      await page.getByRole("switch", { name: "Your forks" }).click();
      await page.keyboard.press("Escape");
      await page.locator(".sidebar-frame").waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "Your forks" }).click();
      const view = page.locator(".forks-view");
      // They aren't about this repository: its side panels make way while they're open.
      await page.locator(".sidebar-frame").waitFor({ state: "detached", timeout: 5000 });
      await page.locator(".details-frame").waitFor({ state: "detached", timeout: 5000 });
      const fonts = view.getByRole("listitem", { name: "maya-chen/pixel-fonts" });
      await fonts.getByRole("img", { name: "0 of its own, 7 new" }).waitFor({ timeout: 10_000 });
      await view.locator(".forks-summary", { hasText: "5 forks of yours on GitHub · 4 behind their originals" }).waitFor({ timeout: 5000 });
      await accessible("your forks");
      // Auto turned on, the fork syncs by itself a few seconds later, and its row shows it
      // as if its Sync had been pressed. Auto is remembered by the fork's name.
      const maps = view.getByRole("listitem", { name: "maya-chen/inn-maps" });
      await view.getByRole("switch", { name: "Sync maya-chen/inn-maps by itself" }).click();
      const auto = await page.evaluate(() => JSON.parse(localStorage.getItem("tributary.forks.auto")));
      expect(JSON.stringify(auto) === JSON.stringify(["maya-chen/inn-maps"]), `auto ${JSON.stringify(auto)}`);
      await maps.locator(".forks-state.good", { hasText: "Synced" }).waitFor({ timeout: 15_000 });
      await maps.getByRole("img", { name: "0 of its own, 0 new" }).waitFor({ timeout: 5000 });
      await view.locator(".forks-summary", { hasText: "5 forks of yours on GitHub · 3 behind their originals" }).waitFor({ timeout: 5000 });
      await view.getByRole("switch", { name: "Sync maya-chen/inn-maps by itself" }).click();
      // Opened, it lists the original's new commits.
      await fonts.locator(".forks-name").click();
      await fonts.getByText("Kerning for the small sizes").waitFor({ timeout: 5000 });
      // One syncs by itself.
      await view.getByRole("button", { name: "Sync maya-chen/pixel-fonts" }).click();
      await fonts.locator(".forks-state.good", { hasText: "Synced" }).waitFor({ timeout: 5000 });
      await fonts.getByText("Synced: it moved straight on to the original's commits.").waitFor({ timeout: 5000 });
      // Then the other two together: the button stays pressed, turning, until both are done,
      // without going back to a count on the way.
      const all = view.locator(".forks-top").getByRole("button");
      await all.filter({ hasText: "Sync 2 behind" }).waitFor({ timeout: 5000 });
      const seen = await page.evaluate(async () => {
        const button = document.querySelector(".forks-top button");
        button.click();
        const states = [];
        const start = performance.now();
        while (performance.now() - start < 10_000) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          states.push(`${button.disabled ? "off" : "on"} ${button.textContent}`);
          if (!document.querySelector(".forks-view .spin")) break;
        }
        return states;
      });
      expect(
        seen.length > 2 && seen.slice(0, -1).every((state) => state === "off Syncing…") && seen[seen.length - 1] === "off Sync",
        `Sync all went ${JSON.stringify([...new Set(seen)])}`,
      );
      // One's own changes clash with its original's: it says so, and what to do.
      const lantern = view.getByRole("listitem", { name: "maya-chen/lantern-ui" });
      const tavern = view.getByRole("listitem", { name: "maya-chen/tavern-assets" });
      await tavern.locator(".forks-state.good", { hasText: "Synced" }).waitFor({ timeout: 5000 });
      await view.locator(".forks-summary", { hasText: "5 forks of yours on GitHub · 1 behind its original" }).waitFor({ timeout: 5000 });
      await lantern.getByRole("button", { name: "Clashes: what to do about maya-chen/lantern-ui" }).click();
      await lantern.getByText(/GitHub couldn't sync it by itself/).waitFor({ timeout: 5000 });
      await accessible("your forks, after syncing three");
      const synced = await page.evaluate(() => window.__PREVIEW__.syncedForks);
      expect(
        JSON.stringify(synced) === JSON.stringify(["maya-chen/inn-maps", "maya-chen/pixel-fonts", "maya-chen/lantern-ui", "maya-chen/tavern-assets"]),
        `synced ${JSON.stringify(synced)}`,
      );
      await page.keyboard.press("Escape");
      await view.waitFor({ state: "detached", timeout: 5000 });
      await page.locator(".sidebar-frame").waitFor({ timeout: 5000 });
    } finally {
      // As it was: your forks out of sight, and GitHub as before.
      await page.keyboard.press("Control+Comma");
      await page.getByRole("tab", { name: "Forks" }).click();
      const shown = page.getByRole("switch", { name: "Your forks" });
      if ((await shown.getAttribute("aria-checked")) === "true") await shown.click();
      await page.keyboard.press("Escape");
      await page.evaluate((was) => (window.__PREVIEW__.github = was ?? undefined), before);
    }
    // The toolbar's: the message after Auto synced one has a Your forks button too.
    expect((await page.locator(".toolbar").getByRole("button", { name: "Your forks", exact: true }).count()) === 0, "the Forks button stayed after Settings hid your forks");
  });

  await step("offers to release your locks after pushing", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.getByRole("button", { name: "Unstage all" }).click();
    // Wait for the lists to settle: Theme.wav moves above Barber.uasset.
    await page.locator(".files h3", { hasText: "Staged" }).locator(".hint", { hasText: "0 files" }).waitFor({ timeout: 10_000 });
    await page.locator(".file", { hasText: "Barber.uasset" }).hover();
    await page.getByRole("button", { name: "Stage Content/Characters/Barber.uasset" }).click();
    await page.getByPlaceholder("Commit summary").fill("Tweak the barber's apron");
    await page.locator(".commit-box .commit-button").click();
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

  await step("shows a commit's files in a tree of their folders, and closes one", async () => {
    // The fireplace commit, from the step before: actors in the level's folders, the folders
    // with nothing else in them joined into one row, with what changed inside it.
    const files = page.locator(".details .files");
    await files.getByRole("button", { name: "Tree", exact: true }).click();
    const top = files.locator(".file-folder-toggle").first();
    await top.waitFor({ timeout: 5000 });
    const said = await top.evaluate((button) => `${button.querySelector(".file-folder-name").textContent}: ${document.getElementById(button.getAttribute("aria-describedby")).textContent}`);
    expect(/^Content\/__ExternalActors__\/Maps\/Tavern: .*\d+ changed/.test(said), `said "${said}"`);
    const open = await files.locator(".file").count();
    expect(open > 2, `${open} rows`);
    await files.locator(".file-name.actor", { hasText: "SM_Bench_Long" }).waitFor({ timeout: 5000 });
    await accessible("a commit's files as a tree");
    await top.click();
    expect((await top.getAttribute("aria-expanded")) === "false" && (await files.locator(".file").count()) === 1, "closed");
    await top.click();
    expect((await files.locator(".file").count()) === open, "open again");
    // Back to the list, which the steps after expect (the choice is remembered).
    await files.getByRole("button", { name: "List", exact: true }).click();
    await top.waitFor({ state: "detached", timeout: 5000 });
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
    await files.locator(".details-section-head", { hasText: "Changed files" }).filter({ hasText: "2,400" }).waitFor({ timeout: 10_000 });
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
}
