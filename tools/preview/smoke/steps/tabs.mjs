// The smoke test: Tabs: a second repository, what each remembers, what arrived since, spelling, moving, reopening and sizing them.
import { execFileSync } from "node:child_process";
import { studioFakes } from "../session.mjs";
import { moving } from "../../../e2e/centred.mjs";
import { decodePng } from "../../../e2e/png.mjs";

export default async function ({ page, demos, step, restoreSize, accessible, expect, row, openNotebook }) {
  await openNotebook();

  await step("opens a second repository in a new tab", async () => {
    // The studio's pull requests, comments and checks, faked (session.mjs).
    await page.evaluate((fakes) => Object.assign(window.__PREVIEW__, fakes), studioFakes(demos));
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

  await step("says what arrived since you were last here, without moving the list", async () => {
    const tab = (name) => page.locator(".tab", { hasText: name });
    // Away from the studio, and as if its main had been 6 commits back then, two days ago.
    await tab(/^notebook$/).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    const git = (...args) => execFileSync("git", ["-C", demos.studio, ...args], { encoding: "utf8" }).trim();
    const was = git("rev-parse", "origin/main~6");
    // Your own commits (Maya Chen's, in the demos) aren't counted.
    const others = git("log", "--format=%ae", `${was}..origin/main`).split("\n").filter((email) => email && email !== "maya@example.com").length;
    await page.evaluate(([path, was]) => localStorage.setItem(`tributary.seen.${path}`, JSON.stringify({ at: Date.now() - 2 * 86_400_000, tips: { "origin/main": was } })), [demos.studio, was]);
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    const banner = page.locator(".since-banner");
    await banner.waitFor({ timeout: 10_000 });
    const said = (await banner.innerText()).replace(/\s+/g, " ").trim();
    expect(new RegExp(`^Since \\w+: ${others} new commits on main from \\w+`).test(said), `it said "${said}" (${others} new commits by others)`);
    // Nothing moved: the list is at its top, with the newest commits.
    expect((await page.locator(".list-scroller").evaluate((list) => list.scrollTop)) === 0, "the list was scrolled");
    await accessible("what arrived since you were last here");
    // The count goes to where you left off.
    await banner.getByRole("button", { name: `${others} new commits` }).click();
    await page.locator(`#commit-${was}.selected`).waitFor({ timeout: 10_000 });
    // Dismissed, it's gone, and coming back finds nothing new.
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await banner.waitFor({ state: "detached", timeout: 5000 });
    await tab(/^notebook$/).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    expect((await banner.count()) === 0, "it said what arrived again, with nothing new since");
  });

  await step("checks the spelling of commit messages, with the webview's menu for suggestions", async () => {
    await page.locator(".tab", { hasText: /^notebook$/ }).dispatchEvent("mousedown", { button: 0 });
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    const summary = page.getByPlaceholder("Commit summary");
    const description = page.getByLabel("Commit description");
    await summary.waitFor({ timeout: 5000 });
    for (const field of [summary, description]) {
      const checked = await field.evaluate((element) => element.spellcheck);
      expect(checked, `${await field.getAttribute("aria-label")} isn't spell-checked`);
    }
    // A right-click keeps the webview's own menu, with its suggestions, only in text fields.
    const prevented = (locator) =>
      locator.evaluate((element) => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(!(await prevented(description)), "the description's own menu was stopped");
    expect(!(await prevented(summary)), "the summary's own menu was stopped");
    expect(await prevented(page.locator("body")), "the webview's menu showed outside a text field");
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("puts a tab elsewhere by dragging it, or from the keyboard", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const order = async () => (await tabs.allTextContents()).map((name) => name.trim()).join(", ");
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("tributary.tabs.list")).map((tab) => tab.name).join(", "));
    const before = await order();
    // The last tab, dragged in steps past the first one's middle: it goes first, and stays.
    const last = tabs.last();
    const name = (await last.textContent()).trim();
    const from = await last.boundingBox();
    const to = await tabs.first().boundingBox();
    const y = from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + 8 - from.x - from.width / 2) * i) / 10, y);
    await page.mouse.up();
    await page.waitForFunction((first) => document.querySelector(".tabs > .tab[data-path]")?.textContent.trim() === first, name, { timeout: 5000 });
    expect((await stored()).startsWith(name), `the new order wasn't kept: ${await stored()}`);
    // Ctrl+Shift+Page Down moves it (now open) back one place.
    await page.keyboard.press("Control+Shift+PageDown");
    await page.waitForFunction((expected) => [...document.querySelectorAll(".tabs > .tab[data-path]")].map((tab) => tab.textContent.trim()).join(", ") === expected, before, { timeout: 5000 });
    // Escape halfway through a drag puts it back.
    const again = await tabs.last().boundingBox();
    await page.mouse.move(again.x + again.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(again.x + again.width / 2 - i * 25, y);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect((await order()) === before, `Escape didn't put it back: ${await order()}`);
    await page.locator(".tab", { hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("reopens closed tabs in their places, from the keyboard or a tab's menu", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const tab = (name) => tabs.filter({ hasText: name });
    const order = async () => (await tabs.allTextContents()).map((name) => name.trim()).join(", ");
    const tabMenu = async (name, item) => {
      await tab(name).click({ button: "right" });
      await page.locator(".menu-item", { hasText: item }).click();
    };
    const before = await order();
    // A tab closed from its menu comes back with Ctrl+Shift+R, where it was, and open.
    await tabMenu(/^notebook$/, "Close tab");
    await tab(/^notebook$/).waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Control+Shift+R");
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    expect((await order()) === before, `reopened, the tabs are ${await order()}, not ${before}`);
    // The others, closed at once, come back one by one from a tab's menu, each in its place.
    await tabMenu("studio", "Close other tabs");
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
    expect((await tabs.count()) === 1, `${await tabs.count()} tabs after closing the others`);
    for (let left = before.split(", ").length - 1; left > 0; left--) {
      await tabMenu("studio", "Reopen closed tab");
      await page.waitForFunction((count) => document.querySelectorAll(".tabs > .tab[data-path]").length === count, before.split(", ").length - left + 1, { timeout: 10_000 });
    }
    expect((await order()) === before, `reopened, the tabs are ${await order()}, not ${before}`);
    // Nothing left to reopen.
    await tab("studio").click({ button: "right" });
    expect(await page.locator(".menu-item", { hasText: "Reopen closed tab" }).isDisabled(), "Reopen closed tab with nothing to reopen");
    // Esc closes the menu even when the focus isn't in it (WebKit sometimes gives it back to
    // the tab that was clicked), and the menu is gone before the next step points at a tab.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press("Escape");
    await page.locator(".context-menu").waitFor({ state: "detached", timeout: 5000 });
    await tab("studio").dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });

  await step("sizes tabs to their names, with the close button on the open one and over the name's end on hover", async () => {
    const tabs = page.locator(".tabs > .tab[data-path]");
    const notebook = tabs.filter({ hasText: /^notebook$/ });
    const close = notebook.locator(".tab-close");
    const opacity = (locator) => locator.evaluate((element) => getComputedStyle(element).opacity);
    // A tab is its name, the padding either side (26px) and a new commits dot if it has one
    // (11px), or 64px for a short name. Only the open one has room for its close button (26px):
    // with room for it in every tab, each was the name and about 50px.
    const widths = await tabs.evaluateAll((all) =>
      all.map((tab) => {
        const name = tab.querySelector(".tab-name > span");
        return { name: name.textContent, width: tab.getBoundingClientRect().width, text: name.scrollWidth, open: tab.classList.contains("active") };
      }),
    );
    for (const { name, width, text, open } of widths) expect(width <= Math.max(64, text + 38 + (open ? 26 : 0)), `${name}'s tab is ${width}px wide, for a name ${text}px wide`);
    await page.mouse.move(5, 400);
    // The open tab's close button shows, after its name.
    const open = page.locator(".tabs > .tab.active[data-path]");
    const openName = await open.locator(".tab-name").boundingBox();
    expect((await opacity(open.locator(".tab-close"))) === "1", "the open tab's close button doesn't show");
    expect((await open.locator(".tab-close").boundingBox()).x >= openName.x + openName.width, "the open tab's close button is over its name");
    expect((await opacity(close)) === "0", "the close button shows without the pointer on the tab");
    // On another tab: over the end of the name, which fades out under it.
    await notebook.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".tabs > .tab[data-path]:hover .tab-close")).opacity === "1", null, { timeout: 2000 });
    const x = await close.boundingBox();
    const tab = await notebook.boundingBox();
    const name = await notebook.locator(".tab-name").boundingBox();
    expect(x.x + x.width <= tab.x + tab.width && x.x < name.x + name.width, "the close button isn't over the end of the name");
    // Its X lines up with the middle of the name's small letters, in the screen's own pixels:
    // "no", where notebook starts, has nothing taller. (The pointer is still on the tab.)
    const scale = await page.evaluate(() => devicePixelRatio);
    const shot = decodePng(await page.screenshot());
    const screen = (box) => ({ x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.width * scale), h: Math.round(box.height * scale) });
    const area = screen(await notebook.boundingBox());
    const behind = shot.at(area.x + 4, area.y + area.h - 4);
    const inked = (from, width) => {
      const rows = [];
      for (let y = area.y; y < area.y + area.h; y++)
        for (let at = from; at < from + width; at++) {
          const pixel = shot.at(at, y);
          if (pixel.reduce((sum, value, index) => sum + Math.abs(value - behind[index]), 0) > 120) {
            rows.push(y);
            break;
          }
        }
      return (rows[0] + rows[rows.length - 1]) / 2;
    };
    const letters = inked(screen(await notebook.locator(".tab-name").boundingBox()).x, Math.round(12 * scale));
    const button = screen(await close.boundingBox());
    const cross = inked(button.x + 2, button.w - 4);
    expect(Math.abs(cross - letters) <= 1, `the X's middle is ${letters - cross} screen pixels above the letters'`);
    await close.click();
    await notebook.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Control+Shift+R");
    await row("Export notes as Markdown").waitFor({ timeout: 10_000 });
    // Only a name cut short fades out at the tab's end: none at full width (two tabs), and
    // notebook's in a window too narrow for both tabs (at 560px they just fit; at 440px the open
    // tab shrinks to 64px). On a timeout, each tab's measurements say why.
    const measured = () =>
      tabs.evaluateAll((all) =>
        all.map((tab) => {
          const name = tab.querySelector(".tab-name > span");
          return `${name.textContent}: tab ${tab.getBoundingClientRect().width}px, name ${name.scrollWidth}px in ${name.clientWidth}px${tab.hasAttribute("data-clipped") ? ", cut short" : ""}`;
        }),
      );
    const until = async (clipped, why, which = ".tabs > .tab[data-clipped]") => {
      for (let tries = 0; tries < 50; tries++) {
        if ((await page.locator(which).count()) > 0 === clipped) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`${why}: ${(await measured()).join("; ")}`);
    };
    await until(false, "a name is cut short at full width");
    const size = page.viewportSize();
    await page.setViewportSize({ width: 440, height: size.height });
    try {
      await until(true, "notebook's name isn't cut short in a narrow window", '.tabs > .tab.active[data-clipped]');
    } finally {
      await restoreSize(size);
    }
    await until(false, "a name is still cut short at full width again");
    await tabs.filter({ hasText: "studio" }).dispatchEvent("mousedown", { button: 0 });
    await row("Add a tavern chair").waitFor({ timeout: 10_000 });
  });
}
