// What's new in a version, as short moving pictures: each scene in clips/<version>.mjs is
// played in the browser preview, on the demo repositories, and recorded as an animated WebP
// in docs/release-notes/<version>/<name>.webp. What's New shows them, and so does the
// release page.
//
//   npm run preview:build && node tools/preview/clips.mjs v0.6.0 [--only <name>,…]
//
// A scene opens a window (`open`), says which part of it to show (`record`'s region, in the
// window's own pixels) and what happens in it. A pointer is drawn where the mouse is, so
// it's clear what's being pointed at. They loop: end where they started.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDemos, demoEnv } from "./demo.mjs";
import { startLockServer } from "./lfs-locks.mjs";
import { startPreview } from "./server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const version = args.find((arg) => /^v\d/.test(arg));
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(",")) : null;
if (!version) {
  console.error("Which version's? node tools/preview/clips.mjs v0.6.0 [--only <name>,…]");
  process.exit(1);
}
const scenes = (await import(pathToFileURL(join(here, "clips", `${version}.mjs`)).href)).default;
const out = join(here, "..", "..", "docs", "release-notes", version);
mkdirSync(out, { recursive: true });

/** Frames a second, and how wide the pictures are at most: twice the width What's New shows them at. */
const FPS = 15;
const WIDTH = 1200;

const { chromium } = createRequire(import.meta.url)("playwright");
const projects = join(tmpdir(), "tributary-clips", "Projects");
rmSync(projects, { recursive: true, force: true });
mkdirSync(projects, { recursive: true });
const locks = await startLockServer({ port: 0 });
const demos = buildDemos(projects, { lockServer: locks.url });
const preview = await startPreview({ port: 0, quiet: true, env: demoEnv(demos) });
const browser = await chromium.launch();

/** The pointer, drawn where the mouse is (a recording has none of its own). */
const POINTER = () => {
  const draw = () => {
    const pointer = document.createElement("div");
    pointer.setAttribute("aria-hidden", "true");
    pointer.style.cssText = "position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; display: none; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.5));";
    pointer.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14 L10.2 20.4 L13 19.2 L10.1 12.9 L15.8 12.9 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    addEventListener(
      "mousemove",
      (event) => {
        pointer.style.display = "block";
        pointer.style.transform = `translate(${event.clientX - 3}px, ${event.clientY - 2}px)`;
      },
      true,
    );
  };
  if (document.body) draw();
  else addEventListener("DOMContentLoaded", draw);
};

/** A new window on the preview (`width` by `height`, as `version` if given), opening `repo` (or the start screen without one). */
async function open(repo, { theme = "dark", storage = {}, fakes = {}, width = 1280, height = 780, version } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("  page error:", String(error)));
  // The version the app says it is (the preview's own otherwise): set first, so the preview's stays out.
  if (version) {
    await page.addInitScript((version) => Object.defineProperty(window, "__PREVIEW_VERSION__", { get: () => version, set: () => {}, configurable: false }), version);
  }
  await page.addInitScript(
    ([pick, fakes, storage, theme]) => {
      window.__PREVIEW__ = { pick, pullRequests: [], ...fakes };
      localStorage.setItem("tributary.fetch.auto", "false");
      localStorage.setItem("tributary.whatsNew.seen", JSON.stringify("999.0.0"));
      localStorage.setItem("tributary.tours.off", "true");
      localStorage.setItem("tributary.appearance", JSON.stringify({ theme }));
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
    },
    [repo ?? null, fakes, storage, theme],
  );
  await page.addInitScript(POINTER);
  await page.goto(preview.url);
  if (repo) {
    await page.getByText("Open repository").first().click();
    await page.locator(".commit-row, .simple-view").first().waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Not now" }).click({ timeout: 3000 }).catch(() => {});
  }
  // Out of the way until the scene moves it.
  page.pointerAt = { x: width - 1, y: height - 1 };
  await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
  return page;
}

/** Moves the pointer to the middle of `target` (a locator, or { x, y }), at a steady pace. */
async function point(page, target, { dx = 0, dy = 0 } = {}) {
  const box = "x" in target && !("boundingBox" in target) ? { ...target, width: 0, height: 0 } : await target.boundingBox();
  const to = { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
  const from = page.pointerAt;
  const steps = Math.max(8, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 14));
  await page.mouse.move(to.x, to.y, { steps });
  page.pointerAt = to;
}

/**
 * Records `region` of `page` (in the window's pixels) while `actions` run, as `name`.webp:
 * screenshots, one after another as fast as they come (sharp, at twice the size), placed on
 * a steady clock.
 */
async function record(page, name, region, actions) {
  const shots = [];
  let running = true;
  const shooting = (async () => {
    while (running) {
      const before = Date.now();
      // JPEG, nearly lossless: three times as fast as PNG for a big part of the window.
      const data = await page.screenshot({ clip: region, type: "jpeg", quality: 95 });
      shots.push({ data, time: (before + Date.now()) / 2 });
    }
  })();
  const start = Date.now();
  try {
    await actions();
  } finally {
    running = false;
    await shooting;
  }
  const end = Date.now();

  const folder = mkdtempSync(join(tmpdir(), "tributary-clip-"));
  try {
    // At each tick, the newest screenshot by then.
    let at = 0;
    const count = Math.max(1, Math.round(((end - start) / 1000) * FPS));
    for (let tick = 0; tick < count; tick++) {
      const time = start + (tick * 1000) / FPS;
      while (at + 1 < shots.length && shots[at + 1].time <= time) at++;
      writeFileSync(join(folder, `${String(tick).padStart(5, "0")}.jpg`), shots[at].data);
    }
    const file = join(out, `${name}.webp`);
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-framerate", String(FPS),
      "-i", join(folder, "%05d.jpg"),
      "-vf", `scale=${Math.min(WIDTH, region.width * 2)}:-2:flags=lanczos`,
      "-c:v", "libwebp_anim", "-quality", "80", "-compression_level", "6", "-loop", "0",
      file,
    ]);
    const rate = shots.length / ((end - start) / 1000);
    console.log(`  ${name}.webp: ${((end - start) / 1000).toFixed(1)} s, ${rate.toFixed(0)} screenshots a second, ${Math.round(statSync(file).size / 1024)} KB`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const pause = (page, ms) => page.waitForTimeout(ms);

try {
  for (const [name, play] of Object.entries(scenes)) {
    if (only && !only.has(name)) continue;
    console.log(name);
    await play({ open, point, pause, demos, record: (page, region, actions) => record(page, name, region, actions) });
  }
} finally {
  await browser.close();
  await preview.close?.();
  locks.close?.();
}
process.exit(0);
