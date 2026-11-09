// Kinds of file, for what makes a repository big.

/** "*.psd" for "Art/Hero.psd" (the pattern Git LFS tracks them by), or the name itself. */
export function kindOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `*.${name.slice(dot + 1).toLowerCase()}` : name;
}
