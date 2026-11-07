/** `file` relative to the folder `root`, with forward slashes, or null when it's outside it. */
export function relativeTo(root: string, file: string): string | null {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalize(root);
  const full = normalize(file);
  // Windows paths don't care about case (C:\Repo and c:\repo are the same folder).
  const windows = /^[a-zA-Z]:\//.test(base);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(full, base)) return null;
  if (!same(full.slice(0, base.length + 1), `${base}/`)) return null;
  return full.slice(base.length + 1);
}

/** "Hero.uasset" for "Content/Characters/Hero.uasset". */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** "Content/Characters" for "Content/Characters/Hero.uasset", "" at the top. */
export function folderOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? "" : trimmed.slice(0, slash);
}

/** The folder a file system path is in, with either separator: "C:\\work\\app" → "C:\\work". */
export function parentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? trimmed.slice(0, cut + 1) : trimmed.slice(0, cut);
}

/** `path` joined onto the folder `root`, with the separators `root` uses. */
export function joinPath(root: string, path: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${path.split("/").join(separator)}`;
}

/** "feature/tags" → "feature-tags", for a folder name. */
export function folderSlug(branch: string): string {
  return branch.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
}
