// Runs the smoke test's files (steps/*.mjs), several at once, each in a worker process with
// a browser and fresh demo repositories of its own. A file that fails is run once more from
// the start: if it passes then, its first failures are reported as flaky, not as failures.
//
//   node tools/preview/smoke/run.mjs [--browser webkit] [--screenshots <folder>]
//     [--only history,tabs] [--workers 3]

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const browserName = option("--browser") ?? "chromium";
const screenshots = option("--screenshots") ? resolve(option("--screenshots")) : null;
const only = option("--only")?.split(",").map((name) => name.trim());
// One browser, preview server and git per file: a core each, and one for the rest.
const workers = Number(option("--workers") ?? process.env.SMOKE_WORKERS ?? Math.max(1, Math.min(4, cpus().length - 1)));

const files = readdirSync(join(here, "steps"))
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => file.replace(/\.mjs$/, ""))
  .filter((name) => !only || only.includes(name))
  .sort();

/** One run of the file `name`: what it printed, what failed, and what ALIGNED=report found. */
function runFile(name) {
  return new Promise((done) => {
    const flags = [join(here, "steps", `${name}.mjs`), "--browser", browserName, ...(screenshots ? ["--screenshots", screenshots] : [])];
    const child = spawn(process.execPath, [join(here, "worker.mjs"), ...flags], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const lines = out.split("\n");
      const marked = (mark) => JSON.parse(lines.find((line) => line.startsWith(`${mark} `))?.slice(mark.length + 1) ?? "null");
      const failed = marked("FAILED") ?? [`(it stopped: exit ${code})`];
      const text = lines.filter((line) => line && !line.startsWith("OFFCENTRE ") && !line.startsWith("FAILED ")).join("\n");
      done({ name, text, failed, offCentre: marked("OFFCENTRE") ?? [] });
    });
  });
}

console.log(`Tributary smoke test: ${files.length} files, ${workers} at a time, in ${browserName}`);
const started = Date.now();
const results = new Map();
const queue = [...files];
async function work() {
  for (let name = queue.shift(); name; name = queue.shift()) {
    let result = await runFile(name);
    let flaky = [];
    if (result.failed.length > 0) {
      flaky = result.failed;
      const again = await runFile(name);
      if (again.failed.length === 0) result = again;
      else flaky = [];
    }
    results.set(name, { ...result, flaky });
    const mark = result.failed.length > 0 ? "✗" : flaky.length > 0 ? "~" : "✓";
    console.log(`\n${mark} ${name}${flaky.length > 0 ? " (passed when run again)" : ""}\n${result.text}`);
  }
}
await Promise.all(Array.from({ length: Math.min(workers, files.length) }, work));

const offCentre = new Map();
for (const { offCentre: found } of results.values()) for (const [line, where] of found) offCentre.set(line, [...(offCentre.get(line) ?? []), ...where]);
if (offCentre.size > 0) {
  console.log(`\nWords off the middle of their controls (${offCentre.size}):`);
  for (const [line, where] of offCentre) console.log(`  ${line}  [${[...new Set(where)].join(", ")}]`);
}
const failed = [...results.values()].flatMap(({ name, failed: steps }) => steps.map((step) => `${name}: ${step}`));
const flaky = [...results.values()].flatMap(({ name, flaky: steps }) => steps.map((step) => `${name}: ${step}`));
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (flaky.length > 0) console.log(`\nFlaky (failed, then passed when its file ran again):\n  ${flaky.join("\n  ")}`);
console.log(failed.length > 0 ? `\n${failed.length} failed, in ${minutes} min:\n  ${failed.join("\n  ")}` : `\nAll good, in ${minutes} min`);
process.exit(failed.length > 0 ? 1 : 0);
