// The smoke test's folders in the system's temporary folder: each file's demo repositories,
// and what a step needs for a while (a GPG key). Each is removed when the process that made
// it ends, however it ends: after its steps, when closing fails, or when it's stopped (Ctrl+C,
// or the runner being stopped). A process killed outright can't remove its own, so each run
// first removes those an earlier run left behind.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "tributary-smoke-";
/** In each demo folder: the process using it, so a later run can tell a leftover from one in use. */
const OWNER = ".smoke-owner";

const made = new Set();

/** Removes `folder` and everything in it, trying again while a process is still writing there. */
function remove(folder) {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left for the next run to remove.
  }
}

process.on("exit", () => {
  for (const folder of made) remove(folder);
});
// Stopped: end the way a normal exit does, which removes the folders (above).
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(128 + constants.signals[signal]));

/**
 * A new folder, `tributary-smoke-` and six letters (or `prefix` and six, where the name has to
 * be short), removed when this process ends.
 */
export function tempFolder(prefix = PREFIX) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  made.add(folder);
  if (prefix === PREFIX) writeFileSync(join(folder, OWNER), String(process.pid));
  return folder;
}

/** Removes `folder`, one tempFolder made, now. */
export function removeFolder(folder) {
  made.delete(folder);
  remove(folder);
}

/** Whether process `pid` is still running. */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Running, as someone else.
    return error.code === "EPERM";
  }
}

/**
 * Removes the demo folders of smoke test processes that have ended without removing them.
 * Those of processes still running (another run at the same time) are kept, as are folders
 * without an owner: one being made this moment has none yet. Resolves to how many it removed.
 */
export function removeLeftovers() {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(PREFIX)) continue;
    const folder = join(tmpdir(), name);
    let pid;
    try {
      pid = Number(readFileSync(join(folder, OWNER), "utf8"));
    } catch {
      continue;
    }
    if (!Number.isInteger(pid) || pid <= 0 || running(pid)) continue;
    remove(folder);
    removed++;
  }
  return removed;
}
