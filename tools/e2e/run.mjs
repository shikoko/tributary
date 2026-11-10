// End-to-end tests of the real desktop app (not the browser preview): the Tauri backend,
// its permissions, and the window. They drive the app through tauri-driver and the
// platform's WebDriver, so they run on Linux and Windows (macOS has no WebDriver for its
// web views). Run them on your computer, not on GitHub Actions:
//
//   npm run e2e               build the app, then test it
//   npm run e2e -- --no-build test the app already built
//
// Needs, once:
//   cargo install tauri-driver --locked
//   Linux:   the WebKit WebDriver (Debian and Ubuntu: sudo apt install webkit2gtk-driver),
//            and xvfb-run to test without a screen (it's used when there's no $DISPLAY)
//   Windows: msedgedriver.exe matching your Edge's version, on the PATH
//
// The app runs with its own temporary home folder and git settings: your real settings,
// repositories and Tributary's own data aren't touched. It's built with an identifier of its
// own, so it keeps its data apart from your Tributary's even where the home folder doesn't
// decide that (on Windows, the app's folders and its web view's storage are where Windows
// says, whatever HOME is).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSession } from "./webdriver.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const windows = process.platform === "win32";
const output = join(root, "tools", "e2e", "output");

function which(program) {
  try {
    execFileSync(windows ? "where" : "which", [program], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function prerequisites() {
  if (process.platform === "darwin") return "macOS has no WebDriver for the app's web view: run these on Linux or Windows.";
  if (!which("tauri-driver")) return "tauri-driver isn't installed: cargo install tauri-driver --locked";
  if (!windows && !which("WebKitWebDriver")) return "The WebKit WebDriver isn't installed (Debian and Ubuntu: sudo apt install webkit2gtk-driver).";
  if (windows && !which("msedgedriver")) return "msedgedriver.exe isn't on the PATH (download the one matching your Edge's version).";
  if (!windows && !process.env.DISPLAY && !which("xvfb-run")) return "There's no screen ($DISPLAY) and no xvfb-run to make one.";
  return null;
}

const missing = prerequisites();
if (missing) {
  console.error(missing);
  process.exit(1);
}

// The app, built with its pages inside it (as a release has them), with an identifier of its
// own, in a target folder of its own (so a `tauri dev` build, which has the real identifier,
// is never the one tested).
const IDENTIFIER = "io.github.shikoko.tributary.e2e";
const target = join(root, "src-tauri", "target", "e2e");
const binary = join(target, "debug", windows ? "tributary.exe" : "tributary");
if (!process.argv.includes("--no-build")) {
  console.log("Building the app…");
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: windows });
  execFileSync("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "tauri/custom-protocol", "--target-dir", target], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, TAURI_CONFIG: JSON.stringify({ identifier: IDENTIFIER }) },
  });
}
if (!existsSync(binary)) {
  console.error(`The app isn't built (${binary}): run without --no-build.`);
  process.exit(1);
}
if (!readFileSync(binary).includes(IDENTIFIER)) {
  console.error(`${binary} wasn't built for these tests (it would use your own Tributary's data): run without --no-build.`);
  process.exit(1);
}

