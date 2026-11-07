/** git refused because uncommitted changes would be overwritten: stashing them first helps. */
export function isLocalChangesError(message: string): boolean {
  return /would be overwritten by|commit your changes or stash them|Your local changes/i.test(message);
}

/** The changes in the way include untracked files. */
export function involvesUntrackedFiles(message: string): boolean {
  return /untracked working tree files/i.test(message);
}

/** `git branch -d` refused because the branch has commits that aren't merged anywhere. */
export function isNotMergedError(message: string): boolean {
  return /not fully merged/i.test(message);
}
