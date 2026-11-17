// The smoke test: The sidebar, hiding branches, the scrollbar marks, hover cards, lanes, About and the View panel.
import { execFileSync } from "node:child_process";

export default async function ({ demos, page, preview, step, accessible, expect, row, openNotebook }) {
  // origin's branches, as a fetch brings them.
  execFileSync("git", ["-C", demos.notebook, "fetch", "--quiet"]);
  await openNotebook();

  await step("lists each branch once, with the remote's others folded away", async () => {
    const sidebar = page.locator(".sidebar");
    // feature/export is here and on origin: one row, whose menu offers origin's copy too.
    const exportRows = sidebar.locator(".sidebar-item .sidebar-name").filter({ hasText: /^export$/ });
    expect((await exportRows.count()) === 1, `export is listed ${await exportRows.count()} times`);
    await exportRows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete feature/export from origin…" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    // feature/onboarding is only on origin: folded away until its group is opened.
    const onlyOnOrigin = sidebar.getByRole("button", { name: /Only on origin/ });
    expect((await sidebar.locator(".sidebar-name", { hasText: "onboarding" }).count()) === 0, "a branch only on origin is shown before its group is opened");
    await onlyOnOrigin.click();
    await sidebar.locator(".sidebar-name", { hasText: "onboarding" }).waitFor({ timeout: 5000 });
    await onlyOnOrigin.click();
  });

  await step("hides a branch, then shows everything again", async () => {
    const themes = page.locator(".sidebar-item", { hasText: /^themes/ }).first();
    // Its eye shows on hover or keyboard focus. Focus keeps it shown while the click scrolls
    // the row into place, which can move it from under the pointer, and the eye with it.
    await themes.focus();
    await themes.locator(".sidebar-eye").click();
    await page.locator(".sidebar-visibility", { hasText: "1 hidden" }).waitFor({ timeout: 10_000 });
    await page.locator(".ref-pill", { hasText: "feature/themes" }).waitFor({ state: "detached", timeout: 10_000 });
    await page.locator(".sidebar-visibility").getByRole("button", { name: "Show all" }).click();
    await page.locator(".ref-pill", { hasText: "feature/themes" }).first().waitFor({ timeout: 10_000 });
  });

  await step("says what a mark beside the scrollbar is, and lights it up", async () => {
    // The marks, from their canvas: the middle of each run of painted rows.
    const strip = await page.evaluate(() => {
      const canvas = document.querySelector(".list-markers");
      const box = canvas.getBoundingClientRect();
      const data = canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data;
      const marks = [];
      for (let y = 0, start = -1; y <= canvas.height; y++) {
        const painted = y < canvas.height && data[y * 4 + 3] > 0;
        if (painted && start < 0) start = y;
        if (!painted && start >= 0) {
          marks.push(((start + y) / 2) * (box.height / canvas.height));
          start = -1;
        }
      }
      return { x: box.left + box.width / 2, top: box.top, marks };
    });
    expect(strip.marks.length > 0, "no marks beside the scrollbar");
    await page.mouse.move(strip.x, strip.top + strip.marks[0]);
    const card = page.locator(".mark-card");
    await card.locator(".mark-entry-name").first().waitFor({ timeout: 5000 });
    expect((await page.locator(".mark-glow").count()) > 0, "the mark doesn't light up");
    expect((await card.locator(".mark-entry-summary").count()) > 0, "the card doesn't say which commit");
    // The row under the pointer doesn't show its preview over the card.
    await page.mouse.move(strip.x, strip.top + strip.marks[0] + 1);
    await page.waitForTimeout(900);
    expect((await page.locator(".commit-preview").count()) === 0, "a row's preview opened over the mark's card");
    await page.mouse.move(strip.x - 300, strip.top + 200);
    await card.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("says what a branch's label is in the row's hover card, not in a tooltip as well", async () => {
    const label = page.locator(".commit-row .ref-pill.branch").first();
    expect((await label.getAttribute("title")) === null, "a branch's label in the list still has a tooltip");
    const box = await label.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    const hint = page.locator(".commit-preview .preview-hint");
    await hint.waitFor({ timeout: 5000 });
    expect(/^(Checked out branch|Branch) /.test(await hint.textContent()), `the card says "${await hint.textContent()}"`);
    await page.mouse.move(box.x + box.width / 2, box.y + 400);
    await page.mouse.move(10, 10);
    await page.locator(".commit-preview").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("lights up a branch's lane while the pointer is on it", async () => {
    await page.locator(".sidebar-item", { hasText: /^themes/ }).first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
    // Its tip lights up beside the scrollbar too.
    expect((await page.locator(".mark-glow").count()) > 0, "the branch's mark doesn't light up");
    await page.locator(".commit-row .summary").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ state: "detached", timeout: 5000 });
    // And from its label in the graph.
    await page.locator(".commit-row .ref-pill.branch").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ timeout: 5000 });
    await page.locator(".commit-row .summary").first().hover();
    await page.locator(".commit-list.lane-lit").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("outlines a commit you jump to for a moment, not one you click in the list", async () => {
    await page.locator(".commit-row", { has: page.locator(".summary.wip") }).click();
    await page.waitForTimeout(300);
    expect((await page.locator(".arrival").count()) === 0, "a commit clicked in the list was outlined");
    await page.locator(".sidebar-item", { hasText: /^themes/ }).first().click();
    await page.locator(".commit-row.selected .arrival").waitFor({ timeout: 5000 });
    await page.locator(".arrival").waitFor({ state: "detached", timeout: 5000 });
  });

  await step("shows About Tributary, and what's new from it", async () => {
    await page.locator(".menu-bar-item", { hasText: "Help" }).dispatchEvent("mousedown", { button: 0 });
    await page.locator(".menu-item", { hasText: "About Tributary" }).click();
    const whatsNew = page.locator(".about-link", { hasText: "What's New" });
    await whatsNew.waitFor({ timeout: 5000 });
    await accessible("About Tributary");
    await whatsNew.click();
    const dialog = page.locator(".whats-new-dialog");
    await dialog.waitFor({ timeout: 5000 });
    await accessible("What's New");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("changes how the window looks from the View panel, and closes it with Esc", async () => {
    const button = page.getByRole("button", { name: "View options" });
    await button.click();
    const panel = page.locator(".view-panel");
    await panel.waitFor({ timeout: 5000 });
    await accessible("the View panel");
    // Compact rows, straight away; then back.
    await panel.getByRole("button", { name: "Compact" }).click();
    await page.locator(".commit-list.dense").waitFor({ timeout: 5000 });
    await panel.getByRole("button", { name: "Roomy" }).click();
    await page.locator(".commit-list.dense").waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    expect(await button.evaluate((element) => element === document.activeElement), "the focus didn't go back to the View button");
  });

  await step("opens the View panel from the keyboard and the command palette", async () => {
    const panel = page.locator(".view-panel");
    // The shortcut opens it under the View button, and closes it again.
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ timeout: 5000 });
    const button = page.getByRole("button", { name: "View options" });
    const [at, under] = await Promise.all([panel.boundingBox(), button.boundingBox()]);
    expect(Math.abs(at.y - (under.y + under.height + 6)) < 2, `the panel is at ${at.y}, not under the button at ${under.y}`);
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    // With nothing focused (as on a Mac, where a click doesn't focus a button), the focus
    // goes to the View button when it closes, not back to the page.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press("Control+Shift+O");
    await panel.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    expect(await button.evaluate((element) => element === document.activeElement), "the focus didn't go to the View button");
    // View Options in the command palette, with its shortcut beside it.
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Commands" });
    await palette.locator("input").fill("view options");
    await palette.locator("li", { hasText: "View Options" }).filter({ hasText: "Ctrl+Shift+O" }).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await panel.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
  });
}
