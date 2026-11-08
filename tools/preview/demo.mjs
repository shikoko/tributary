// Builds demo repositories to try Tributary on, with made-up people:
//
//   notebook   a small app: feature branches, merges, tags, a stash, uncommitted work,
//              and a local "origin" that a teammate has pushed to since the last fetch
//   studio     a game: lockable assets (Git LFS locking, served by lfs-locks.mjs), big
//              files that aren't in LFS, a commit lost to a reset, and a branch per
//              pull request
//   assets     a remote whose files are stored with Git LFS, to clone (with Git LFS installed)
//
//   node tools/preview/demo.mjs [folder]           build them (default: in the system's temp)
//   node tools/preview/demo.mjs --serve [folder]   and run the preview on them (npm run preview:demo)

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The git identity for the preview's own commits and stashes in the demo repositories,
 * so that your name doesn't end up in screenshots (git takes these over the repository's
 * settings).
 */
export const DEMO_IDENTITY = {
  GIT_AUTHOR_NAME: "Maya Chen",
  GIT_AUTHOR_EMAIL: "maya@example.com",
  GIT_COMMITTER_NAME: "Maya Chen",
  GIT_COMMITTER_EMAIL: "maya@example.com",
};

/**
 * What the preview runs git with on the demo repositories: Maya Chen's identity, and
 * permission to clone the notebook's submodule from a folder on this computer (git only
 * allows that when asked to, since 2.38).
 */
export const DEMO_ENV = {
  ...DEMO_IDENTITY,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
};

const PEOPLE = {
  maya: ["Maya Chen", "maya@example.com"],
  sam: ["Sam Okafor", "sam@example.com"],
  lena: ["Lena Fischer", "lena@example.com"],
  diego: ["Diego Ramos", "diego@example.com"],
  priya: ["Priya Nair", "priya@example.com"],
  rosa: ["Rosa Bell", "rosa@example.com"],
  theo: ["Theo Park", "theo@example.com"],
};

/** Runs git in one repository, as one person at a time, on a clock that moves forward. */
function repository(folder, { configFile, start }) {
  let clock = start;
  const run = (args, { who = "maya", hours = 0 } = {}) => {
    clock += Math.round(hours * 3600);
    const [name, email] = PEOPLE[who];
    const date = `@${clock} +0100`;
    return execFileSync("git", args, {
      cwd: folder,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Nothing from your own git setup (signing, hooks, templates) gets in.
        GIT_CONFIG_GLOBAL: configFile,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    }).trim();
  };
  const write = (path, text, { append = true } = {}) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    (append ? appendFileSync : writeFileSync)(join(folder, path), text);
  };
  const binary = (path, bytes) => write(path, randomBytes(bytes), { append: false });
  const commit = (message, who, hours, ...paths) => {
    for (const path of paths) write(path, `${message}\n`);
    run(["add", "-A"]);
    run(["commit", "-q", "-m", message], { who, hours });
  };
  return { folder, run, write, binary, commit };
}

/** A square RGBA PNG, `paint(x, y)` giving each pixel's [r, g, b, a]. */
function png(size, paint) {
  const stride = size * 4 + 1;
  const rows = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) rows.set(paint(x, y), y * stride + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** A coin icon: dull bronze, or shiny gold with a glint. */
function coin(shiny) {
  const [r, g, b] = shiny ? [255, 196, 46] : [168, 112, 62];
  return png(96, (x, y) => {
    const dx = x - 47.5;
    const dy = y - 47.5;
    const distance = Math.hypot(dx, dy);
    const alpha = Math.max(0, Math.min(1, 44 - distance));
    if (alpha === 0) return [0, 0, 0, 0];
    let light = 1 - (dx + dy) / 160 - (distance > 37 ? 0.25 : 0);
    if (shiny) light += Math.max(0, 0.6 - Math.hypot(dx + 16, dy + 16) / 14);
    if (Math.abs(dx) < 4 && Math.abs(dy) < 18 && distance < 37) light -= 0.3;
    const shade = (channel) => Math.max(0, Math.min(255, Math.round(channel * light)));
    return [shade(r), shade(g), shade(b), Math.round(alpha * 255)];
  });
}

const days = (n) => n * 86400;
const now = () => Math.floor(Date.now() / 1000);

function setUp(folder, configFile) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main", folder], { env: { ...process.env, GIT_CONFIG_GLOBAL: configFile } });
  execFileSync("git", ["-C", folder, "config", "user.name", PEOPLE.maya[0]]);
  execFileSync("git", ["-C", folder, "config", "user.email", PEOPLE.maya[1]]);
  execFileSync("git", ["-C", folder, "config", "commit.gpgsign", "false"]);
}

