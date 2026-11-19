// What's new in 0.15.0, for What's New and the release page (see clips.mjs).
import { STUDIO_PULL_REQUEST_CONVERSATIONS, STUDIO_PULL_REQUEST_DETAILS, STUDIO_PULL_REQUESTS } from "../demo.mjs";

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
const type = (page, text) => page.keyboard.type(text, { delay: 90 });

/** Where the pointer waits, before and after: outside what's recorded. */
async function rest(page, at) {
  page.pointerAt = at;
  await page.mouse.move(at.x, at.y);
}

/** The studio, with its pull requests, their details and conversations as GitHub would say them. */
const studio = (open, demos) =>
  open(demos.studio, {
    width: 1152,
    height: 720,
    fakes: { pullRequests: STUDIO_PULL_REQUESTS, pullRequestDetails: STUDIO_PULL_REQUEST_DETAILS, conversations: structuredClone(STUDIO_PULL_REQUEST_CONVERSATIONS) },
  });

/** The history's place and the details beside it (where a pull request and its files show), in 16:10. */
async function overHistory(page) {
  const center = await page.locator(".center-pane").boundingBox();
  const top = Math.round((await page.locator(".list-header").boundingBox()).y);
  const width = Math.round(1152 - center.x);
  return { x: Math.round(center.x), y: top, width, height: Math.min(720 - top, Math.round(width / 1.6)) };
}

export default {
  /**
   * #12 open, its files beside it: one's changes open over it, with the way back to it at the
   * start of their header, and back to the pull request.
   */
  async "request-files"({ open, point, pause, demos, record }) {
    const page = await studio(open, demos);
    const badge = page.locator(".commit-list .pr-badge", { hasText: "#12" }).first();
    await badge.waitFor({ timeout: 15_000 });
    await badge.click();
    const panel = page.locator(".details.request-files");
    const file = (name) => panel.locator(".file", { hasText: name }).first();
    await file("DefaultGame.ini").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const region = await overHistory(page);
    await rest(page, { x: 1151, y: 719 });
    await record(page, region, async () => {
      await pause(page, 1200);
      await point(page, file("Innkeeper.uasset"));
      await pause(page, 500);
      await press(page, point, pause, file("DefaultGame.ini"), 300);
      await page.locator(".diff-view:not(.request-view) .diff-row.added").first().waitFor({ timeout: 10_000 });
      await pause(page, 2400);
      await press(page, point, pause, page.locator(".diff-back"), 1600);
      await point(page, { x: 1151, y: 719 });
      await pause(page, 800);
    });
    await page.close();
  },

  /**
   * #12's DefaultGame.ini: Lena's comment and Rosa's reply under line 3; the mark hides them
   * and shows them again; a reply is written and sent.
   */
  async "review-comments"({ open, point, pause, demos, record }) {
    const page = await studio(open, demos);
    const badge = page.locator(".commit-list .pr-badge", { hasText: "#12" }).first();
    await badge.waitFor({ timeout: 15_000 });
    await badge.click();
    const panel = page.locator(".details.request-files");
    const file = panel.locator(".file", { hasText: "DefaultGame.ini" }).first();
    await file.locator(".file-comments").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const region = await overHistory(page);
    const notes = page.locator(".diff-notes");
    await rest(page, { x: 1151, y: 719 });
    await record(
      page,
      region,
      async () => {
      await pause(page, 900);
      await press(page, point, pause, file, 300);
      await notes.locator(".review-thread").first().waitFor({ timeout: 10_000 });
      await pause(page, 2600);
      const mark = page.locator(".diff-note-mark");
      await press(page, point, pause, mark, 1100);
      await press(page, point, pause, mark, 1400);
      await press(page, point, pause, notes.getByRole("button", { name: "Reply" }), 400);
      await type(page, "Bumped on purpose: it's in the patch notes.");
      await pause(page, 500);
      await press(page, point, pause, notes.locator(".comment-box").getByRole("button", { name: "Reply" }), 300);
      await notes.locator(".request-comment", { hasText: "Bumped on purpose" }).waitFor({ timeout: 10_000 });
      await pause(page, 2200);
      await point(page, { x: 1151, y: 719 });
      await pause(page, 500);
      },
      { fadeBack: true },
    );
    await page.close();
  },
};
