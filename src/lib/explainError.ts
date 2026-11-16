/**
 * git's errors in plain words: what happened, and what can be done about it. git's own
 * message stays available beside it, for whoever wants the details.
 */

/** What can be done about an error, when the app can do it. */
export type ErrorFix =
  /** Get the remote branch's commits, then push this one's on top. */
  | "sync"
  /** Replace the remote branch with this one (asks first). */
  | "forcePush"
  /** Replace it even with commits someone else pushed since the last fetch (asks first). */
  | "forcePushAnyway"
  /** Go to the commits someone else pushed. */
  | "showUnseen"
  /** Run the same thing again (the network was down, say). */
  | "retry"
  /** Push the branch, which links it to a remote branch. */
  | "push"
  /** Put the changes in the way aside, do it, and bring them back. */
  | "stash"
  /** Make a branch for the commits (the branch they're on is protected). */
  | "newBranch"
  /** Move the files too big for the host into Git LFS. */
  | "moveToLfs";

export interface Explained {
  /** What happened, in one line: "Push stopped: origin/main has commits you don't have yet". */
  headline: string;
  /** Why, in a sentence or two. */
  detail?: string;
  /** What can be done, the likeliest first. */
  fixes: ErrorFix[];
}

/** What was going on when it failed, for the words. */
export interface ErrorContext {
  /** The checked-out branch. */
  branch?: string | null;
  /** Its remote branch: "origin/main". */
  upstream?: string | null;
  /** The commits a force push stopped for, once they're known: how many, and whose ("Theo Park"). */
  unseen?: { count: number; by: string | null } | null;
}

/** The host in git's message ("github.com"): where it pushed to ("To …"), or the first address in it. */
function host(message: string): string | null {
  const pushedTo = /^To (?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)/m.exec(message)?.[1];
  if (pushedTo) return pushedTo;
  const match = /(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s'"]+)|[\w.-]+@([\w.-]+\.[a-z]{2,}):/i.exec(message);
  return match ? (match[1] ?? match[2]) : null;
}

/** The files git lists after a line like "...would be overwritten by checkout:", indented by a tab. */
function listedFiles(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => /^\t\S/.test(line))
    .map((line) => line.trim());
}

const files = (count: number, what = "file") => `${count === 1 ? "1" : count.toLocaleString()} ${what}${count === 1 ? "" : "s"}`;

/**
 * git's message (or the backend's, built on it) in plain words, or null when it isn't one
 * of the errors known here: then git's message is shown as it is.
 */
