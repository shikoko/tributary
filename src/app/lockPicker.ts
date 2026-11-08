import { open } from "@tauri-apps/plugin-dialog";
import { relativeTo } from "../lib/paths";

/** Choose files to lock with Git LFS: their paths in the repository, and how many were outside it. */
export async function chooseFilesToLock(repoPath: string): Promise<{ paths: string[]; outside: number }> {
  const picked = await open({ multiple: true, directory: false, defaultPath: repoPath, title: "Lock files" });
  const files = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const paths = files.map((file) => relativeTo(repoPath, file));
  const inside = paths.filter((path): path is string => path !== null);
  return { paths: inside, outside: paths.length - inside.length };
}
