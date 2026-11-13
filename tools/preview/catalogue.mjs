// The catalogue of building blocks (?catalogue), a section at a time in each theme, compared
// with the screenshots in tools/preview/catalogue/. A change to how a button, a chip, a colour
// or an icon looks fails here, with the screenshot it was compared with, the new one and the
// pixels that changed saved side by side, so it's seen before it's merged.
//
//   npm run preview:build && npm run preview:catalogue [-- --update] [-- --out <folder>]
//
// When the change is meant, --update saves the new screenshots: commit them with it.
// Needs Playwright with Chromium (as the smoke test does). The screenshots are taken on
// Ubuntu 24.04, which the checks on GitHub use too: elsewhere text can come out a pixel off.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startPreview } from "./server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const expected = join(here, "catalogue");
const update = process.argv.includes("--update");
const outAt = process.argv.indexOf("--out");
const out = outAt > 0 ? resolve(process.argv[outAt + 1]) : mkdtempSync(join(tmpdir(), "tributary-catalogue-"));
mkdirSync(out, { recursive: true });

let chromium;
try {
  // Through require, so a globally installed Playwright (NODE_PATH) is found too.
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("This needs Playwright: npm install --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

// A pixel counts as changed when a colour channel moves by more than this (of 255): less is
// the edge of a letter drawn a shade differently, which nobody would see.
const TOLERANCE = 24;

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dataUrl = (png) => `data:image/png;base64,${png.toString("base64")}`;

const preview = await startPreview({ port: 0, quiet: true });
// Text drawn without the hinting the system asks for, which differs between machines (GitHub's
// runners hint it slightly): hinted, a word can come out a pixel wider, and wrap or be cut
// short sooner.
const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
const compare = await browser.newPage();
const taken = new Set();
const changed = [];
const drawnWith = new Map();

/** The fonts the page's text is drawn with, and how many letters each: to tell why a machine draws it differently. */
async function fontsUsed() {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument", { depth: -1 });
  const visit = async (node) => {
    if (node.nodeType === 1) {
      const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId }).catch(() => ({ fonts: [] }));
      for (const font of fonts) {
        const name = `${font.familyName}${font.isCustomFont ? "" : " (the system's)"}`;
        drawnWith.set(name, (drawnWith.get(name) ?? 0) + font.glyphCount);
      }
    }
    for (const child of node.children ?? []) await visit(child);
  };
  await visit(root);
  await client.detach();
}

/** How `before` and `after` differ: their sizes, and the changed pixels in red over a faded `after`. */
async function difference(before, after) {
  return compare.evaluate(
    async ([a, b, tolerance]) => {
      const load = (src) => new Promise((done, fail) => Object.assign(new Image(), { onload() { done(this); }, onerror: fail, src }));
      const [one, two] = await Promise.all([load(a), load(b)]);
      if (one.width !== two.width || one.height !== two.height) return { size: `${one.width}×${one.height} → ${two.width}×${two.height}` };
      const pixels = (image) => {
        const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return [canvas, context, context.getImageData(0, 0, image.width, image.height)];
      };
      const [, , first] = pixels(one);
      const [canvas, context, second] = pixels(two);
      const marks = context.createImageData(two.width, two.height);
      let count = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        const moved = Math.max(Math.abs(first.data[i] - second.data[i]), Math.abs(first.data[i + 1] - second.data[i + 1]), Math.abs(first.data[i + 2] - second.data[i + 2]));
        const off = moved > tolerance;
        if (off) count++;
        marks.data.set(off ? [255, 0, 0, 255] : [second.data[i], second.data[i + 1], second.data[i + 2], 50], i);
      }
      if (count === 0) return { count };
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.putImageData(marks, 0, 0);
      return { count, marks: canvas.toDataURL("image/png") };
    },
    [dataUrl(before), dataUrl(after), TOLERANCE],
  );
}

try {
  for (const theme of ["dark", "light"]) {
    await page.goto(`${preview.url}?catalogue&theme=${theme}`);
    await page.locator(".catalogue-section h2", { hasText: "Buttons" }).waitFor({ timeout: 20_000 });
    // The fonts each loaded, not just asked for: until then the text is in another font.
    await page.evaluate(async () => {
      await Promise.all(["400 12px 'Google Sans Variable'", "700 12px 'Google Sans Variable'", "400 12px 'JetBrains Mono Variable'", "italic 400 12px 'JetBrains Mono Variable'"].map((font) => document.fonts.load(font)));
      await document.fonts.ready;
    });
    if (!update) await fontsUsed();
    for (const section of await page.locator(".catalogue-section").all()) {
      const name = `${theme}-${slug(await section.locator("h2").innerText())}.png`;
      taken.add(name);
      const shot = await section.screenshot({ animations: "disabled", caret: "hide" });
      const file = join(expected, name);
      if (update) {
        mkdirSync(expected, { recursive: true });
        writeFileSync(file, shot);
        continue;
      }
      if (!existsSync(file)) {
        changed.push(`${name}: new (run with --update to keep it)`);
        writeFileSync(join(out, name), shot);
        continue;
      }
      const before = readFileSync(file);
      const result = await difference(before, shot);
      if (!result.size && result.count === 0) continue;
      changed.push(`${name}: ${result.size ? `size ${result.size}` : `${result.count} pixels changed`}`);
      const base = join(out, name.replace(/\.png$/, ""));
      writeFileSync(`${base}.before.png`, before);
      writeFileSync(`${base}.after.png`, shot);
      if (result.marks) writeFileSync(`${base}.changed.png`, Buffer.from(result.marks.split(",")[1], "base64"));
    }
  }
  // Sections that aren't there any more.
  for (const name of existsSync(expected) ? readdirSync(expected) : []) {
    if (!name.endsWith(".png") || taken.has(name)) continue;
    if (update) rmSync(join(expected, name));
    else changed.push(`${name}: gone (run with --update to remove it)`);
  }
} finally {
  await browser.close();
  await preview.close();
}

if (update) {
  console.log(`Saved ${taken.size} screenshots of the catalogue in ${expected}`);
} else if (changed.length > 0) {
  console.log(`The catalogue looks different:\n  ${changed.join("\n  ")}\nBefore, after and the changed pixels are in ${out}`);
  console.log(`Its text was drawn with: ${[...drawnWith].map(([name, letters]) => `${name} (${letters} letters)`).join(", ")}`);
  process.exit(1);
} else {
  console.log(`The catalogue looks the same (${taken.size} screenshots)`);
}
