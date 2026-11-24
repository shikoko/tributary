// Folders Tributary is asked to open from outside it: Explorer's Open in Tributary, or a
// folder given on the command line (src-tauri/src/open_folder.rs).
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";

let started: Promise<string[]> | null = null;

/** The folders this start of Tributary was asked to open: asked once, as the window opens. */
export function startupFolders(): Promise<string[]> {
  started ??= invoke("startup_folders").catch(() => []);
  return started;
}

/** Calls `handler` with each folder Tributary is asked to open while it's running. */
export function onOpenFolder(handler: (path: string) => void): Promise<() => void> {
  return listen<string>("open-folder", (event) => handler(event.payload));
}
