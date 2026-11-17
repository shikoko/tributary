// What's new in 0.14.0, for What's New and the release page (see clips.mjs).
import { STUDIO_PULL_REQUESTS } from "../demo.mjs";

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Points at `target`, then clicks it, and waits `ms`. */
async function press(page, point, pause, target, ms) {
  await point(page, target);
  await pause(page, 250);
  await click(page);
  await pause(page, ms);
}

/** Types `text` a key at a time, as someone would. */
const type = (page, text) => page.keyboard.type(text, { delay: 110 });

/**
 * Where the pointer waits, before and after: off the commit list (where resting on a row shows
 * its card) and outside what's recorded.
 */
async function rest(page, at) {
  page.pointerAt = at;
  await page.mouse.move(at.x, at.y);
}

/** The 16:10 part of the window around `box` (a bounding box), `margin` wider, kept in the window. */
function around(box, margin, page) {
  const { width: windowWidth, height: windowHeight } = page.viewportSize();
  let width = Math.min(windowWidth, Math.round(box.width + margin * 2));
  let height = Math.round(width / 1.6);
  if (height > windowHeight) {
    height = windowHeight;
    width = Math.round(height * 1.6);
  }
  const x = Math.max(0, Math.min(windowWidth - width, Math.round(box.x + box.width / 2 - width / 2)));
  const y = Math.max(0, Math.min(windowHeight - height, Math.round(box.y + box.height / 2 - height / 2)));
  return { x, y, width, height };
}

