// A Git LFS server that only does file locking, for the demo repositories. Every request
// comes from the same person (`me`); the other locks belong to teammates.
//
//   node tools/preview/lfs-locks.mjs [--port 4174]
//
// Point a repository at it with `git config lfs.url http://127.0.0.1:4174/lfs`.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO_LOCKS = [
  { id: "1", path: "Content/Maps/Tavern.umap", owner: { name: "rosa-bell" }, locked_at: "2026-11-05T14:20:00Z" },
  { id: "2", path: "Content/Characters/Barber.uasset", owner: { name: "maya-chen" }, locked_at: "2026-11-07T09:10:00Z" },
  { id: "3", path: "Content/UI/MainMenu.uasset", owner: { name: "theo-park" }, locked_at: "2026-11-06T17:45:00Z" },
];

/** Start the lock server. Resolves to { url, port, locks, close }. */
export async function startLockServer({ port = 4174, host = "127.0.0.1", me = "maya-chen", locks = DEMO_LOCKS } = {}) {
  const held = locks.map((lock) => ({ ...lock, owner: { ...lock.owner } }));
  let nextId = 10;
  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      const data = JSON.stringify(body);
      response.writeHead(status, { "Content-Type": "application/vnd.git-lfs+json", "Content-Length": Buffer.byteLength(data) });
      response.end(data);
    };
    const url = new URL(request.url ?? "/", "http://locks");
    let body = {};
    if (request.method === "POST") {
      let text = "";
      for await (const chunk of request) text += chunk;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return reply(400, { message: "Bad JSON" });
      }
    }
    if (request.method === "GET" && url.pathname.endsWith("/locks")) {
      const path = url.searchParams.get("path");
      const id = url.searchParams.get("id");
      return reply(200, { locks: held.filter((lock) => (!path || lock.path === path) && (!id || lock.id === id)), next_cursor: "" });
    }
    if (request.method !== "POST") return reply(404, { message: "Not found" });
    if (url.pathname.endsWith("/locks/verify")) {
      return reply(200, {
        ours: held.filter((lock) => lock.owner.name === me),
        theirs: held.filter((lock) => lock.owner.name !== me),
        next_cursor: "",
      });
    }
    const unlock = url.pathname.match(/\/locks\/([^/]+)\/unlock$/);
    if (unlock) {
      const index = held.findIndex((lock) => lock.id === unlock[1]);
      if (index < 0) return reply(404, { message: "unable to find lock" });
      if (held[index].owner.name !== me && !body.force) return reply(403, { message: "You must have admin access to force delete a lock" });
      const [lock] = held.splice(index, 1);
      return reply(200, { lock });
    }
    if (url.pathname.endsWith("/locks")) {
      const existing = held.find((lock) => lock.path === body.path);
      if (existing) return reply(409, { lock: existing, message: "already created lock" });
      const lock = { id: String(nextId++), path: body.path, owner: { name: me }, locked_at: new Date().toISOString() };
      held.push(lock);
      return reply(201, { lock });
    }
    reply(404, { message: "Not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    port: actualPort,
    url: `http://${host}:${actualPort}/lfs`,
    locks: held,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--port");
  const { url } = await startLockServer({ port: index > 0 ? Number(process.argv[index + 1]) : 4174 });
  console.log(`Git LFS locks: ${url}`);
}