// Where Windows keeps the app's data and its web view's storage (a first start each time).
// Elsewhere they're in the temporary home folder.
function forgetAppData() {
  if (!windows) return;
  for (const folder of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    // The web view's helper processes can hold its files for a moment after the app quits.
    if (folder) rmSync(join(folder, IDENTIFIER), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
forgetAppData();

// A home of its own, demo repositories, and git settings that aren't yours.
const sandbox = mkdtempSync(join(tmpdir(), "tributary-e2e-"));
// However the run ends (a failure while setting up too): tauri-driver stops, and the
// temporary home, the demos and the app's own data go.
let driver = null;
process.on("exit", () => {
  driver?.kill();
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  try {
    forgetAppData();
  } catch {
    // Cleared again at the next start.
  }
});
const { buildDemos, demoEnv } = await import("../preview/demo.mjs");
const demos = buildDemos(join(sandbox, "Projects"));
// No credential helper either: git's system settings can name one (Git for Windows sets
// its Credential Manager), and the app asks it for a GitHub token when a repository has a
// GitHub remote, as the studio demo does.
const demo = demoEnv(demos);
const settings = Number(demo.GIT_CONFIG_COUNT ?? 0);
const env = {
  ...process.env,
  ...demo,
  GIT_CONFIG_COUNT: String(settings + 1),
  [`GIT_CONFIG_KEY_${settings}`]: "credential.helper",
  [`GIT_CONFIG_VALUE_${settings}`]: "",
  HOME: join(sandbox, "home"),
  XDG_DATA_HOME: join(sandbox, "home", ".local", "share"),
  XDG_CONFIG_HOME: join(sandbox, "home", ".config"),
};
mkdirSync(env.HOME, { recursive: true });

// tauri-driver, on a screen of its own when there isn't one.
const port = 4444;
const [command, args] = !windows && !process.env.DISPLAY ? ["xvfb-run", ["-a", "tauri-driver", "--port", String(port)]] : ["tauri-driver", ["--port", String(port)]];
driver = spawn(command, args, { env, stdio: ["ignore", "inherit", "inherit"] });
const server = `http://127.0.0.1:${port}`;
for (let tries = 0; ; tries++) {
  const up = await fetch(`${server}/status`).then((response) => response.ok, () => false);
  if (up) break;
  if (tries > 50) {
    console.error("tauri-driver didn't start");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

let failures = 0;
const app = await startSession(server, binary);
async function step(name, run) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}\n      ${String(error.message ?? error).split("\n").join("\n      ")}`);
    mkdirSync(output, { recursive: true });
    const file = join(output, `${name.replace(/[^\w]+/g, "-").slice(0, 60)}.png`);
    await app.screenshot().then((png) => writeFileSync(file, png), () => {});
  }
}

console.log("Testing the desktop app:");
try {
  await step("starts", async () => {
    await app.waitFor(".tab-bar");
  });

  await step("may use every window and plugin call it makes (its permissions)", async () => {
    // Each call the app makes outside its own commands: a permission it lacks shows up
    // only here, never in the browser preview.
    const calls = [
      ["plugin:app|version", {}],
      ["plugin:window|set_title", { label: "main", value: "Tributary" }],
      ["plugin:window|is_maximized", { label: "main" }],
      ["plugin:window|set_progress_bar", { label: "main", value: { status: "none" } }],
      ["plugin:window|set_theme", { label: "main", value: null }],
      ["plugin:window|set_background_color", { label: "main", value: [20, 22, 27, 255] }],
      ["plugin:webview|set_webview_zoom", { label: "main", value: 1 }],
      ["plugin:notification|is_permission_granted", {}],
    ];
    const refused = await app.executeAsync(
      `const [calls, done] = arguments;
       Promise.all(calls.map(([command, args]) =>
         window.__TAURI_INTERNALS__.invoke(command, args).then(() => null, (error) => /not allowed|denied|permission/i.test(String(error)) ? command + ": " + error : null)
       )).then((answers) => done(answers.filter(Boolean)));`,
      [calls],
    );
    if (refused.length > 0) throw new Error(`Not allowed:\n${refused.join("\n")}`);
  });

  await step("opens a repository, through the real backend", async () => {
    await app.execute(
      `const [path] = arguments;
       localStorage.setItem("tributary.tabs.list", JSON.stringify([{ path, name: "studio" }]));
       localStorage.setItem("tributary.tabs.active", JSON.stringify(path));
       location.reload();`,
      [demos.studio],
    );
    await app.waitFor(".commit-row", { text: "Add a tavern chair", timeout: 30_000 });
  });

  await step("walks someone new through Getting started, and lets them skip it", async () => {
    await app.waitFor(".tour-card", { text: "The graph", timeout: 10_000 });
    await app.click(".tour-card button", "Next");
    await app.waitFor(".tour-card", { text: "2 of" });
    await app.click(".tour-card button", "Skip tour");
    await app.waitFor(".commit-row", { text: "Add a tavern chair" });
  });

  await step("commits, and undoes it from Your actions", async () => {
    writeFileSync(join(demos.studio, "notes.txt"), "Opening hours: noon till late\n");
    await app.click(".commit-row .summary.wip");
    // The studio's own uncommitted changes include two big files outside Git LFS: once the
    // app has found them, committing them asks first.
    await app.waitFor(".file-warning.large", { text: "Git LFS" });
    await app.click("button", "Stage all");
    await app.type('input[aria-label="Commit summary"]', "Write down the opening hours");
    await app.click(".commit-box .primary-small-button");
    await app.click(".commit-warning button", "Commit anyway");
    await app.waitFor(".commit-row", { text: "Write down the opening hours" });
    await app.click(".status-bar button", "Activity");
    await app.click('.activity-panel [role="tab"]', "Your actions");
    await app.click(".history-entry .history-undo");
    await app.waitFor(".history-entry.undone");
  });

  await step("opens team activity from the toolbar", async () => {
    await app.click('button[aria-label="Team activity"]');
    await app.waitFor(".team-view .team-person-card", { timeout: 20_000 });
  });

  await step("fetches from its remote", async () => {
    // The app fetches by itself too, a few seconds after a repository opens, so the status
    // bar says "Fetched" already: this fetch has to leave its own mark (every fetch writes
    // FETCH_HEAD, which is what the status bar tells the time of).
    const fetchHead = join(demos.studio, ".git", "FETCH_HEAD");
    const written = () => (existsSync(fetchHead) ? statSync(fetchHead).mtimeMs : 0);
    const before = written();
    await app.click(".tool-button", "Fetch");
    await app.waitFor(".status-bar", { text: "Fetched", timeout: 30_000 });
    for (const until = Date.now() + 30_000; written() <= before; ) {
      if (Date.now() > until) throw new Error("Fetch didn't fetch (FETCH_HEAD wasn't written)");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  await step("checks the project's setup", async () => {
    await app.execute(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));`);
    await app.click(".menu-bar-item", "Repository");
    // It's in the Tools submenu, which opens on a click too.
    await app.click(".menu-item", "Tools");
    await app.click(".menu-item", "Check Project Setup");
    await app.waitFor(".setup-item", { timeout: 20_000 });
  });
} finally {
  await app.quit();
}

console.log(failures === 0 ? "All good" : `${failures} failed (screenshots in tools/e2e/output)`);
process.exit(failures === 0 ? 0 : 1);