export function explainError(message: string, context: ErrorContext = {}): Explained | null {
  const rejected = /! \[rejected\]\s+(\S+)\s+->\s+(\S+)\s+\(([^)]+)\)/.exec(message);
  const branch = rejected?.[2] ?? context.branch ?? "the branch";
  const remoteBranch = context.upstream ?? (rejected ? `the remote's ${branch}` : `the remote branch`);
  const where = host(message);

  if (rejected && (rejected[3] === "fetch first" || rejected[3] === "non-fast-forward")) {
    return {
      headline: `Push stopped: ${remoteBranch} has commits you don't have yet`,
      detail: `Someone pushed to ${branch} after you last fetched.`,
      fixes: ["sync", "forcePush"],
    };
  }
  if (rejected && rejected[3] === "stale info") {
    return {
      headline: context.unseen
        ? `Force push stopped: ${remoteBranch} has ${context.unseen.count === 1 ? "a commit" : `${context.unseen.count.toLocaleString()} commits`} you haven't fetched${context.unseen.by ? `, by ${context.unseen.by}` : ""}`
        : `Force push stopped: ${remoteBranch} has commits you haven't fetched`,
      detail: "A force push stops for commits you haven't seen, so they aren't removed by mistake.",
      fixes: ["forcePushAnyway", "showUnseen"],
    };
  }
  if (/Not possible to fast-forward/i.test(message)) {
    return {
      headline: `Pull stopped: ${branch} and ${remoteBranch} both have new commits`,
      detail: "git is set to only fast-forward (pull.ff = only), so it won't combine them.",
      fixes: ["sync"],
    };
  }
  const large = /GH001|exceeds GitHub's file size limit|Large files detected/i.test(message);
  if (large) {
    const named = /File (\S+) is [\d.]+ ?MB; this exceeds/i.exec(message)?.[1];
    return {
      headline: `${named ?? "A file"} is too big for ${where ?? "GitHub"}`,
      detail: "GitHub takes files up to 100 MB. Bigger ones go in Git LFS.",
      fixes: ["moveToLfs"],
    };
  }
  if (/GH006|protected branch hook declined|not allowed to push code to protected branches/i.test(message)) {
    return {
      headline: `${branch} is protected${where ? ` on ${where}` : ""}`,
      detail: `Changes go into ${branch} through a pull request.`,
      fixes: ["newBranch"],
    };
  }
  if (/Git needs your credentials|Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey/i.test(message)) {
    return {
      headline: `git couldn't sign in to ${where ?? "the remote"}`,
      detail: "Sign in once with git in a terminal, or set up a credential helper, then try again.",
      fixes: ["retry"],
    };
  }
  if (/Repository not found|does not appear to be a git repository|repository '.*' not found/i.test(message)) {
    return {
      headline: `git can't find the repository${where ? ` on ${where}` : ""}`,
      detail: "Its address may be wrong (see Repository → Remotes), or you may not have access to it with the account git signs in with.",
      fixes: [],
    };
  }
  if (/Could not resolve host|Failed to connect to|Connection timed out|Couldn't connect to server|Network is unreachable|Operation timed out|Connection refused/i.test(message)) {
    return {
      headline: `Couldn't reach ${where ?? "the remote"}`,
      detail: "Check your internet connection (and VPN, if you use one), then try again.",
      fixes: ["retry"],
    };
  }
  if (/The remote end hung up unexpectedly|early EOF|RPC failed|unexpected disconnect/i.test(message)) {
    return {
      headline: `The connection to ${where ?? "the remote"} dropped partway`,
      detail: "Big pushes and pulls sometimes do on slow or unsteady connections. Try again.",
      fixes: ["retry"],
    };
  }
  if (/untracked working tree files would be (?:overwritten|removed)/i.test(message)) {
    const count = listedFiles(message).length;
    return {
      headline: count > 0 ? `${files(count, "new file")} of yours ${count === 1 ? "is" : "are"} in the way` : "New files of yours are in the way",
      detail: "Files with the same names would replace them.",
      fixes: ["stash"],
    };
  }
  if (/Your local changes to the following files would be overwritten|commit your changes or stash them/i.test(message)) {
    const count = listedFiles(message).length;
    return {
      headline: count > 0 ? `Your changes to ${files(count)} are in the way` : "Your changes are in the way",
      detail: "Doing this would overwrite them.",
      fixes: ["stash"],
    };
  }
  if (/There is no tracking information for the current branch|has no upstream branch/i.test(message)) {
    return {
      headline: `${branch} isn't linked to a remote branch`,
      detail: "git doesn't know which remote branch to pull from.",
      fixes: ["push"],
    };
  }
  if (/index\.lock': File exists/i.test(message)) {
    return {
      headline: "Another git program is busy in this repository",
      detail: "Wait for it to finish. If none is running, one stopped halfway and left .git/index.lock behind: delete that file, then try again.",
      fixes: ["retry"],
    };
  }
  if (/refusing to merge unrelated histories/i.test(message)) {
    return {
      headline: "These two histories have no commit in common",
      detail: "They don't come from the same repository, so git won't combine them.",
      fixes: [],
    };
  }
  if (/No space left on device/i.test(message)) {
    return {
      headline: "The disk is full",
      detail: "Make some room, then try again.",
      fixes: ["retry"],
    };
  }
  if (/git: 'lfs' is not a git command|git-lfs: command not found|git-lfs was not found/i.test(message)) {
    return {
      headline: "Git LFS isn't installed",
      detail: "This repository keeps big files in Git LFS. Install it from git-lfs.com, then try again.",
      fixes: [],
    };
  }
  return null;
}

/**
 * The line of git's message that says what went wrong, for a headline when it isn't one of
 * the errors explained here: the first "fatal:" or "error:" line without that word, or else
 * the first line. "fatal: bad revision 'x'" → "Bad revision 'x'".
 */
export function gitHeadline(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const said = lines.find((line) => /^(?:fatal|error):\s/i.test(line)) ?? lines[0] ?? "Something went wrong";
  const plain = said.replace(/^(?:fatal|error):\s+/i, "");
  // git's own words start lower case after "fatal:"; the app's are left as they are.
  return plain === said ? said : plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * Whose commits these are, by their authors: "Theo Park", "Theo Park and Rosa Bell", "Theo
 * Park and 2 others". With `more`, some commits weren't listed, so their authors aren't
 * known: "Theo Park and others".
 */
export function byWhom(authors: string[], more = false): string | null {
  const names = [...new Set(authors)];
  if (names.length === 0) return null;
  if (more) return `${names.slice(0, 2).join(", ")} and others`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}
