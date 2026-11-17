// The smoke test: Pull requests and checks: badges, colours, failed checks and why, the checks graph, reviews, comments, merging and opening one.
import { execFileSync } from "node:child_process";
import { studioCommitRuns, STUDIO_PULL_REQUEST_DETAILS, STUDIO_PULL_REQUESTS } from "../../demo.mjs";
import { CONTROLS, EXCEPT } from "../../aligned.mjs";
import { describeOffCentre, moving, offCentre as offInPixels, probe } from "../../../e2e/centred.mjs";

export default async function ({ browserName, page, demos, folder, preview, browser, userAgent, errors, step, restoreSize, accessible, expect, toast, dismissToast, row, openNotebook, openStudio }) {
  await openNotebook();
  await openStudio();

  await step("shows pull requests on their branches", async () => {
    await page.locator(".pr-badge").first().waitFor({ timeout: 10_000 });
    // On the commit list's labels, the icon for the checks alone (a cross for #14's failed
    // ones), with the number in the badge's name for screen readers. The sidebar has both.
    const label = page.locator(".commit-list .pr-badge.failure", { hasText: "#14" }).first();
    expect(await label.locator(".pr-check-icon").isVisible(), "no icon for the failed checks");
    expect(!(await label.locator(".pr-number").isVisible()), "the number shows on the label");
    expect((await label.getAttribute("aria-label")).includes("#14"), `the badge's name is ${await label.getAttribute("aria-label")}`);
    expect(await page.locator(".sidebar-item .pr-badge.failure .pr-number", { hasText: "#14" }).first().isVisible(), "no number in the sidebar");
  });

  await step("keeps the words in the middle of badges and buttons at 150% and 200% too", async () => {
    // The checks so far are at 100%. At other scales letters round differently: their baseline
    // goes on a whole CSS pixel and a control's edges on the nearest screen pixel, so a control
    // starting half a pixel down had its words a screen pixel low (the sidebar's pull request
    // badges, and the toolbar's buttons and branch). In a page of its own at each scale, in
    // Chromium: WebKit's rounding hasn't been looked at at these scales.
    if (browserName !== "chromium") return;
    for (const scale of [1.5, 2]) {
      const scaled = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: scale, userAgent });
      try {
        await scaled.addInitScript(([pick, pullRequests]) => {
          window.__PREVIEW__ = { pick, pullRequests };
          localStorage.setItem("tributary.fetch.auto", "false");
          localStorage.setItem("tributary.whatsNew.seen", JSON.stringify("999.0.0"));
          localStorage.setItem("tributary.tours.off", "true");
        }, [demos.studio, STUDIO_PULL_REQUESTS]);
        await scaled.goto(preview.url);
        await scaled.getByText("Open repository").first().click();
        await scaled.locator(".sidebar-item .pr-badge").first().waitFor({ timeout: 15_000 });
        await scaled.evaluate(() => document.fonts.ready);
        await scaled.waitForFunction(`(${moving})() === 0`, null, { timeout: 3000 }).catch(() => {});
        const measured = await scaled.evaluate(`(${probe})(${JSON.stringify(CONTROLS)}, ${JSON.stringify(EXCEPT)})`);
        expect(measured.some((control) => control.classes === "pr-badge"), "no pull request badge measured");
        const shot = await scaled.screenshot();
        const found = describeOffCentre(offInPixels(shot, measured, { tolerance: 1 }));
        expect(found.length === 0, `at ${scale * 100}%: ${found.slice(0, 6).join("; ")}`);
      } finally {
        await scaled.close();
      }
    }
  });

  await step("shows pull requests' numbers on their labels when asked", async () => {
    const number = page.locator(".commit-list .pr-badge.failure", { hasText: "#14" }).first().locator(".pr-number");
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.locator(".settings-nav").getByText("Commit list").click();
    const toggle = settings.getByRole("switch", { name: "Pull request numbers" });
    await toggle.click();
    await number.waitFor({ state: "visible", timeout: 5000 });
    await toggle.click();
    await number.waitFor({ state: "hidden", timeout: 5000 });
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("lists pull requests and your issues in the sidebar, each section switched off and on", async () => {
    // Your open issues in the repository's tracker (Jira here): the done one isn't listed.
    const tracker = { kind: "jira", site: "https://studio.atlassian.net", keys: ["FEAST"] };
    const issues = {
      all: [
        { key: "FEAST-23", title: "Tavern sign: add the opening hours", status: "In Progress", done: false, url: "https://studio.atlassian.net/browse/FEAST-23" },
        { key: "FEAST-21", title: "Door creak is too loud", status: "To Do", done: false, url: "https://studio.atlassian.net/browse/FEAST-21" },
        { key: "FEAST-9", title: "Barber clips through the chair", status: "Done", done: true, url: "https://studio.atlassian.net/browse/FEAST-9" },
      ],
      mine: ["FEAST-23", "FEAST-21", "FEAST-9"],
      user: "Maya Chen",
    };
    const setTracker = (value) =>
      page.evaluate(
        ([key, value, issues]) => {
          window.__PREVIEW__.issues = issues;
          // As Repository Settings → Issues stores it (repoPrefs.ts).
          localStorage.setItem(key, JSON.stringify(value));
          window.dispatchEvent(new CustomEvent("tributary-repo-setting", { detail: key }));
        },
        [`tributary.issueTracker:${demos.studio}`, value, value ? issues : undefined],
      );
    await setTracker(tracker);
    const sidebar = page.locator(".sidebar");
    const requests = sidebar.locator(".sidebar-request");
    const issueRows = sidebar.locator(".sidebar-issue");
    await requests.first().waitFor({ timeout: 10_000 });
    await issueRows.first().waitFor({ timeout: 10_000 });
    expect((await requests.count()) === STUDIO_PULL_REQUESTS.length, `${await requests.count()} pull requests listed`);
    expect((await issueRows.count()) === 2, `the issues listed: ${await issueRows.allInnerTexts()}`);
    expect((await requests.filter({ hasText: "#14" }).locator(".sidebar-request-state.failure").count()) === 1, "#14's failed checks aren't shown on its icon");
    await accessible("the sidebar's pull requests and issues", page, { within: ".sidebar" });

    // The filter finds them as it finds branches.
    const filter = sidebar.getByLabel("Filter the sidebar");
    await filter.fill("creak");
    await requests.filter({ hasText: "Barber" }).waitFor({ state: "detached", timeout: 5000 });
    expect((await requests.count()) === 1 && (await issueRows.count()) === 1, `filtered: ${await requests.allInnerTexts()} ${await issueRows.allInnerTexts()}`);
    await filter.fill("");

    // A pull request opens in the app.
    await requests.filter({ hasText: "Make the door creak" }).click();
    await page.locator(".request-view", { hasText: "Make the door creak" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.locator(".request-view").waitFor({ state: "detached", timeout: 5000 });

    // Switched off from the menu by the filter, and on again in Settings, which it opens.
    const sections = page.getByRole("button", { name: "Sidebar sections" });
    await sections.click();
    const item = page.getByRole("menuitemcheckbox", { name: "Pull requests" });
    expect((await item.getAttribute("aria-checked")) === "true", "Pull requests isn't checked in the menu");
    await item.click();
    await requests.first().waitFor({ state: "detached", timeout: 5000 });
    await sections.click();
    await page.getByRole("menuitem", { name: "Sidebar settings…" }).click();
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    const toggle = settings.getByRole("switch", { name: "Pull requests" });
    await toggle.waitFor({ timeout: 5000 });
    expect((await toggle.getAttribute("aria-checked")) === "false", "Settings has Pull requests switched on");
    await toggle.click();
    await requests.first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });

    // As it was, for the steps after this one.
    await setTracker(null);
    await issueRows.first().waitFor({ state: "detached", timeout: 5000 });
  });

  await step("colours checks as you pick, and as the theme does again", async () => {
    // A pull request whose checks failed, in the failed checks' colour: the theme's, yours, then the theme's.
    const badge = page.locator(".commit-list .pr-badge.failure").first();
    const fill = () => badge.evaluate((element) => getComputedStyle(element).backgroundColor);
    const theirs = await fill();
    await page.keyboard.press("Control+,");
    const settings = page.locator(".dialog", { hasText: "Settings" }).first();
    await settings.locator(".settings-nav").getByText("Appearance").click();
    await settings.getByLabel("Failed checks' colour").fill("#cc00ff");
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--check-failure") === "#cc00ff", null, { timeout: 5000 });
    expect((await fill()) === "rgb(204, 0, 255)", `the badge is ${await fill()}, not the colour picked`);
    await settings.locator(".check-colors").scrollIntoViewIfNeeded();
    await accessible("the checks' colours in Settings");
    await settings.getByRole("button", { name: "The theme's", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--check-failure") === "", null, { timeout: 5000 });
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached", timeout: 5000 });
    expect((await fill()) === theirs, `the badge is ${await fill()}, not the theme's ${theirs}`);
  });

  await step("shows a commit's failed check, and runs it again", async () => {
    // The checked-out commit (every commit has the checks above).
    await page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first().click();
    const checks = page.locator(".details .commit-checks");
    await checks.getByText("Audio loudness").first().waitFor({ timeout: 10_000 });
    await accessible("a commit's checks, one failed");
    await checks.getByRole("button", { name: "Re-run failed" }).click();
    await page.locator(".toast", { hasText: "Running the failed jobs again" }).waitFor({ timeout: 5000 });
    await dismissToast();
  });

  await step("says why a check failed, and runs its job again", async () => {
    // The failed check's row says Why?, and opens a window with its job's steps, the failed
    // one marked, and the end of its log, scrolled to its end, the errors marked.
    const row = page.locator(".details .commit-check.failure .commit-check-row");
    await row.locator(".check-why-chip", { hasText: "Why?" }).waitFor({ timeout: 5000 });
    await row.click();
    const why = page.locator(".dialog.check-why");
    await why.getByRole("heading", { name: "Audio loudness failed" }).waitFor({ timeout: 5000 });
    await why.locator(".check-why-line.error", { hasText: "2 files are louder than -14 LUFS" }).waitFor({ timeout: 5000 });
    await why.locator(".check-why-said", { hasText: /^Checks, on push to main · at step 4 of 5$/ }).waitFor({ timeout: 5000 });
    expect((await why.locator(".check-why-steps li.failed-here").textContent()) === "Check loudness", "the failed step isn't the one marked");
    const log = why.locator(".check-why-log");
    expect(await log.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1), "the log doesn't start at its end");
    expect((await page.evaluate(() => window.__PREVIEW__.askedLogs)).at(-1).endsWith("/actions/runs/32"), "it didn't ask for the check's log");
    await accessible("why a check failed");
    await why.getByRole("button", { name: "Re-run job" }).click();
    await page.locator(".toast", { hasText: "Running the job again: Audio loudness" }).waitFor({ timeout: 5000 });
    await why.waitFor({ state: "detached", timeout: 5000 });
    expect((await page.evaluate(() => window.__PREVIEW__.reranJobs)).at(-1).endsWith("/actions/runs/32"), "it didn't run the check's job again");
    await dismissToast();
  });

  await step("shows a commit's checks as a graph of each run, and opens a job's page", async () => {
    await page.evaluate((runs) => Object.assign(window.__PREVIEW__, { commitRuns: runs }), studioCommitRuns());
    const current = page.locator(".commit-row", { has: page.locator(".ref-pill.current") }).first();
    await page.locator(".details .commit-checks").getByRole("button", { name: "Open" }).click();
    const view = page.locator(".checks-view");
    const build = view.locator(".run-card", { hasText: "Build" }).first();
    // The platforms in one box, the one still running at its step, and the jobs still waiting.
    await build.locator(".run-group", { hasText: "3 jobs" }).waitFor({ timeout: 10_000 });
    await build.locator(".run-job.running .run-step-name", { hasText: "Cook the tavern level" }).waitFor({ timeout: 5000 });
    expect((await build.locator(".run-card-job.waiting").count()) === 2, "the jobs still waiting aren't shown");
    // A line from each group to each that waits for it, left to right: Version and Lint to
    // Build, Build to Package, Package to Upload.
    await page.waitForFunction(() => document.querySelector(".checks-view .run-card")?.querySelectorAll(".run-edge path").length === 4, null, { timeout: 5000 });
    const ends = await build.locator(".run-edge path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d").match(/^M([\d.]+) [\d.]+ C.* ([\d.]+) [\d.]+$/)));
    expect(ends.every((found) => found && Number(found[1]) < Number(found[2])), `a line doesn't go left to right: ${JSON.stringify(ends)}`);
    // Wider than the view beside the panels: the graph scrolls rather than squeezing, with an
    // arrow on the side there's more of.
    const graph = build.locator(".run-graph-scroll");
    expect(await graph.evaluate((element) => element.scrollWidth > element.clientWidth), "the Build graph was squeezed to fit");
    await build.locator(".run-graph-more.right").click();
    await build.locator(".run-graph-more.left").waitFor({ timeout: 5000 });
    expect(await graph.evaluate((element) => element.scrollLeft > 0), "the arrow didn't scroll the graph");
    await view.locator(".checks-count.failure", { hasText: "1 failed" }).waitFor({ timeout: 5000 });
    await accessible("a commit's checks as graphs");
    // A failed job says why, with its page a click away; a job that passed opens its page.
    await view.locator(".run-card-job", { hasText: "Audio loudness" }).click();
    const why = page.locator(".dialog.check-why");
    await why.locator(".check-why-said", { hasText: /^Asset checks, on push to main · after 2m 0s · at step 4 of 5$/ }).waitFor({ timeout: 5000 });
    await why.getByRole("button", { name: "Open on GitHub" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/42/job/7")), "the job's page didn't open");
    await page.keyboard.press("Escape");
    await why.waitFor({ state: "detached", timeout: 5000 });
    expect(await view.isVisible(), "Esc closed the checks under the window too");
    await view.locator(".run-card-job", { hasText: "Texture sizes" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/42/job/6")), "a job's page didn't open");
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // The commit's menu opens them too.
    await current.click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Show checks" }).click();
    await view.locator(".run-card", { hasText: "Asset checks" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    // And its CI dot in the list, which selects the commit too: here, one further down.
    const older = page.locator(".commit-row", { has: page.locator(".graph-ci") }).nth(3);
    await older.locator(".graph-ci").click();
    await view.locator(".run-card", { hasText: "Asset checks" }).waitFor({ timeout: 10_000 });
    expect(await older.evaluate((row) => row.classList.contains("selected")), "clicking the dot didn't select its commit");
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    await current.click();
  });

  await step("shows a pull request's reviews and checks", async () => {
    await page.evaluate((details) => Object.assign(window.__PREVIEW__, { pullRequestDetails: details }), STUDIO_PULL_REQUEST_DETAILS);
    // Pressing the badge opens the pull request, and leaves the selected commit as it was: a
    // press that selected the badge's row could scroll it, and the click would miss the badge.
    const selected = () => page.evaluate(() => document.querySelector(".commit-row.selected")?.id ?? "");
    const before = await selected();
    await page.locator(".pr-badge", { hasText: "#14" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-merge", { hasText: "changes were asked for" }).waitFor({ timeout: 10_000 });
    await view.locator(".request-check.failure", { hasText: "Audio loudness" }).waitFor({ timeout: 5000 });
    await view.locator(".request-status-said", { hasText: "diego-ramos asked for changes" }).waitFor({ timeout: 5000 });
    // How they went is said beside the river: what failed first, then the rest of the counts.
    await view.locator(".tributaries-title", { hasText: /^Audio loudness failed$/ }).waitFor({ timeout: 5000 });
    await view.locator(".tributaries-line", { hasText: /^1 of 6 checks failed, 2 still running, 1 skipped$/ }).waitFor({ timeout: 5000 });
    expect((await view.locator(".request-status .site-checks").count()) === 0, "the pull request's checks say how they went above the river as well as beside it");
    // In the smallest window, with the details open, the river's streams don't run under its
    // verdict (it goes under them when there's no room beside them), and the checks under it
    // keep their names.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 900, height: size.height });
    try {
      await page.waitForFunction(() => {
        const streams = document.querySelector(".request-view .tributaries-streams")?.getBoundingClientRect();
        const verdict = document.querySelector(".request-view .tributaries-verdict")?.getBoundingClientRect();
        const name = document.querySelector(".request-view .request-timeline-row .request-check-name")?.getBoundingClientRect();
        return streams && verdict && name && (verdict.top >= streams.bottom || verdict.left >= streams.right) && name.width > 40;
      }, null, { timeout: 5000 });
    } finally {
      await restoreSize(size);
    }
    // The description and comments are Markdown, shown as such.
    await view.locator(".request-comment-text").first().waitFor({ timeout: 5000 });
    await accessible("a pull request");
    // A failed check's name says why it failed, with its page a click away.
    await view.locator(".request-check", { hasText: "Audio loudness" }).getByRole("button").click();
    const why = page.locator(".dialog.check-why");
    await why.getByRole("button", { name: "Open on GitHub" }).click();
    expect((await page.evaluate(() => window.__PREVIEW__.opened)).some((url) => url.endsWith("/actions/runs/7")), "the check's page didn't open");
    await page.keyboard.press("Escape");
    await why.waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
    expect((await selected()) === before, `pressing the badge selected ${await selected()}, not ${before}`);
  });

  await step("shows an open pull request from its branch's commit", async () => {
    // The commit at the tip of fix/door: its pull request, saying where it stands as its view
    // does, with its title, who opened it and Show, under a heading with the site's chip, and
    // its checks under it, built the same way.
    await page.locator(".commit-row", { has: page.locator(".pr-badge", { hasText: "#14" }) }).first().click();
    const card = page.locator(".details .commit-request", { hasText: "#14" });
    await card.locator(".commit-request-standing", { hasText: "Can't be merged yet: changes were asked for" }).waitFor({ timeout: 5000 });
    expect(await card.evaluate((item) => item.classList.contains("bad")), "a pull request that can't be merged isn't shown in red");
    await card.locator(".commit-request-name", { hasText: "Make the door creak · theo-park" }).waitFor({ timeout: 5000 });
    await page.locator(".details .commit-requests h3", { hasText: "Pull request" }).waitFor({ timeout: 5000 });
    await page.locator(".details .commit-requests .site-chip", { hasText: "GitHub" }).waitFor({ timeout: 5000 });
    // Its checks, built the same way, with a pip for each.
    const headline = page.locator(".details .commit-checks-headline");
    await headline.filter({ hasText: /^\d+ of \d+ checks failed$/ }).waitFor({ timeout: 5000 });
    const total = Number((await headline.textContent()).match(/of (\d+)/)[1]);
    expect((await page.locator(".details .check-pips > span").count()) === total, `not a pip for each of the ${total} checks`);
    expect((await page.locator(".details .mentioned-issue", { hasText: "#14" }).count()) === 0, "the pull request is listed with the issues too");
    // With no label under the pointer, no lane is lit: the graph's nodes are at full strength.
    await page.waitForFunction(() => !document.querySelector(".commit-list.lane-lit"), null, { timeout: 2000 }).catch(async () => {
      const under = await page.evaluate(() => [...document.querySelectorAll(":hover")].map((element) => element.className).filter(Boolean).slice(-2).join(" > "));
      throw new Error(`a lane is lit with the pointer on ${under}`);
    });
    await accessible("an open pull request in a commit's details");
    await card.getByRole("button", { name: "Show" }).click();
    const view = page.locator(".request-view");
    await view.locator(".request-merge", { hasText: "changes were asked for" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("makes way for the history when searching from a pull request, with the kind menu as wide as its choice", async () => {
    await page.locator(".commit-row", { has: page.locator(".pr-badge", { hasText: "#14" }) }).first().click();
    await page.locator(".details .commit-request", { hasText: "#14" }).getByRole("button", { name: "Show" }).click();
    const view = page.locator(".request-view");
    await view.waitFor({ timeout: 10_000 });
    await page.keyboard.press("Control+f");
    await page.keyboard.type("creak");
    await view.waitFor({ state: "detached", timeout: 5000 });
    await page.locator(".commit-row", { hasText: "Make the door creak" }).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    // The menu of kinds is as wide as the one chosen: narrower for Code than for Everything.
    const menu = page.getByLabel("Search in");
    const width = async () => (await menu.boundingBox()).width;
    const everything = await width();
    await menu.selectOption("code");
    const code = await width();
    await menu.selectOption("everything");
    expect(code < everything - 20 && Math.abs((await width()) - everything) < 1, `the menu is ${everything}px for Everything and ${code}px for Code`);
    // Not cut short: the chosen kind's name fits.
    expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth), "the kind's name is cut short");
    await page.keyboard.press("Escape");
  });

  await step("comments on, approves and merges a pull request", async () => {
    await page.locator(".pr-badge", { hasText: "#12" }).first().click();
    const view = page.locator(".request-view");
    await view.locator(".request-comment", { hasText: "the build script reads it" }).waitFor({ timeout: 10_000 });
    await view.locator(".request-reply").first().click();
    await view.locator(".comment-box textarea").first().fill("Thanks!");
    await view.locator(".comment-box button", { hasText: "Reply" }).click();
    await view.locator(".request-comment.reply", { hasText: "Thanks!" }).waitFor({ timeout: 5000 });
    // The reply is done once it says so.
    await page.locator(".toast", { hasText: "Replied" }).waitFor({ timeout: 5000 });
    await view.locator(".request-toolbar").getByRole("button", { name: "Review", exact: true }).click();
    await view.locator(".review-box button", { hasText: "Approve" }).click();
    await page.locator(".toast", { hasText: "Approved #12" }).waitFor({ timeout: 5000 });
    await view.locator(".request-status button", { hasText: "Merge…" }).click();
    await page.locator(".dialog button.primary-button", { hasText: "Squash and merge" }).click();
    await page.locator(".toast", { hasText: "Merged #12" }).waitFor({ timeout: 5000 });
    const merged = await page.evaluate(() => window.__PREVIEW__.merged);
    expect(merged?.method === "squash" && merged.deleteBranch, JSON.stringify(merged));
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "detached", timeout: 5000 });
  });

  await step("opens a pull request from a branch's menu", async () => {
    const git = (...args) => execFileSync("git", ["-C", demos.studio, ...args], { encoding: "utf8" }).trim();
    // On a commit with no other labels, so its label shows (not folded into "+N").
    git("branch", "smoke/lights", git("log", "-1", "--format=%H", "--grep=Seat guests by the fire", "--all"));
    git("push", "-q", "origin", "smoke/lights");
    await page.evaluate(() => Object.assign(window.__PREVIEW__, { newRequest: { commits: [{ summary: "Warmer lights in the tavern", body: "Candles flicker now." }] } }));
    await page.keyboard.press("F5");
    await page.locator(".ref-pill", { hasText: "smoke/lights" }).first().click({ button: "right" });
    await page.locator(".menu-item", { hasText: "Create pull request…" }).click();
    const dialog = page.locator(".request-dialog");
    const title = dialog.getByLabel("Title");
    await title.waitFor({ timeout: 10_000 });
    expect((await title.inputValue()) === "Warmer lights in the tavern", "the title wasn't suggested from the commit");
    await dialog.getByLabel("Draft: not ready for review yet").check();
    await dialog.getByRole("button", { name: "Open pull request" }).click();
    await page.locator(".toast", { hasText: "Opened pull request #15" }).waitFor({ timeout: 10_000 });
    const created = await page.evaluate(() => window.__PREVIEW__.created);
    expect(created.branch === "smoke/lights" && created.base === "main" && created.draft && created.body === "Candles flicker now.", JSON.stringify(created));
    await page.locator(".pr-badge", { hasText: "#15" }).first().waitFor({ timeout: 10_000 });
    await page.locator(".toast").getByRole("button", { name: "Show" }).click();
    await page.locator(".request-view", { hasText: "Warmer lights in the tavern" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    // As it was, for the steps after this one.
    git("branch", "-D", "smoke/lights");
    git("push", "-q", "origin", "--delete", "smoke/lights");
    await page.evaluate((list) => Object.assign(window.__PREVIEW__, { pullRequests: list }), STUDIO_PULL_REQUESTS);
    await page.keyboard.press("F5");
    await dismissToast();
  });

  if (demos.assets) {
    await step("clones a repository without its Git LFS files", async () => {
      await page.evaluate((pick) => Object.assign(window.__PREVIEW__, { pick }), folder);
      await page.getByRole("button", { name: "New tab" }).click();
      await page.getByRole("button", { name: "Clone…" }).click();
      await page.getByPlaceholder(/github\.com/).fill(demos.assets);
      await page.getByRole("button", { name: "Choose…" }).click();
      await page.getByRole("button", { name: /Options for big repositories/ }).click();
      await page.getByLabel("Download Git LFS files later").check();
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await row("Add the main theme").waitFor({ timeout: 20_000 });
      const banner = page.locator(".notice-banner");
      await banner.waitFor({ timeout: 10_000 });
      const text = await banner.innerText();
      expect(/3 files stored with Git LFS haven't been downloaded/.test(text), `banner "${text}"`);
    });

    await step("downloads the Git LFS files", async () => {
      await page.getByRole("button", { name: "Download them" }).click();
      const text = await toast();
      expect(text.includes("Downloaded 3 files"), `toast "${text}"`);
      await page.locator(".notice-banner").waitFor({ state: "detached", timeout: 10_000 });
      await dismissToast();
    });

    await step("chooses which folders' Git LFS files to download", async () => {
      await page.getByRole("button", { name: "Repository settings" }).click();
      const dialog = page.locator(".dialog", { hasText: "Settings for" });
      await dialog.getByRole("tab", { name: "Git LFS" }).click();
      await dialog.getByLabel("Download Git LFS files").selectOption("only");
      await dialog.getByRole("button", { name: /^Add Concept/ }).click();
      await page.locator(".toast", { hasText: "Git LFS files are downloaded only from Concept" }).waitFor({ timeout: 10_000 });
      await dialog.locator(".name-chip", { hasText: "Concept" }).waitFor({ timeout: 10_000 });
      await dismissToast();
      await dialog.getByLabel("Download Git LFS files").selectOption("all");
      await page.locator(".toast", { hasText: "from every folder again" }).waitFor({ timeout: 10_000 });
      await dismissToast();
      await dialog.getByRole("button", { name: "Done" }).click();
      await dialog.waitFor({ state: "detached", timeout: 5000 });
    });
  }
}
