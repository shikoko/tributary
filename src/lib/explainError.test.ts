import { describe, expect, it } from "vitest";
import { byWhom, explainError, gitHeadline } from "./explainError";

// The failures as the backend says what kind they are (src-tauri/src/error/kind.rs reads
// them from git's messages, and has those messages in its tests).

describe("explainError", () => {
  it("says a push stopped for commits it doesn't have, and offers Sync or a force push", () => {
    const explained = explainError({ kind: "pushRejected", branch: "main" }, { branch: "main", upstream: "origin/main" });
    expect(explained?.headline).toBe("Push stopped: origin/main has commits you don't have yet");
    expect(explained?.detail).toBe("Someone pushed to main after you last fetched.");
    expect(explained?.fixes).toEqual(["sync", "forcePush"]);
    // Without its remote branch known, by the branch git named.
    expect(explainError({ kind: "pushRejected", branch: "art/barber" })?.headline).toBe("Push stopped: the remote's art/barber has commits you don't have yet");
  });

  it("says how many commits a force push stopped for, and whose, once that's known, and offers to replace them too", () => {
    const stale = { kind: "staleLease", branch: "feat/environment-materials" } as const;
    const context = { branch: "feat/environment-materials", upstream: "origin/feat/environment-materials" };
    expect(explainError(stale, context)?.headline).toBe("Force push stopped: origin/feat/environment-materials has commits you haven't fetched");
    const explained = explainError(stale, { ...context, unseen: { count: 2, by: "Theo Park" } });
    expect(explained?.headline).toBe("Force push stopped: origin/feat/environment-materials has 2 commits you haven't fetched, by Theo Park");
    expect(explainError(stale, { ...context, unseen: { count: 1, by: "Theo Park" } })?.headline).toBe(
      "Force push stopped: origin/feat/environment-materials has a commit you haven't fetched, by Theo Park",
    );
    expect(explained?.fixes).toEqual(["forcePushAnyway", "showUnseen"]);
  });

  it("says why a pull won't combine the two sides when git only fast-forwards", () => {
    const explained = explainError({ kind: "notFastForward" }, { branch: "main", upstream: "origin/main" });
    expect(explained?.headline).toBe("Pull stopped: main and origin/main both have new commits");
    expect(explained?.detail).toContain("pull.ff = only");
    expect(explained?.fixes).toEqual(["sync"]);
  });

  it("says where a branch is protected, and offers a new branch for the commits", () => {
    const explained = explainError({ kind: "protected", host: "github.com" }, { branch: "main" });
    expect(explained?.headline).toBe("main is protected on github.com");
    expect(explained?.fixes).toEqual(["newBranch"]);
  });

  it("names the file too big for GitHub", () => {
    const explained = explainError({ kind: "tooLarge", file: "Content/Maps/Tavern.umap", host: "github.com" });
    expect(explained?.headline).toBe("Content/Maps/Tavern.umap is too big for github.com");
    expect(explained?.fixes).toEqual(["moveToLfs"]);
    expect(explainError({ kind: "tooLarge", file: null, host: null })?.headline).toBe("A file is too big for GitHub");
  });

  it("says which host couldn't be reached or signed in to, and offers to try again", () => {
    const explained = explainError({ kind: "unreachable", host: "github.com" });
    expect(explained?.headline).toBe("Couldn't reach github.com");
    expect(explained?.fixes).toEqual(["retry"]);
    expect(explainError({ kind: "signIn", host: "gitlab.com" })?.headline).toBe("git couldn't sign in to gitlab.com");
    expect(explainError({ kind: "connectionDropped", host: null })?.headline).toBe("The connection to the remote dropped partway");
  });

  it("counts the changes in the way, and offers to put them aside", () => {
    expect(explainError({ kind: "changesInTheWay", files: 2, untracked: false })?.headline).toBe("Your changes to 2 files are in the way");
    expect(explainError({ kind: "changesInTheWay", files: 1, untracked: true })?.headline).toBe("1 new file of yours is in the way");
    expect(explainError({ kind: "changesInTheWay", files: 0, untracked: false })?.headline).toBe("Your changes are in the way");
    expect(explainError({ kind: "changesInTheWay", files: 2, untracked: false })?.fixes).toEqual(["stash"]);
  });

  it("explains a branch with no remote branch, and a repository another git program is busy in", () => {
    expect(explainError({ kind: "noUpstream" }, { branch: "art/barber" })?.headline).toBe("art/barber isn't linked to a remote branch");
    expect(explainError({ kind: "indexLocked" })?.headline).toBe("Another git program is busy in this repository");
  });

  it("says a branch's remote branch is gone, and offers to go with another or push it back", () => {
    const explained = explainError({ kind: "upstreamGone", branch: "master" }, { branch: "master", upstream: "origin/master" });
    expect(explained?.headline).toBe("origin has no branch called master any more");
    expect(explained?.detail).toBe("Your master pulls from origin/master, which was renamed or deleted on origin.");
    expect(explained?.fixes).toEqual(["useUpstream", "chooseUpstream", "pushBack"]);
  });

  it("leaves failures it doesn't know, and those with a banner of their own, to their message", () => {
    expect(explainError(null)).toBeNull();
    expect(explainError({ kind: "hookFailed", hook: "pre-commit", stopped: "commit", output: "" })).toBeNull();
    expect(explainError({ kind: "cancelled" })).toBeNull();
  });
});

describe("gitHeadline", () => {
  it("takes the line that says what went wrong, without fatal: or error:", () => {
    expect(gitHeadline("To somewhere\nfatal: bad revision 'x'\nmore")).toBe("Bad revision 'x'");
    expect(gitHeadline("error: pathspec 'y' did not match any file(s) known to git")).toBe("Pathspec 'y' did not match any file(s) known to git");
  });

  it("keeps a message of the app's own as it is, a branch name first too", () => {
    expect(gitHeadline("pick-target already has the commit")).toBe("pick-target already has the commit");
    expect(gitHeadline("")).toBe("Something went wrong");
  });
});

describe("byWhom", () => {
  it("names one or two authors, and counts the rest", () => {
    expect(byWhom([])).toBeNull();
    expect(byWhom(["Theo Park", "Theo Park"])).toBe("Theo Park");
    expect(byWhom(["Theo Park", "Rosa Bell"])).toBe("Theo Park and Rosa Bell");
    expect(byWhom(["Theo Park", "Rosa Bell", "Lea Fischer"])).toBe("Theo Park and 2 others");
  });

  it("says there are others when not every commit was listed", () => {
    expect(byWhom(["Priya Nair"], true)).toBe("Priya Nair and others");
    expect(byWhom(["Priya Nair", "Sam Okafor", "Lena Kovacs"], true)).toBe("Priya Nair, Sam Okafor and others");
  });
});
