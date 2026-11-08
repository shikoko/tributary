// Renders the app icons from src-tauri/icons/app-icon.svg and app-icon-dark.svg (drawn by
// draw.py), with Chromium, whose gradients come out smooth (Tauri's own renderer bands them):
//
//   python3 tools/icons/draw.py && node tools/icons/render.mjs
//
// - icon.icns (macOS) keeps Apple's margins around the tile, like every other Dock icon.
// - Everything else (icon.ico for Windows, the PNGs for Linux) is the tile edge to edge, so
//   it's as big as it can be in a 16 px taskbar or title bar.
// - icons/theme/ holds the icons the app switches between to match its light or dark theme
//   (app_icon.rs): the Dock icon on macOS, the window's icon elsewhere.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const icons = join(root, "src-tauri", "icons");
const { chromium } = createRequire(import.meta.url)("playwright");
const work = mkdtempSync(join(tmpdir(), "tributary-icons-"));

const browser = await chromium.launch();
/** `svg` as a `size` px PNG; `bleed` crops the margins, so the tile fills it. */
async function render(svg, size, bleed, out) {
  let text = readFileSync(join(icons, svg), "utf8");
  if (bleed) text = text.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"');
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${text}`,
  );
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
}

const light = join(work, "light.png");
const lightFull = join(work, "light-full.png");
await render("app-icon.svg", 1024, false, light);
await render("app-icon.svg", 1024, true, lightFull);
mkdirSync(join(icons, "theme"), { recursive: true });
for (const theme of ["light", "dark"]) {
  const svg = theme === "light" ? "app-icon.svg" : "app-icon-dark.svg";
  await render(svg, 512, false, join(icons, "theme", `${theme}-dock.png`));
  await render(svg, 256, true, join(icons, "theme", `${theme}-window.png`));
}
await browser.close();

// Tauri's generator makes every size and format; run it on each source and keep what's wanted.
const tauri = (input, output) => execFileSync("npx", ["tauri", "icon", input, "-o", output], { cwd: root, stdio: "ignore" });
const full = join(work, "full");
const framed = join(work, "framed");
tauri(lightFull, full);
tauri(light, framed);
for (const name of ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "StoreLogo.png"]) {
  copyFileSync(join(full, name), join(icons, name));
}
for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
  copyFileSync(join(full, `Square${size}x${size}Logo.png`), join(icons, `Square${size}x${size}Logo.png`));
}
copyFileSync(join(framed, "icon.icns"), join(icons, "icon.icns"));
rmSync(work, { recursive: true, force: true });
console.log(`Rendered the icons into ${icons}`);
