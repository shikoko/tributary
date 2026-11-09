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
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A flat Photoshop file (no layers), `paint(x, y)` giving each pixel's [r, g, b]. */
function psd(size, paint) {
  const header = Buffer.alloc(26);
  header.write("8BPS", 0);
  header.writeUInt16BE(1, 4); // version
  header.writeUInt16BE(3, 12); // channels
  header.writeUInt32BE(size, 14);
  header.writeUInt32BE(size, 18);
  header.writeUInt16BE(8, 22); // bits per channel
  header.writeUInt16BE(3, 24); // RGB
  const planes = [0, 1, 2].map(() => Buffer.alloc(size * size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) paint(x, y).forEach((value, channel) => (planes[channel][y * size + x] = value));
  }
  // No colour mode data, image resources or layers; the picture uncompressed.
  return Buffer.concat([header, Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(2), ...planes]);
}

/** An uncompressed 32-bit Targa, top row first. */
function tga(size, paint) {
  const header = Buffer.alloc(18);
  header[2] = 2; // true colour
  header.writeUInt16LE(size, 12);
  header.writeUInt16LE(size, 14);
  header[16] = 32;
  header[17] = 0x28; // 8 bits of alpha, top-left origin
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y);
      pixels.set([b, g, r, 255], (y * size + x) * 4);
    }
  }
  return Buffer.concat([header, pixels]);
}

/** The tavern's sign: wooden planks in a dark frame, and (later) a mug of ale painted on. */
function sign(mug) {
  return (x, y) => {
    const frame = x < 10 || y < 10 || x > 245 || y > 245;
    if (frame) return [46, 30, 20];
    const seam = y % 59 < 3;
    const grain = Math.sin(x / 9 + Math.sin(y / 23) * 3) * 14 + Math.sin(y * 1.7) * 6;
    let [r, g, b] = seam ? [70, 44, 28] : [150 + grain, 98 + grain * 0.7, 56 + grain * 0.4];
    // A red disc, the tavern's mark.
    if (Math.hypot(x - 84, y - 128) < 34) [r, g, b] = [178, 42, 36];
    if (mug) {
      const body = x >= 150 && x <= 196 && y >= 104 && y <= 172;
      const foam = x >= 146 && x <= 200 && y >= 90 && y < 104 && Math.sin(x / 4) * 4 + 98 < y + 6;
      const handle = Math.abs(Math.hypot(x - 198, y - 136) - 16) < 5 && x > 198;
      if (foam) [r, g, b] = [246, 240, 222];
      else if (body) [r, g, b] = x < 158 || x > 188 ? [196, 128, 24] : [232, 166, 38];
      else if (handle) [r, g, b] = [196, 128, 24];
    }
    return [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))));
  };
}

/**
 * An actor saved in its own file by Unreal Engine (World Partition), as far as Tributary
 * reads one: a name table that lists "ActorLabel", then the asset registry's object, class
 * and tags. The rest of a real package is left out (filler stands in for it).
 */
function actorPackage(label, classPath, seed) {
  const string = (text) => {
    const bytes = Buffer.from(`${text}\0`, "latin1");
    const length = Buffer.alloc(4);
    length.writeInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const count = Buffer.alloc(4);
  count.writeInt32LE(3);
  const filler = Buffer.alloc(600 + (seed % 7) * 40, seed % 251);
  return Buffer.concat([
    Buffer.from([0xc1, 0x83, 0x2a, 0x9e]),
    string("ActorLabel"),
    Buffer.from([0x9f, 0x8b, 0xf8, 0x12]),
    filler,
    string(`${classPath.split(".").pop()}_UAID_${seed}`),
    string(classPath),
    count,
    string("ActorLabel"),
    string(label),
    string("ActorMetaData"),
    string("BAAAAIHVfWmrQU/m7FFKqii2t753AAAAtwZMW"),
    string("ActorMetaDataClass"),
    string(classPath),
    Buffer.alloc(64, seed % 13),
  ]);
}

/** Where Unreal saves an actor of `level`: two folders and a name, all from a hash. */
function actorPath(level, seed) {
  const letters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let state = seed * 2654435761;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return letters[state % letters.length];
  };
  const hash = Array.from({ length: 25 }, next).join("");
  return `Content/__ExternalActors__/${level}/${hash[0]}/${hash.slice(1, 3)}/${hash.slice(3)}.uasset`;
}