/** A bare repository to push to, and a teammate's clone of it. */
function remote(root, name, configFile) {
  const bare = join(root, "remotes", `${name}.git`);
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(dirname(bare), { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", bare], { env: { ...process.env, GIT_CONFIG_GLOBAL: configFile } });
  return bare;
}

/** A library the notebook keeps as a submodule, with three versions. Resolves to its address and commits. */
function buildEditorKit(root, configFile) {
  const remoteFolder = remote(root, "editor-kit", configFile);
  const folder = join(root, "remotes", "editor-kit-work");
  setUp(folder, configFile);
  const kit = repository(folder, { configFile, start: now() - days(9) });
  const versions = [
    ["Editor kit: a basic toolbar", "diego", "export const toolbar = [\"bold\", \"italic\"];\n"],
    ["Add a Markdown preview", "priya", "export const preview = (text: string) => render(text);\n"],
    ["Render long notes faster", "diego", "export const chunkSize = 4096;\n"],
  ];
  const ids = versions.map(([message, who, line]) => {
    kit.write("src/index.ts", line);
    kit.run(["add", "-A"]);
    kit.run(["commit", "-q", "-m", message], { who, hours: 20 });
    return kit.run(["rev-parse", "HEAD"]);
  });
  kit.run(["remote", "add", "origin", remoteFolder]);
  kit.run(["push", "-q", "origin", "main"]);
  return { url: remoteFolder, ids };
}

/** The notebook's storage code, before and after it learned to open large notebooks quickly. */
const STORE = {
  indexedDb: `import { openDB, type IDBPDatabase } from "idb";
import type { Note } from "./note";

const DATABASE = "notebook";
const VERSION = 1;

let database: Promise<IDBPDatabase> | null = null;

function open(): Promise<IDBPDatabase> {
  database ??= openDB(DATABASE, VERSION, {
    upgrade(db) {
      db.createObjectStore("notes", { keyPath: "id" });
    },
  });
  return database;
}

export async function saveNote(note: Note): Promise<void> {
  const db = await open();
  await db.put("notes", note);
}

export async function loadNotes(): Promise<Note[]> {
  const db = await open();
  const notes = await db.getAll("notes");
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await open();
  await db.delete("notes", id);
}
`,
  paged: `import { openDB, type IDBPDatabase } from "idb";
import type { Note } from "./note";

const DATABASE = "notebook";
const VERSION = 2;
/** Notes shown before scrolling; the rest load as you scroll. */
const PAGE_SIZE = 200;

let database: Promise<IDBPDatabase> | null = null;

function open(): Promise<IDBPDatabase> {
  database ??= openDB(DATABASE, VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) db.createObjectStore("notes", { keyPath: "id" });
      if (oldVersion < 2) transaction.objectStore("notes").createIndex("updatedAt", "updatedAt");
    },
  });
  return database;
}

export async function saveNote(note: Note): Promise<void> {
  const db = await open();
  await db.put("notes", note);
}

export async function loadNotes(before?: number): Promise<Note[]> {
  const db = await open();
  const range = before === undefined ? null : IDBKeyRange.upperBound(before, true);
  const notes: Note[] = [];
  let cursor = await db.transaction("notes").store.index("updatedAt").openCursor(range, "prev");
  while (cursor && notes.length < PAGE_SIZE) {
    notes.push(cursor.value);
    cursor = await cursor.continue();
  }
  return notes;
}

export async function deleteNote(id: string): Promise<void> {
  const db = await open();
  await db.delete("notes", id);
}
`,
};

export function buildNotebook(root, configFile) {
  const folder = join(root, "notebook");
  setUp(folder, configFile);
  const repo = repository(folder, { configFile, start: now() - days(6) - 3600 });
  const { run, commit } = repo;
  const branch = (name) => run(["checkout", "-q", "-b", name]);
  const checkout = (name) => run(["checkout", "-q", name]);
  const merge = (name, message, who, hours = 2) => run(["merge", "-q", "--no-ff", name, "-m", message], { who, hours });

  commit("Initial commit", "maya", 0, "README.md");
  commit("Set up the project structure", "maya", 3, "src/app.ts");
  // The editor kit as a submodule, at its first version.
  const kit = buildEditorKit(root, configFile);
  run(["-c", "protocol.file.allow=always", "submodule", "add", "-q", kit.url, "vendor/editor-kit"]);
  run(["-C", "vendor/editor-kit", "checkout", "-q", kit.ids[0]]);
  run(["add", "vendor/editor-kit"]);
  run(["commit", "-q", "-m", "Add the editor kit as a submodule"], { who: "maya", hours: 1 });
  commit("Add the note model", "sam", 3, "src/note.ts");
  run(["tag", "v0.1.0"]);
  branch("feature/sync");
  commit("Add a sync client skeleton", "diego", 5, "src/sync/client.ts");
  commit("Retry failed sync requests", "diego", 4, "src/sync/retry.ts");
  checkout("main");
  repo.write("src/store.ts", STORE.indexedDb, { append: false });
  commit("Store notes in IndexedDB", "maya", 3);
  commit("Show the last edited time on notes", "sam", 6, "src/ui/note.tsx");
  branch("fix/search-crash");
  commit("Fix a crash when searching an empty notebook", "priya", 4, "src/search.ts");
  commit("Add a regression test for empty searches", "priya", 2, "tests/search.test.ts");
  checkout("main");
  merge("fix/search-crash", "Merge pull request #12 from fix/search-crash", "maya");
  branch("feature/tags");
  commit("Add tags to the note model", "lena", 5, "src/note.ts");
  commit("Filter notes by tag", "lena", 6, "src/ui/filter.tsx");
  checkout("feature/sync");
  commit("Sync deleted notes", "diego", 3, "src/sync/deletes.ts");
  merge("main", "Merge branch 'main' into feature/sync", "diego", 3);
  checkout("main");
  commit("Update dependencies", "sam", 4, "package.json");
  checkout("feature/tags");
  commit("Colour-code tags", "lena", 5, "src/ui/tag.tsx");
  commit("Keyboard shortcut for adding tags", "lena", 3, "src/ui/shortcuts.ts");
  checkout("main");
  merge("feature/tags", "Merge pull request #15 from feature/tags", "maya", 4);
  run(["tag", "v0.2.0"]);
  checkout("feature/sync");
  commit("Resolve conflicting edits on sync", "diego", 6, "src/sync/conflicts.ts");
  commit("Document the sync protocol", "diego", 4, "docs/sync.md");
  checkout("main");
  branch("feature/export");
  commit("Export notes as Markdown", "sam", 5, "src/export/markdown.ts");
  checkout("main");
  merge("feature/sync", "Merge pull request #18 from feature/sync", "maya", 3);
  checkout("feature/export");
  commit("Export a whole notebook as a zip", "sam", 4, "src/export/zip.ts");
  checkout("main");
  repo.write("src/store.ts", STORE.paged, { append: false });
  commit("Speed up opening large notebooks", "priya", 5);
  branch("feature/themes");
  commit("Add a theme picker", "maya", 3, "src/ui/theme.tsx");
  checkout("main");
  commit("Fix the note counter in the sidebar", "lena", 2, "src/ui/sidebar.tsx");
  checkout("feature/themes");
  commit("High-contrast theme", "maya", 2, "src/ui/themes/contrast.ts");
  checkout("main");
  // A newer editor kit, recorded by Priya.
  run(["-C", "vendor/editor-kit", "checkout", "-q", kit.ids[2]]);
  run(["add", "vendor/editor-kit"]);
  run(["commit", "-q", "-m", "Use the editor kit's faster rendering"], { who: "priya", hours: 1 });
  repo.write("src/ui/sidebar.tsx", "collapsible sidebar experiment\n");
  run(["stash", "push", "-q", "-m", "Try a collapsible sidebar"], { who: "lena", hours: 1 });
  commit("Prepare the 0.3 release notes", "sam", 1.5, "CHANGELOG.md");

  // Published up to the commit before last; a teammate has pushed since.
  const origin = remote(root, "notebook", configFile);
  run(["remote", "add", "origin", origin]);
  run(["push", "-q", "origin", "main~1:refs/heads/main", "feature/export"]);
  run(["fetch", "-q", "origin"]);
  run(["branch", "-q", "--set-upstream-to=origin/main", "main"]);
  const teammate = join(root, "remotes", "notebook-teammate");
  rmSync(teammate, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", origin, teammate], { env: { ...process.env, GIT_CONFIG_GLOBAL: configFile } });
  const priya = repository(teammate, { configFile, start: now() - 3600 });
  priya.run(["commit", "-q", "--allow-empty", "-m", "Tidy up the settings screen"], { who: "priya" });
  priya.run(["push", "-q", "origin", "main", "HEAD:refs/heads/feature/onboarding"]);

  // The editor kit here is still at its first version, as after a pull that didn't
  // update submodules.
  run(["-C", "vendor/editor-kit", "checkout", "-q", kit.ids[0]]);

  // Uncommitted work: a staged file, a changed file and a new one. None of it is in the
  // way of checking out another branch.
  repo.write("src/ui/onboarding/welcome.tsx", "welcome\n");
  run(["add", "src/ui/onboarding/welcome.tsx"]);
  repo.write("README.md", "\n## Onboarding\n\nA short tour on first launch.\n");
  repo.write("src/ui/onboarding/tour.tsx", "tour\n");
  return folder;
}

export function buildStudio(root, configFile, { lockServer = "http://127.0.0.1:4174/lfs" } = {}) {
  const folder = join(root, "studio");
  setUp(folder, configFile);
  const repo = repository(folder, { configFile, start: now() - days(5) });
  const { run, binary, write } = repo;
  const commit = (message, who, hours = 1.5) => {
    run(["add", "-A"]);
    run(["commit", "-q", "-m", message], { who, hours });
  };
  run(["config", "lfs.url", lockServer]);
  const origin = remote(root, "studio", configFile);
  run(["remote", "add", "origin", origin]);

  write(".gitattributes", "*.uasset lockable\n*.umap lockable\n", { append: false });
  write("Config/DefaultGame.ini", "[/Script/EngineSettings.GeneralProjectSettings]\nProjectName=Feast of the Forgotten\n", { append: false });
  write("Source/Feast/FeastGameMode.cpp", "// Game mode\n", { append: false });
  binary("Content/Characters/Barber.uasset", 2000);
  binary("Content/Maps/Tavern.umap", 2000);
  binary("Content/UI/MainMenu.uasset", 2000);
  binary("Content/Characters/Innkeeper.uasset", 1500);
  write("Content/UI/Icons/Coin.png", coin(false), { append: false });
  commit("Set up the project", "maya", 0);
  binary("Content/Characters/Barber.uasset", 2100);
  commit("Rig the barber", "rosa");
  write("Source/Feast/FeastGameMode.cpp", "// Spawn rules\n");
  commit("Spawn guests at the door", "theo");
  binary("Content/Maps/Tavern.umap", 2200);
  commit("Light the tavern", "rosa");
  binary("Content/Characters/Barber.uasset", 2300);
  commit("Give the barber a coat", "maya");
  run(["push", "-q", "origin", "main"]);

  run(["switch", "-q", "-c", "art/barber-v2"]);
  binary("Content/Characters/Barber.uasset", 2400);
  write("Config/DefaultGame.ini", "ProjectVersion=0.3\n");
  binary("Content/Characters/Innkeeper.uasset", 1600);
  commit("Barber v2: new hair and apron", "rosa");
  binary("Content/Characters/Barber.uasset", 2500);
  commit("Barber v2: fix the scissors socket", "rosa");
  run(["push", "-q", "origin", "art/barber-v2"]);
  run(["switch", "-q", "main"]);
  binary("Content/Characters/Barber.uasset", 2450);
  run(["rm", "-q", "Content/Characters/Innkeeper.uasset"]);
  commit("Barber: shorter beard, drop the old innkeeper", "maya");
  write("Source/Feast/FeastGameMode.cpp", "// Seating\n");
  commit("Seat guests by the fire", "theo");
  write("Content/UI/Icons/Coin.png", coin(true), { append: false });
  commit("Shinier coins for the tip jar", "rosa");
  run(["push", "-q", "origin", "main"]);

  run(["switch", "-q", "-c", "fix/door"]);
  write("Source/Feast/FeastGameMode.cpp", "// Door creaks\n");
  commit("Make the door creak", "theo");
  run(["push", "-q", "-u", "origin", "fix/door"]);
  run(["switch", "-q", "main"]);
  binary("Content/Props/Chair.uasset", 1800);
  commit("Add a tavern chair", "rosa");
  run(["push", "-q", "origin", "main"]);
  run(["branch", "-q", "-u", "origin/main"]);
  // A commit that a reset threw away, to find again with Recover.
  write("Source/Feast/FeastGameMode.cpp", "// Experimental lighting\n");
  commit("Try volumetric fog in the tavern", "maya");
  run(["reset", "-q", "--hard", "HEAD~1"]);
  // A GitHub address, for pull request badges. It's never fetched from.
  run(["remote", "add", "github", "https://github.com/example/feast.git"]);
  run(["config", "remote.github.skipFetchAll", "true"]);

  // Uncommitted work: big files that aren't in LFS, changed lockable assets, a log file.
  binary("Content/Cinematics/Intro.mp4", 12_500_000);
  binary("Content/Audio/Theme.wav", 15_200_000);
  run(["add", "Content/Audio/Theme.wav"]);
  binary("Content/Props/Chair.uasset", 1900);
  binary("Content/Characters/Barber.uasset", 2700);
  write("Saved/Logs/editor.log", "LogInit: Display: Engine started\n", { append: false });
  return folder;
}

/** Whether Git LFS is installed. */
function hasGitLfs() {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * A remote whose artwork and audio are stored with Git LFS, to try cloning without
 * them (and downloading them afterwards). Needs Git LFS: without it, there's none.
 */
export function buildAssets(root, configFile) {
  if (!hasGitLfs()) return null;
  const origin = remote(root, "assets", configFile);
  const folder = join(root, "remotes", "assets-work");
  setUp(folder, configFile);
  const repo = repository(folder, { configFile, start: now() - days(3) });
  const { run, binary } = repo;
  run(["lfs", "install", "--local"]);
  run(["lfs", "track", "*.psd", "*.wav"]);
  binary("Concept/hero.psd", 320_000);
  binary("Concept/village.psd", 280_000);
  repo.write("README.md", "Artwork and audio for Feast of the Forgotten.\n", { append: false });
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "Add the first concept art"], { who: "rosa" });
  binary("Audio/theme.wav", 450_000);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "Add the main theme"], { who: "theo", hours: 5 });
  run(["remote", "add", "origin", origin]);
  run(["push", "-q", "origin", "main"]);
  return origin;
}

