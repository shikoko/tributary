// Runs one smoke test file in a browser of its own: `node worker.mjs <file> [--browser webkit]
// [--screenshots <folder>]`. Prints its steps, then a line starting with OFFCENTRE (what
// ALIGNED=report found), and exits with how many of its steps failed.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startSession } from "./session.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const file = resolve(args[0]);
const browserName = option("--browser") ?? "chromium";
const screenshots = option("--screenshots");
const require = createRequire(import.meta.url);

// Through require, so a globally installed Playwright (NODE_PATH) is found too.
const engine = require("playwright")[browserName];
// axe-core, which checks a page against WCAG's success criteria, as a script for the page.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const browser = await engine.launch();
// On a Mac, Tributary's menus are in the Mac's own menu bar, which a page in a browser hasn't
// got, and the steps open them from the window's: so the page is told it's on Linux. The
// engine drawing it and running it is still the browser's own.
let userAgent;
if (process.platform === "darwin") {
  const probe = await browser.newPage();
  userAgent = (await probe.evaluate(() => navigator.userAgent)).replace(/\(Macintosh;[^)]*\)/, "(X11; Linux x86_64)");
  await probe.close();
}

const name = basename(file, ".mjs");
const session = await startSession({ browser, browserName, userAgent, axeSource, screenshots, name });
try {
  const { default: run } = await import(pathToFileURL(file).href);
  await run(session);
  await session.step("had no errors on the page", async () => {
    session.expect(session.errors.length === 0, session.errors.join("; "));
  });
} catch (error) {
  session.failed.push("(the file itself)");
  session.log(`  ✗ ${name} stopped: ${String(error.stack ?? error)}`);
} finally {
  await session.close().catch(() => {});
  await browser.close().catch(() => {});
}
for (const line of session.lines) console.log(line);
console.log(`OFFCENTRE ${JSON.stringify([...session.offCentre])}`);
console.log(`FAILED ${JSON.stringify(session.failed)}`);
process.exit(Math.min(session.failed.length, 100));