export default {
  /**
   * Everything mode: "export" typed in the search box finds commit messages, branches, a file
   * and code, grouped beside the history in the sidebar's place, and a message found goes to
   * its commit. Esc clears the search.
   */
  async "search-everything"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1152, height: 720 });
    const box = page.getByLabel("Search commits");
    const results = page.locator(".search-results");
    const group = (title) => results.locator(".search-results-group", { has: page.locator(".search-results-title", { hasText: title }) });
    await box.waitFor({ timeout: 10_000 });
    await rest(page, { x: 4, y: 716 });
    await record(
      page,
      { x: 0, y: 0, width: 864, height: 540 },
      async () => {
        await pause(page, 700);
        await press(page, point, pause, box, 200);
        await type(page, "export");
        await group("Messages").locator(".search-result", { hasText: "Export notes as Markdown" }).waitFor({ timeout: 10_000 });
        await page.waitForFunction(() => !document.querySelector(".search-results")?.textContent?.includes("searching…"), null, { timeout: 15_000 });
        await pause(page, 2200);
        await press(page, point, pause, group("Messages").locator(".search-result", { hasText: "Export notes as Markdown" }), 1800);
        await press(page, point, pause, box, 200);
        await page.keyboard.press("Escape");
        await results.waitFor({ state: "detached", timeout: 5000 });
        await point(page, { x: 4, y: 716 });
        await pause(page, 900);
      },
      // The commit found stays selected: the end fades back to the start.
      { fadeBack: true },
    );
    await page.close();
  },

  /**
   * Settings → SSH keys: the key's name, kind and fingerprint, its public half shown with the
   * eye and hidden again.
   */
  async "ssh-keys"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1152, height: 720 });
    await page.keyboard.press("Control+,");
    await page.locator(".settings-nav [role=tab]", { hasText: "SSH keys" }).click();
    const card = page.locator(".ssh-key").first();
    await card.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    // The Settings window from its top: its list of sections, SSH keys chosen, and the keys.
    const settings = await page.locator(".settings-window").boundingBox();
    const width = Math.round(settings.width + 24);
    const region = around({ x: settings.x - 12, y: settings.y - 12, width, height: Math.round(width / 1.6) }, 0, page);
    // Waiting below the keys, out of the picture.
    const start = { x: Math.round(region.x + region.width / 2), y: 719 };
    await rest(page, start);
    await record(page, region, async () => {
      await pause(page, 900);
      await point(page, card.getByRole("button", { name: "Copy public key" }));
      await pause(page, 900);
      await press(page, point, pause, card.getByRole("button", { name: "Show the public key" }), 2600);
      await press(page, point, pause, card.getByRole("button", { name: "Hide the public key" }), 700);
      await point(page, start);
      await pause(page, 900);
    });
    await page.close();
  },

  /**
   * The studio's sidebar: its open pull requests and your issues, and the menu by the filter
   * that switches a section off (Issues) and on again.
   */
  async "sidebar-sections"({ open, point, pause, demos, record }) {
    const tracker = { kind: "jira", site: "https://studio.atlassian.net", keys: ["FEAST"] };
    const issues = {
      all: [
        { key: "FEAST-23", title: "Tavern sign: add the opening hours", status: "In Progress", done: false, url: "https://studio.atlassian.net/browse/FEAST-23" },
        { key: "FEAST-21", title: "Door creak is too loud", status: "To Do", done: false, url: "https://studio.atlassian.net/browse/FEAST-21" },
      ],
      mine: ["FEAST-23", "FEAST-21"],
      user: "Maya Chen",
    };
    const page = await open(demos.studio, {
      width: 1152,
      height: 720,
      fakes: { pullRequests: STUDIO_PULL_REQUESTS, issues },
      storage: { [`tributary.issueTracker:${demos.studio}`]: tracker },
    });
    const sidebar = page.locator(".sidebar");
    await sidebar.locator(".sidebar-request").first().waitFor({ timeout: 10_000 });
    await sidebar.locator(".sidebar-issue").first().waitFor({ timeout: 10_000 });
    const sections = page.getByRole("button", { name: "Sidebar sections" });
    const issuesItem = page.getByRole("menuitemcheckbox", { name: "Issues" });
    // The sidebar, and enough of the history beside it for the menu.
    const region = { x: 0, y: 0, width: 768, height: 480 };
    await rest(page, { x: 4, y: 716 });
    await record(page, region, async () => {
      await pause(page, 800);
      await point(page, sidebar.locator(".sidebar-request").nth(1));
      await pause(page, 1200);
      await point(page, sidebar.locator(".sidebar-issue").first());
      await pause(page, 1200);
      await press(page, point, pause, sections, 900);
      await press(page, point, pause, issuesItem, 1600);
      await press(page, point, pause, sections, 700);
      await press(page, point, pause, issuesItem, 1400);
      await point(page, { x: 4, y: 716 });
      await pause(page, 900);
    });
    await page.close();
  },

  /**
   * The notebook's high-contrast theme: icons written into a stylesheet as base64 show as
   * pictures under their lines, compared before and after; the logo, an SVG, as a picture.
   */
  async "pictures-in-text"({ open, point, pause, demos, record }) {
    const page = await open(demos.notebook, { width: 1152, height: 720 });
    await page.locator(".commit-row", { hasText: "High-contrast theme" }).first().click();
    const file = (name) => page.locator(".details .file", { hasText: name }).first();
    await file("icons.css").waitFor({ timeout: 10_000 });
    const view = page.locator(".diff-view");
    await page.waitForTimeout(600);
    // The history's place (where the changes open) and the details' files beside it, from the
    // top of the history's headings, where the changes' toolbar is.
    const center = await page.locator(".center-pane").boundingBox();
    const top = Math.round((await page.locator(".list-header").boundingBox()).y);
    const region = { ...around({ x: center.x, y: center.y, width: 1152 - center.x, height: center.height }, 0, page), y: top };
    await rest(page, { x: 1151, y: 719 });
    await record(page, region, async () => {
      await pause(page, 800);
      await press(page, point, pause, file("icons.css"), 300);
      await view.locator(".diff-picture-chip").first().waitFor({ timeout: 10_000 });
      await pause(page, 2000);
      await press(page, point, pause, view.getByRole("button", { name: "Compare" }).first(), 300);
      await view.locator(".diff-picture-inline .diff-image img").nth(1).waitFor({ timeout: 5000 });
      await pause(page, 2400);
      await page.keyboard.press("Escape");
      await view.waitFor({ state: "detached", timeout: 5000 });
      await pause(page, 500);
      await press(page, point, pause, file("logo.svg"), 300);
      await view.locator(".diff-image img").nth(1).waitFor({ timeout: 10_000 });
      await pause(page, 2600);
      await page.keyboard.press("Escape");
      await view.waitFor({ state: "detached", timeout: 5000 });
      await point(page, { x: 1151, y: 719 });
      await pause(page, 900);
    });
    await page.close();
  },
};
