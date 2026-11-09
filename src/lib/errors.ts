/** git refused because uncommitted changes would be overwritten: stashing them first helps. */
export function isLocalChangesError(message: string): boolean {
  return /would be overwritten by|commit your changes or stash them|Your local changes|You have unstaged changes|Your index contains uncommitted changes/i.test(
    message,
  );
}

/** The changes in the way include untracked files. */
export function involvesUntrackedFiles(message: string): boolean {
  return /untracked working tree files/i.test(message);
}

/** `git branch -d` refused because the branch has commits that aren't merged anywhere. */
export function isNotMergedError(message: string): boolean {
  return /not fully merged/i.test(message);
}

/** A hook of the repository stopped a commit or push: which, and what it printed. */
export function hookFailure(message: string): { hook: string; what: "commit" | "push"; output: string } | null {
  const match = /^The ([\w-]+) hook stopped the (commit|push)\.\s*([\s\S]*)$/.exec(message);
  return match ? { hook: match[1], what: match[2] as "commit" | "push", output: match[3].trim() } : null;
}