/** A door's creak as a mono 16-bit WAV: a wobbling tone that falls, `seconds` long. */
function creak(seconds, wobble) {
  const rate = 22050;
  const samples = Math.round(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const pitch = 420 - 260 * (t / seconds) + 40 * Math.sin(2 * Math.PI * wobble * t);
    phase += (2 * Math.PI * pitch) / rate;
    const envelope = Math.min(1, t * 20) * Math.min(1, (seconds - t) * 6) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t));
    data.writeInt16LE(Math.round(Math.sin(phase) * envelope * 0.5 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A binary glTF (GLB) model made of boxes: [x, y, z, width, height, depth] for each. */
function boxes(list) {
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [x, y, z, w, h, d] of list) {
    for (const [normal, corners] of faces) {
      const start = positions.length / 3;
      for (const [cx, cy, cz] of corners) {
        positions.push(x + (cx * w) / 2, y + (cy * h) / 2, z + (cz * d) / 2);
        normals.push(...normal);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const floats = (values) => Buffer.from(new Float32Array(values).buffer);
  const positionBytes = floats(positions);
  const normalBytes = floats(normals);
  const indexBytes = Buffer.from(new Uint16Array(indices).buffer);
  const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
  const bin = pad(Buffer.concat([positionBytes, normalBytes, indexBytes]), 0);
  const min = [0, 1, 2].map((axis) => Math.min(...positions.filter((_, i) => i % 3 === axis)));
  const max = [0, 1, 2].map((axis) => Math.max(...positions.filter((_, i) => i % 3 === axis)));
  const json = {
    asset: { version: "2.0", generator: "Tributary demo" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.62, 0.42, 0.26, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length + normalBytes.length, byteLength: indexBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.write(type, 4);
    return Buffer.concat([header, data]);
  };
  const body = Buffer.concat([chunk("JSON", jsonChunk), chunk("BIN\0", bin)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

/** A stool: a seat on four legs, and with `back`, a back to lean on. */
function stool(back) {
  const legs = [-0.35, 0.35].flatMap((x) => [-0.35, 0.35].map((z) => [x, 0.4, z, 0.08, 0.8, 0.08]));
  const parts = [[0, 0.84, 0, 0.9, 0.08, 0.9], ...legs];
  if (back) parts.push([0, 1.35, -0.41, 0.9, 0.9, 0.08], [-0.35, 1.05, -0.41, 0.08, 0.5, 0.08], [0.35, 1.05, -0.41, 0.08, 0.5, 0.08]);
  return boxes(parts);
}

/** A short video of the tavern door, from the files kept next to this script. */
const doorVideo = (version) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", `door-open-v${version}.webm`));

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
  run(["branch", "-q", "--set-upstream-to=origin/feature/export", "feature/export"]);
  const teammate = join(root, "remotes", "notebook-teammate");
  rmSync(teammate, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", origin, teammate], { env: { ...process.env, GIT_CONFIG_GLOBAL: configFile } });
  const priya = repository(teammate, { configFile, start: now() - 3600 });
  priya.run(["commit", "-q", "--allow-empty", "-m", "Tidy up the settings screen"], { who: "priya" });
  priya.run(["push", "-q", "origin", "main", "HEAD:refs/heads/feature/onboarding"]);
  // Priya brings the latest main into feature/export with a merge on the remote: after a
  // fetch, the local feature/export is a commit behind its upstream.
  priya.run(["checkout", "-q", "feature/export"]);
  priya.run(["merge", "-q", "--no-ff", "-m", "Merge the latest main into feature/export", "main"], { who: "priya" });
  priya.run(["push", "-q", "origin", "feature/export"]);

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
  // Textures the window can't show by itself: a Photoshop source and the Targa exported from it.
  write("Content/Textures/TavernSign.psd", psd(256, sign(false)), { append: false });
  write("Content/Textures/T_TavernSign.tga", tga(256, sign(false)), { append: false });
  commit("Paint the tavern sign", "rosa");
  write("Content/Textures/TavernSign.psd", psd(256, sign(true)), { append: false });
  write("Content/Textures/T_TavernSign.tga", tga(256, sign(true)), { append: false });
  commit("Sign: paint a mug of ale next to the mark", "rosa");
  // The tavern level, saved one actor per file (World Partition).
  const actors = [
    ["BP_Fireplace", "/Game/Blueprints/BP_Fireplace.BP_Fireplace_C"],
    ["SM_Table_Round3", "/Script/Engine.StaticMeshActor"],
    ["SM_Bench_Old", "/Script/Engine.StaticMeshActor"],
    ["PointLight_Hearth", "/Script/Engine.PointLight"],
    ["BP_BarberChair", "/Game/Blueprints/BP_BarberChair.BP_BarberChair_C"],
  ];
  actors.forEach(([label, classPath], index) => write(actorPath("Maps/Tavern", index + 1), actorPackage(label, classPath, index + 1), { append: false }));
  commit("Furnish the tavern", "theo");
  write(actorPath("Maps/Tavern", 1), actorPackage("BP_Fireplace", "/Game/Blueprints/BP_Fireplace.BP_Fireplace_C", 11), { append: false });
  write(actorPath("Maps/Tavern", 4), actorPackage("PointLight_Hearth", "/Script/Engine.PointLight", 14), { append: false });
  run(["rm", "-q", actorPath("Maps/Tavern", 3)]);
  write(actorPath("Maps/Tavern", 6), actorPackage("SM_Bench_Long", "/Script/Engine.StaticMeshActor", 6), { append: false });
  commit("Move the fireplace to the back wall, and swap the old bench for a long one", "theo");
  // A sound, a video and a 3D model, each changed once.
  write("Content/Audio/DoorCreak.wav", creak(0.9, 6), { append: false });
  write("Content/Cinematics/DoorOpen.webm", doorVideo(1), { append: false });
  write("Content/Props/Stool.glb", stool(false), { append: false });
  commit("Record the tavern door, and model a stool", "theo");
  write("Content/Audio/DoorCreak.wav", creak(1.6, 11), { append: false });
  write("Content/Cinematics/DoorOpen.webm", doorVideo(2), { append: false });
  write("Content/Props/Stool.glb", stool(true), { append: false });
  commit("A slower door with a longer creak, and a stool with a back", "rosa");
  // A huge commit, like an engine's import: thousands of small generated files.
  for (let level = 1; level <= 4; level++) {
    for (let i = 0; i < 600; i++) {
      const name = `Content/Generated/Level0${level}/Instance_${String(i).padStart(4, "0")}.json`;
      write(name, `{ "level": ${level}, "instance": ${i}, "seed": ${(level * 7919 + i * 104729) % 65536} }\n`, { append: false });
    }
  }
  commit("Import the generated level instances", "theo");
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
  { number: 12, title: "Barber v2: new hair and apron", url: "https://github.com/example/feast/pull/12", remote: "origin", branch: "art/barber-v2", draft: false, author: "rosa-bell", checks: "success", forge: "github" },
  { number: 14, title: "Make the door creak", url: "https://github.com/example/feast/pull/14", remote: "origin", branch: "fix/door", draft: false, author: "theo-park", checks: "failure", forge: "github" },
];

/** The studio's pull requests in full, as the preview shows them (window.__PREVIEW__.pullRequestDetails). */
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
export const STUDIO_PULL_REQUEST_DETAILS = {
  12: {
    number: 12,
    title: "Barber v2: new hair and apron",
    url: "https://github.com/example/feast/pull/12",
    body: "The barber's second pass, from the art review:\n\n- New hair cards and a leather apron\n- Scissors moved to their own socket, so the cutting animation can swap them\n\nTextures stay at 2K. Tested in the tavern level on a low-end laptop.",
    author: "rosa-bell",
    state: "open",
    base: "main",
    branch: "art/barber-v2",
    created: daysAgo(2),
    additions: 412,
    deletions: 37,
    files: 9,
    comments: 5,
    mergeable: "ready",
    reviews: [
      { author: "maya-chen", state: "approved" },
      { author: "lena-fischer", state: "commented" },
      { author: "sam-okafor", state: "requested" },
    ],
    checks: [
      { name: "Build (Windows)", state: "success", url: "https://github.com/example/feast/actions/runs/1", detail: null },
      { name: "Build (macOS)", state: "success", url: "https://github.com/example/feast/actions/runs/2", detail: null },
      { name: "Asset sizes", state: "success", url: "https://github.com/example/feast/actions/runs/3", detail: null },
      { name: "Deploy preview", state: null, url: null, detail: "Skipped" },
    ],
    forge: "github",
  },
  14: {
    number: 14,
    title: "Make the door creak",
    url: "https://github.com/example/feast/pull/14",
    body: "Plays door_creak.wav when the tavern door swings open.",
    author: "theo-park",
    state: "open",
    base: "main",
    branch: "fix/door",
    created: daysAgo(1),
    additions: 18,
    deletions: 2,
    files: 3,
    comments: 2,
    mergeable: "blocked",
    reviews: [
      { author: "diego-ramos", state: "changesRequested" },
      { author: "maya-chen", state: "requested" },
    ],
    checks: [
      { name: "Audio loudness", state: "failure", url: "https://github.com/example/feast/actions/runs/7", detail: "door_creak.wav peaks at -0.4 dB" },
      { name: "Build (Windows)", state: "pending", url: "https://github.com/example/feast/actions/runs/8", detail: null },
      { name: "Build (macOS)", state: "success", url: "https://github.com/example/feast/actions/runs/9", detail: null },
    ],
    forge: "github",
  },
};

/**
 * A stand-in for your global git config while the preview works on the demos: Maya Chen
 * as the usual identity, and Git LFS set up, so screenshots show neither your name nor
 * this computer's settings.
 */
function writeDemoGlobalConfig(root) {
  const file = join(root, "demo-global.gitconfig");
  writeFileSync(
    file,
    [
      "[user]",
      `\tname = ${PEOPLE.maya[0]}`,
      `\temail = ${PEOPLE.maya[1]}`,
      '[filter "lfs"]',
      "\tclean = git-lfs clean -- %f",
      "\tsmudge = git-lfs smudge -- %f",
      "\tprocess = git-lfs filter-process",
      "\trequired = true",
      "",
    ].join("\n"),
  );
  return file;
}

/** What to run the preview's git with on these demos (see DEMO_ENV and writeDemoGlobalConfig). */
export function demoEnv(demos) {
  return { ...DEMO_ENV, GIT_CONFIG_GLOBAL: demos.globalConfig };
}

/** Build every demo repository in `root`. Resolves to their folders. */
export function buildDemos(root = join(tmpdir(), "tributary-demo"), options = {}) {
  mkdirSync(root, { recursive: true });
  const configFile = join(root, "empty.gitconfig");
  writeFileSync(configFile, "");
  return {
    root,
    globalConfig: writeDemoGlobalConfig(root),
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
    await startPreview({ env: demoEnv(demos) });
  } else {
    const demos = buildDemos(folder ? resolve(folder) : undefined);
    console.log(`Demo repositories:\n  ${demos.notebook}\n  ${demos.studio}`);
    if (demos.assets) console.log(`A remote with Git LFS files, to clone:\n  ${demos.assets}`);
    console.log("The studio's locks come from `node tools/preview/lfs-locks.mjs`.");
  }
}