/** The pull requests the studio's branches would have on GitHub, for the preview's fakes. */
export const STUDIO_PULL_REQUESTS = [
  { number: 12, title: "Barber v2: new hair and apron", url: "https://github.com/example/feast/pull/12", remote: "origin", branch: "art/barber-v2", draft: false, author: "rosa-bell", checks: "success" },
  { number: 14, title: "Make the door creak", url: "https://github.com/example/feast/pull/14", remote: "origin", branch: "fix/door", draft: false, author: "theo-park", checks: "failure" },
];

/** Build every demo repository in `root`. Resolves to their folders. */
export function buildDemos(root = join(tmpdir(), "tributary-demo"), options = {}) {
  mkdirSync(root, { recursive: true });
  const configFile = join(root, "empty.gitconfig");
  writeFileSync(configFile, "");
  return {
    root,
    notebook: buildNotebook(root, configFile),
    studio: buildStudio(root, configFile, options),
    assets: buildAssets(root, configFile),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const serve = process.argv.includes("--serve");
  const folder = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (serve) {
    // Build the demos, and run the lock server and the preview for them.
    const { startLockServer } = await import("./lfs-locks.mjs");
    const { startPreview } = await import("./server.mjs");
    const locks = await startLockServer();
    const demos = buildDemos(folder ? resolve(folder) : undefined, { lockServer: locks.url });
    console.log(`Demo repositories (paste one into "Open repository"):\n  ${demos.notebook}\n  ${demos.studio}`);
    if (demos.assets) console.log(`A remote with Git LFS files, to clone:\n  ${demos.assets}`);
    await startPreview({ env: DEMO_ENV });
  } else {
    const demos = buildDemos(folder ? resolve(folder) : undefined);
    console.log(`Demo repositories:\n  ${demos.notebook}\n  ${demos.studio}`);
    if (demos.assets) console.log(`A remote with Git LFS files, to clone:\n  ${demos.assets}`);
    console.log("The studio's locks come from `node tools/preview/lfs-locks.mjs`.");
  }
}
