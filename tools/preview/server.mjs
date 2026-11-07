// Runs Tributary in an ordinary browser: serves the built frontend (`dist/`) with a
// stand-in for Tauri (`shim.js`), and answers its commands with the app's own Rust code,
// running headless (`src-tauri/examples/headless.rs`). Real repositories, no window.
//
//   npm run preview:build     build the frontend and the headless app
//   npm run preview           then open http://127.0.0.1:4173
//
// Options: --port <n>, --host <address>, --headless <path to the headless binary>.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** The headless app: the newest build of it, release or debug. */
export function findHeadless() {
  const name = process.platform === "win32" ? "headless.exe" : "headless";
  const builds = ["release", "debug"]
    .map((profile) => join(root, "src-tauri", "target", profile, "examples", name))
    .filter((path) => existsSync(path));
  builds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return builds[0];
}

/** The app's version, as the Settings window shows it. */
function appVersion() {
  try {
    return JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version ?? "preview";
  } catch {
    return "preview";
  }
}

/**
 * Start the preview. Resolves to { url, close } once it's listening.
 * `env` is added to the headless app's environment (to set a git identity, say).
 */
export async function startPreview({ port = 4173, host = "127.0.0.1", headless = findHeadless(), dist = join(root, "dist"), env = {}, quiet = false } = {}) {
  if (!headless || !existsSync(headless)) throw new Error("The headless app isn't built: run `npm run preview:build` first.");
  if (!existsSync(join(dist, "index.html"))) throw new Error(`There's no frontend build in ${dist}: run \`npm run preview:build\` first.`);
  const log = quiet ? () => {} : (...args) => console.log(...args);

  // The headless app takes one request per line and answers with one line per reply or event.
  const app = spawn(headless, [], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  const waiting = new Map();
  const listeners = new Set();
  let nextId = 1;
  let exited = false;
  app.on("exit", (code) => {
    exited = true;
    for (const { reject } of waiting.values()) reject(`The headless app stopped (${code}).`);
    waiting.clear();
  });
  createInterface({ input: app.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return log(`headless: ${line}`);
    }
    if (message.event) {
      for (const listener of listeners) listener(message);
      return;
    }
    const request = waiting.get(message.id);
    if (!request) return;
    waiting.delete(message.id);
    if ("err" in message) request.reject(message.err);
    else request.resolve(message.ok);
  });
  const call = (command, args) =>
    new Promise((resolve, reject) => {
      if (exited) return reject("The headless app isn't running.");
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      app.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    });

  const shim = `window.__PREVIEW_VERSION__ = ${JSON.stringify(appVersion())};\n${readFileSync(join(here, "shim.js"), "utf8")}`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://preview");
    const reply = (status, type, body) => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(body);
    };

    // Only this preview's own page may talk to it: not other websites open in the same
    // browser (a POST from them needs a custom header, which a page can't send to another
    // origin without permission), nor a hostname that was pointed at this computer.
    const allowedHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(request.headers.host ?? "");
    if (!allowedHost) return reply(403, "text/plain", "This preview only answers on localhost.");
    if (url.pathname.startsWith("/__preview/") && url.pathname !== "/__preview/shim.js") {
      const sameOrigin = request.headers["sec-fetch-site"] === undefined || request.headers["sec-fetch-site"] === "same-origin";
      if (!sameOrigin || (request.method === "POST" && request.headers["x-tributary-preview"] !== "1"))
        return reply(403, "text/plain", "Forbidden");
    }

    if (url.pathname === "/__preview/invoke" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { command, args } = JSON.parse(body || "{}");
      try {
        reply(200, "application/json", JSON.stringify({ ok: (await call(command, args ?? {})) ?? null }));
      } catch (error) {
        reply(200, "application/json", JSON.stringify({ err: String(error) }));
      }
      return;
    }
    if (url.pathname === "/__preview/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      response.write(": connected\n\n");
      const listener = (message) => response.write(`data: ${JSON.stringify(message)}\n\n`);
      listeners.add(listener);
      request.on("close", () => listeners.delete(listener));
      return;
    }
    if (url.pathname === "/__preview/shim.js") return reply(200, TYPES[".js"], shim);

    // The frontend build, with the shim loaded before anything else.
    const file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist + sep) && file !== dist) return reply(403, "text/plain", "Forbidden");
    const path = existsSync(file) && statSync(file).isFile() ? file : join(dist, "index.html");
    if (path.endsWith("index.html")) {
      const html = readFileSync(path, "utf8").replace("<head>", '<head>\n    <script src="/__preview/shim.js"></script>');
      return reply(200, TYPES[".html"], html);
    }
    reply(200, TYPES[extname(path)] ?? "application/octet-stream", readFileSync(path));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const url = `http://${host}:${typeof address === "object" && address ? address.port : port}/`;
  log(`Tributary preview: ${url}`);
  return {
    url,
    call,
    close: () =>
      new Promise((resolve) => {
        app.stdin.end();
        app.kill();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPreview({ port: Number(option("port", 4173)), host: option("host", "127.0.0.1"), headless: option("headless", findHeadless()) }).catch(
    (error) => {
      console.error(String(error.message ?? error));
      process.exit(1);
    },
  );
}
