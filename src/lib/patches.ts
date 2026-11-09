import { save } from "@tauri-apps/plugin-dialog";
import { patchText, type Action } from "../api";
import { copyText } from "./clipboard";

/** A file name for commits saved as a patch, from the newest one's summary. */
export function patchFileName(summary: string, count: number): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return `${slug || "changes"}${count > 1 ? `-and-${count - 1}-more` : ""}.patch`;
}

/** Ask where to save the commits `ids` as a patch, then save them there. */
export async function savePatch(ids: string[], summary: string, run: (action: Action) => void): Promise<void> {
  const file = await save({
    title: ids.length > 1 ? `Save ${ids.length} commits as a patch` : "Save the commit as a patch",
    defaultPath: patchFileName(summary, ids.length),
    filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
  });
  if (file) run({ kind: "savePatch", ids, file });
}

/** Copy the commits `ids` as a patch, to paste in a message. */
export async function copyPatch(repoPath: string, ids: string[], notify: (text: string) => void): Promise<void> {
  try {
    await copyText(await patchText(repoPath, ids));
    notify(ids.length > 1 ? `Copied ${ids.length} commits as a patch` : "Copied the commit as a patch");
  } catch (error) {
    notify(String(error));
  }
}

/** Files dropped on the window, or chosen, that look like patches. */
export function isPatchFile(path: string): boolean {
  return /\.(patch|diff|mbox|eml)$/i.test(path);
}
