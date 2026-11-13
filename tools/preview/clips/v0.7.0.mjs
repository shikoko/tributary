// What's new in 0.7.0, for What's New and the release page (see clips.mjs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Clicks what the pointer is on. */
const click = (page) => page.mouse.click(page.pointerAt.x, page.pointerAt.y);

/** Points at `target`, then clicks it, and waits `ms`. */
async function press(page, point, pause, target, ms) {
  await point(page, target);
  await pause(page, 250);
  await click(page);
  await pause(page, ms);
}

const LANTERNS = "Light the tavern with lanterns";

/**
 * A commit with files added, changed and deleted across the studio's folders, on a branch of
 * its own: made with an index of its own, so the demo's uncommitted changes stay as they are.
 */
function lanternCommit(repo) {
  const git = (args, options = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", ...options }).trim();
  const folder = mkdtempSync(join(tmpdir(), "tributary-clip-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") };
  try {
    git(["read-tree", "HEAD"], { env });
    const put = (path, text) => {
      const blob = execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: text, encoding: "utf8" }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    };
    const added = ["Content/Props/Lantern.uasset", "Content/Materials/M_Flame.uasset", "Content/Materials/MI_Flame_Warm.uasset", "Content/Audio/FireCrackle.wav", "Content/Textures/T_Flame.tga", "Source/Feast/Lighting/FlickerComponent.cpp", "Source/Feast/Lighting/FlickerComponent.h"];
    const changed = ["Content/Maps/Tavern.umap", "Content/__ExternalActors__/Maps/Tavern/4/C4/0K8G00GCW40O0OGWO4G40W.uasset", "Content/__ExternalActors__/Maps/Tavern/8/K0/44SKOOW0CSWOGWW4O8KKOO.uasset", "Source/Feast/FeastGameMode.cpp", "Config/DefaultGame.ini"];
    for (const path of added) put(path, `${path}\n`);
    for (const path of changed) put(path, `${path}, with lanterns\n`);
    git(["update-index", "--force-remove", "Content/Props/Stool.glb"], { env });
    const tree = git(["write-tree"], { env });
    const [name, email] = git(["log", "-1", "--format=%an%n%ae"]).split("\n");
    const who = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
    const commit = git(["commit-tree", tree, "-p", "HEAD", "-m", LANTERNS], { env: { ...process.env, ...who } });
    git(["update-ref", "refs/heads/lanterns", commit]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export default {
  /** The View panel: the theme, how commits are drawn, and the rows, each seen straight away. */
  async "view-panel"({ open, point, pause, demos, record }) {
    const page = await open(demos.studio);
    const button = page.getByRole("button", { name: "View options" });
    const panel = page.locator(".view-panel");
    const choice = (name) => panel.getByRole("button", { name, exact: true });
    // The graph and the panel over it, 16:10.
    await record(page, { x: 220, y: 36, width: 960, height: 600 }, async () => {
      await pause(page, 900);
      await press(page, point, pause, button, 1100);
      await press(page, point, pause, choice("Light"), 1700);
      await press(page, point, pause, choice("Dark"), 1100);
      await press(page, point, pause, choice("Dots"), 1600);
      await press(page, point, pause, choice("Pictures"), 1000);
      // Closed with the button it opened from, as it started.
      await press(page, point, pause, button, 900);
    });
    await page.close();
  },

  /** A commit's changed files as a tree: switched to, a folder closed and opened, and back to the list. */
  async "files-tree"({ open, point, pause, demos, record }) {
    lanternCommit(demos.studio);
    const page = await open(demos.studio);
    await page.locator(".commit-row", { has: page.locator(".summary", { hasText: LANTERNS }) }).first().click();
    const files = page.locator(".details .files");
    await files.locator(".file").first().waitFor({ timeout: 10_000 });
    // The commit's details are short, so the panel can't scroll its files to the top: empty room
    // below them lets it, and they stay there as folders open and close.
    await page.addStyleTag({ content: ".details-scroll::after { content: ''; display: block; height: 70vh; }" });
    await files.evaluate((section) => section.scrollIntoView({ block: "start" }));
    await pause(page, 400);
    const layout = (name) => files.getByRole("button", { name, exact: true });
    const folder = (name) => files.locator(".file-folder-toggle", { hasText: name }).first();
    // The commits' messages, the selected one at the top, and its files beside them, 16:10.
    await record(page, { x: 460, y: 85, width: 820, height: 512 }, async () => {
      await pause(page, 1300);
      await press(page, point, pause, layout("Tree"), 1900);
      await press(page, point, pause, folder("__ExternalActors__"), 1300);
      await press(page, point, pause, folder("Content"), 1500);
      await press(page, point, pause, folder("Content"), 1000);
      await press(page, point, pause, folder("__ExternalActors__"), 1300);
      await press(page, point, pause, layout("List"), 1000);
    });
    await page.close();
  },
};
