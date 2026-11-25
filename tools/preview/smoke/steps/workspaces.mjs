// The smoke test: Workspaces: every open repository at a glance, a workspace of its own for
// some of them, moving a tab there, switching with the keyboard, fetching a workspace's
// repositories together, finding one in another workspace, and removing a workspace.
export default async function ({ page, step, accessible, expect, row, toast, dismissToast, openNotebook, openStudio }) {
  await openNotebook();
  await openStudio();

  const panel = page.locator(".workspace-panel");
  const switcher = page.locator(".workspace-switch");
  const openTabs = () => page.locator(".tabs > .tab[data-path]").allInnerTexts();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("tributary.tabs.workspaces") ?? "null"));
  const openOverview = async () => {
    if (!(await panel.isVisible())) await switcher.click();
    await panel.waitFor({ timeout: 5000 });
  };

  await step("shows every open repository at a glance, with its branch and how it stands", async () => {
    // With one workspace, it's just an icon in the tab bar.
    expect((await switcher.getAttribute("aria-label")) === "Your repositories", `the switcher says ${await switcher.getAttribute("aria-label")}`);
    // On whole pixels, its icon in the middle of it: the same room on every side.
    const room = await switcher.evaluate((button) => {
      const outer = button.getBoundingClientRect();
      const icon = button.querySelector("svg").getBoundingClientRect();
      return [outer.top, icon.top - outer.top, outer.bottom - icon.bottom, icon.left - outer.left, outer.right - icon.right];
    });
    expect(room.every(Number.isInteger) && room.slice(1).every((side) => side === room[1]), `the switcher's top, and the room around its icon: ${room.join(", ")}`);
    await openOverview();
    const rows = panel.locator(".workspace-row");
    await rows.filter({ hasText: "studio" }).locator(".workspace-row-branch", { hasText: "main" }).waitFor({ timeout: 10_000 });
    await rows.filter({ hasText: "notebook" }).locator(".workspace-row-when", { hasText: /fetched|never fetched/ }).waitFor({ timeout: 10_000 });
    expect((await rows.count()) === 2, `${await rows.count()} rows, not 2`);
    // The open repository's row is marked.
    expect(await rows.filter({ hasText: "studio" }).evaluate((element) => element.classList.contains("open")), "the open repository's row isn't marked");
    await accessible("every open repository at a glance");
  });

  await step("makes a workspace, moves a tab into it, and switches with the keyboard", async () => {
    await openOverview();
    await panel.getByRole("button", { name: "New workspace…" }).click();
    await panel.getByPlaceholder("Like Game, or Website").fill("Art");
    // Picking colours, with a name typed, only picks them: it doesn't make the workspace.
    for (const colour of ["Colour 3", "Colour 5"]) {
      await panel.getByRole("radio", { name: colour, exact: true }).click();
      expect(await panel.getByRole("radio", { name: colour, exact: true }).isChecked(), `${colour} isn't picked`);
    }
    expect(await panel.getByRole("button", { name: "Create and switch" }).isVisible(), "picking a colour made the workspace");
    await accessible("a new workspace");
    await panel.getByRole("button", { name: "Create and switch" }).click();
    // Empty: the start screen, and the switcher to go back.
    await page.getByText("Open repository").first().waitFor({ timeout: 10_000 });
    await page.locator(".workspace-switch", { hasText: "Art" }).waitFor({ timeout: 5000 });
    expect((await openTabs()).length === 0, `the new workspace has tabs: ${await openTabs()}`);
    // The other workspace's repositories are chips: one opens it there.
    await openOverview();
    await panel.locator(".workspace-chip", { hasText: "studio" }).click();
    await row("Add a tavern chair").waitFor({ timeout: 15_000 });
    expect((await openTabs()).join(",") === "notebook,studio", `the tabs are ${await openTabs()}`);
    // Its tab moved into Art: the next one opens.
    await page.locator(".tabs > .tab", { hasText: /^studio$/ }).click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Move to Workspace" }).hover();
    await page.locator(".menu-item", { hasText: /^Art$/ }).click();
    await row("Export notes as Markdown").waitFor({ timeout: 15_000 });
    expect((await openTabs()).join(",") === "notebook", `after moving, the tabs are ${await openTabs()}`);
    // Ctrl+Alt+2 (⌘⌥2): Art, with studio open as it was left.
    await page.keyboard.press("ControlOrMeta+Alt+Digit2");
    await row("Add a tavern chair").waitFor({ timeout: 15_000 });
    expect((await openTabs()).join(",") === "studio", `in Art, the tabs are ${await openTabs()}`);
    await page.keyboard.press("ControlOrMeta+Alt+Digit1");
    await row("Export notes as Markdown").waitFor({ timeout: 15_000 });
    const saved = await stored();
    expect(saved?.list.length === 2 && saved.list[1].tabs.map((tab) => tab.name).join() === "studio", `stored: ${JSON.stringify(saved)}`);
  });

  await step("fetches every repository in a workspace together", async () => {
    await openOverview();
    await panel.locator(".workspace-section.here").getByRole("button", { name: "Fetch all" }).click();
    const said = await toast();
    expect(/^My repositories: fetched notebook$/.test(said), `the toast says ${said}`);
    await dismissToast();
  });

  await step("finds a repository in another workspace, and removes a workspace", async () => {
    await openOverview();
    await panel.getByLabel("Find a repository").fill("stud");
    const found = panel.locator(".workspace-row");
    await found.first().waitFor({ timeout: 5000 });
    expect((await found.count()) === 1, `${await found.count()} found`);
    await found.first().click();
    await row("Add a tavern chair").waitFor({ timeout: 15_000 });
    await page.locator(".workspace-switch", { hasText: "Art" }).waitFor({ timeout: 5000 });
    // Removed, My repositories' tabs come into Art; with one workspace, the switcher's an icon again.
    await openOverview();
    await panel.getByRole("button", { name: "Edit workspaces…" }).click();
    await panel.getByRole("button", { name: "Remove My repositories" }).click();
    await panel.getByRole("button", { name: "Done" }).click();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 5000 });
    expect((await openTabs()).join(",") === "studio,notebook", `after removing, the tabs are ${await openTabs()}`);
    expect((await switcher.getAttribute("aria-label")) === "Your repositories", `the switcher says ${await switcher.getAttribute("aria-label")}`);
  });
}
