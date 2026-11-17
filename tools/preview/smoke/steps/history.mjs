// The smoke test: Opening a repository, its commits and their files, checking out, stashing, fetching, tags, resets and wrapping lines.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default async function ({ page, demos, step, accessible, expect, toast, dismissToast, row, scrollList }) {
  await step("shows the welcome screen", async () => {
    await page.getByText("Open repository").first().waitFor();
    await accessible("the welcome screen");
  });

  await step("opens a repository", async () => {
    await page.getByText("Open repository").first().click();
    await page.waitForSelector(".commit-row");
    const rows = await page.locator(".commit-row").count();
    expect(rows > 20, `only ${rows} rows`);
    await page.waitForSelector(".summary.wip", { timeout: 5000 });
  });

  await step("starts the search box where the history starts, with the sidebar shown or hidden", async () => {
    // What happened, for when this fails on CI and nowhere else: every click and key, the
    // sidebar's button and frame coming and going, and every tenth of a second where the
    // history and the search box start.
    await page.evaluate(() => {
      const started = performance.now();
      const log = (window.__sidebarLog = []);
      const at = () => `${Math.round(performance.now() - started)}ms`;
      const name = (element) => (element instanceof Element ? `${element.tagName.toLowerCase()}${element.getAttribute("aria-label") ? `[${element.getAttribute("aria-label")}]` : ""}.${[...element.classList].join(".")}` : String(element));
      for (const type of ["click", "keydown"]) window.addEventListener(type, (event) => log.push(`${at()} ${type} ${event.key ?? name(event.target)}`), true);
      const toggle = document.querySelector("[aria-label='Toggle the branches sidebar']");
      new MutationObserver(() => log.push(`${at()} pressed=${toggle?.getAttribute("aria-pressed")}`)).observe(toggle, { attributes: true, attributeFilter: ["aria-pressed"] });
      new MutationObserver((changes) => {
        for (const change of changes) {
          for (const node of change.addedNodes) if (node instanceof Element && node.matches(".sidebar-frame, .sidebar-over, .sidebar-strip")) log.push(`${at()} + ${name(node)}`);
          for (const node of change.removedNodes) if (node instanceof Element && node.matches(".sidebar-frame, .sidebar-over, .sidebar-strip")) log.push(`${at()} - ${name(node)}`);
        }
      }).observe(document.body, { childList: true, subtree: true });
      let last = "";
      const sample = () => {
        const left = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().left ?? -1);
        const frame = document.querySelector(".sidebar-frame");
        const now = `list ${left(".commit-list")} search ${left(".search")} frame ${frame ? Math.round(frame.getBoundingClientRect().width) : "none"}${frame?.classList.contains("closing") ? " closing" : ""} stored ${localStorage.getItem("tributary.sidebar.open")} tabs ${document.querySelectorAll(".tab").length} lists ${document.querySelectorAll(".commit-list").length} toggles ${document.querySelectorAll("[aria-label='Toggle the branches sidebar']").length}`;
        if (now !== last) log.push(`${at()} ${now}`);
        last = now;
      };
      sample();
      window.__sidebarSampler = setInterval(sample, 100);
    });
    const said = async () => `; what happened: ${await page.evaluate(() => window.__sidebarLog.join(" | ")).catch(() => "(no log)")}`;
    const left = async (selector) => Math.round((await page.locator(selector).first().boundingBox()).x);
    const lined = async (when) => {
      // Once the sidebar has finished coming or going.
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"), null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => Math.abs(document.querySelector(".search").getBoundingClientRect().left - document.querySelector(".commit-list").getBoundingClientRect().left) <= 1, null, { timeout: 3000 }).catch(() => {});
      const search = await left(".search");
      const list = await left(".commit-list");
      expect(Math.abs(search - list) <= 1, `${when}, the search box starts at ${search}px and the history at ${list}px${Math.abs(search - list) <= 1 ? "" : await said()}`);
    };
    const toggle = page.getByRole("button", { name: "Toggle the branches sidebar" });
    try {
      await lined("with the sidebar");
      await toggle.click();
      await page.locator(".sidebar-frame").waitFor({ state: "detached", timeout: 5000 });
      // Without the sidebar, the history starts at the window's edge: the search box follows the branch's chip.
      await page.waitForFunction(() => document.querySelector(".search").getBoundingClientRect().left < 200, null, { timeout: 3000 }).catch(() => {});
      const repo = await page.locator(".toolbar-repo").boundingBox();
      const search = await left(".search");
      const follows = search > repo.x + repo.width && search < repo.x + repo.width + 40;
      expect(follows, `without the sidebar, the search box starts at ${search}px${follows ? "" : await said()}`);
      await toggle.click();
      await page.locator(".sidebar-frame").waitFor({ timeout: 5000 });
      await lined("with the sidebar back");
    } finally {
      // Shown again whatever happened above: the steps after this one use the sidebar.
      await page.evaluate(() => clearInterval(window.__sidebarSampler)).catch(() => {});
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      await page.locator(".sidebar-frame:not(.closing)").waitFor({ timeout: 5000 });
    }
  });

  await step("offers to update a submodule a pull left behind, and updates it", async () => {
    const banner = page.locator(".notice-banner", { hasText: "editor-kit" });
    await banner.waitFor({ timeout: 10_000 });
    await page
      .locator(".sidebar-submodule", { hasText: "out of date" })
      .waitFor({ timeout: 5000 })
      .catch(async (error) => {
        const sidebar = await page.evaluate(() => ({
          pressed: document.querySelector("[aria-label='Toggle the branches sidebar']")?.getAttribute("aria-pressed"),
          frame: document.querySelector(".sidebar-frame")?.className ?? "none",
          submodules: [...document.querySelectorAll(".sidebar-submodule")].map((row) => row.innerText.replace(/\s+/g, " ")),
          tabs: document.querySelectorAll(".tab").length,
          lists: document.querySelectorAll(".commit-list").length,
        }));
        throw new Error(`${error.message.split("\n")[0]} (the sidebar: ${JSON.stringify(sidebar)})`);
      });
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
    // It's near the end, which isn't drawn until it's scrolled to: how near depends on how
    // many days the commits cross, which depends on the time of day the demo is made.
    await scrollList("end");
    await row("Add the note model").click();
    await page.locator(".details", { hasText: "Sam Okafor" }).waitFor({ timeout: 5000 });
    await accessible("a commit's details");
    await scrollList("top");
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
    const exportLabel = page.locator(".commit-list .ref-pill:is([title^='Branch feature/export (local)'], [data-hint^='Branch feature/export (local)'])");
    await exportLabel.locator(".ref-sync", { hasText: "↓" }).waitFor({ timeout: 10_000 });
    expect((await exportLabel.getAttribute("data-hint"))?.includes("behind origin/feature/export"), "the label doesn't say it's behind");
    await dismissToast();
  });

  await step("makes a tag in a dialog, and undoes it", async () => {
    await scrollList("end");
    await row("Add the note model").click({ button: "right" });
    await page.locator(".menu-item", { hasText: "New tag here" }).click();
    await page.getByPlaceholder("v1.2.0").fill("v0.0.9");
    await accessible("the new tag dialog");
    await page.getByRole("button", { name: "Create tag" }).click();
    const tag = page.locator(".ref-pill", { hasText: "v0.0.9" });
    await tag.first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".ref-pill")].some((pill) => pill.textContent?.includes("v0.0.9")), null, { timeout: 10_000 });
    await dismissToast();
    await scrollList("top");
  });

  await step("offers a hard reset from a branch label, and uses your own colours", async () => {
    await page.locator(".commit-list .ref-pill:is([title^='Branch feature/export (local'], [data-hint^='Branch feature/export (local'])").first().click({ button: "right" });
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
    await accessible("a file's changes");
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

  await step("shows an SVG as a picture, and pictures written into a stylesheet under their lines", async () => {
    await row("High-contrast theme").click();
    const view = page.locator(".diff-view");
    // The logo, a drawing: before and after at its own size, and line by line as well.
    await page.locator(".details .file", { hasText: "logo.svg" }).first().click();
    await view.locator(".diff-image img").nth(1).waitFor({ timeout: 10_000 });
    await view.locator(".diff-media-facts", { hasText: "64 × 64" }).first().waitFor({ timeout: 5000 });
    await view.getByRole("button", { name: "Text", exact: true }).click();
    await view.locator(".diff-row.added").first().waitFor({ timeout: 5000 });
    await view.getByRole("button", { name: "Picture", exact: true }).click();
    await view.locator(".diff-image img").first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // The theme icons, written into a stylesheet: each folded into a label, and the three
    // that changed shown before → after under their lines.
    await page.locator(".details .file", { hasText: "icons.css" }).first().click();
    await view.locator(".diff-picture-chip", { hasText: "PNG picture" }).first().waitFor({ timeout: 10_000 });
    const changed = await view.locator(".diff-picture-inline").count();
    expect(changed === 3, `${changed} pictures shown as changed`);
    expect((await view.locator(".diff-text", { hasText: "base64," }).count()) === 0, "a picture's letters still showing");
    await accessible("pictures written into a stylesheet");
    // Compared in full: a 32 × 32 icon, made bigger in whole steps.
    await view.getByRole("button", { name: "Compare" }).first().click();
    await view.locator(".diff-picture-inline .diff-image img").nth(1).waitFor({ timeout: 5000 });
    await view.locator(".diff-media-facts", { hasText: "32 × 32, shown 8× bigger" }).first().waitFor({ timeout: 5000 });
    // A label shows the letters it folded when clicked.
    await view.locator(".diff-picture-chip").first().click();
    await view.locator(".diff-text", { hasText: "data:image/png;base64," }).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("wraps long lines when asked, and remembers it", async () => {
    const store = join(demos.notebook, "src", "store.ts");
    const before = readFileSync(store, "utf8");
    writeFileSync(store, `${before}// ${"How notebooks are kept, a note that goes on and on. ".repeat(6).trim()}\n`);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
      const open = async () => {
        await page.locator(".details .file", { hasText: "store.ts" }).first().click();
        await view.locator(".diff-row.added", { hasText: "goes on and on" }).waitFor({ timeout: 10_000 });
      };
      const close = async () => {
        await view.getByRole("button", { name: "Close the changes" }).click();
        await view.waitFor({ state: "detached", timeout: 5000 });
      };
      const view = page.locator(".diff-view");
      const wrap = view.getByRole("button", { name: "Wrap lines" });
      const pressed = async () => (await wrap.getAttribute("aria-pressed")) === "true";
      const sideways = () => view.locator(".diff-body").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      await open();
      expect(!(await pressed()) && (await sideways()), "the long line didn't need scrolling to");
      await wrap.click();
      expect(!(await sideways()), "wrapped, the changes still scroll sideways");
      const tall = (await view.locator(".diff-row.added", { hasText: "goes on and on" }).boundingBox()).height;
      expect(tall >= 40, `the wrapped line is ${tall}px tall`);
      // Remembered the next time.
      await close();
      await open();
      expect(await pressed(), "Wrap lines wasn't remembered");
      // Side by side, lines always wrap: pressed, and not to be turned off there.
      await view.getByRole("button", { name: "Side by side" }).click();
      await view.locator(".diff-split-row").first().waitFor({ timeout: 5000 });
      expect((await pressed()) && (await wrap.isDisabled()), "side by side, Wrap lines isn't pressed and greyed");
      await view.getByRole("button", { name: "Side by side" }).click();
      await view.locator(".diff-row").first().waitFor({ timeout: 5000 });
      await wrap.click();
      expect(await sideways(), "unwrapped again, the long line doesn't need scrolling to");
      await close();
    } finally {
      writeFileSync(store, before);
    }
  });
}
