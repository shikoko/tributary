import { describe, expect, it } from "vitest";
import { byWhom, explainError, gitHeadline } from "./explainError";

// git's messages as git prints them.
const FETCH_FIRST = `To github.com:rosa-bell/notebook.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:rosa-bell/notebook.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.`;
const STALE = `To https://github.com/rosa-bell/notebook.git
 ! [rejected]        HEAD -> feat/environment-materials (stale info)
error: failed to push some refs to 'https://github.com/rosa-bell/notebook.git'`;
const NOT_FF = `hint: Diverging branches can't be fast-forwarded, you need to either:
hint:
hint: \tgit merge --no-ff
hint:
hint: or:
hint:
hint: \tgit rebase
fatal: Not possible to fast-forward, aborting.`;
const PROTECTED = `remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Changes must be made through a pull request.
To https://github.com/rosa-bell/notebook.git
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs to 'https://github.com/rosa-bell/notebook.git'`;
const LARGE = `remote: error: File Content/Maps/Tavern.umap is 142.31 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.
To github.com:rosa-bell/tavern.git
 ! [remote rejected] main -> main (pre-receive hook declined)`;
const OFFLINE = "fatal: unable to access 'https://github.com/rosa-bell/notebook.git/': Could not resolve host: github.com";
const LOCAL_CHANGES = `error: Your local changes to the following files would be overwritten by checkout:
\tContent/Maps/Tavern.umap
\tREADME.md
Please commit your changes or stash them before you switch branches.
Aborting`;
const UNTRACKED = `error: The following untracked working tree files would be overwritten by checkout:
\tnotes/idea.md
Please move or remove them before you switch branches.
Aborting`;
const NO_TRACKING = `There is no tracking information for the current branch.
Please specify which branch you want to merge with.`;
const LOCKED = "fatal: Unable to create '/home/maya/notebook/.git/index.lock': File exists.";

describe("explainError", () => {
  it("says a push stopped for commits it doesn't have, and offers Sync or a force push", () => {
    const explained = explainError(FETCH_FIRST, { branch: "main", upstream: "origin/main" });
    expect(explained?.headline).toBe("Push stopped: origin/main has commits you don't have yet");
    expect(explained?.detail).toBe("Someone pushed to main after you last fetched.");
    expect(explained?.fixes).toEqual(["sync", "forcePush"]);
  });

  it("says how many commits a force push stopped for, and whose, once that's known, and offers to replace them too", () => {
    const context = { branch: "feat/environment-materials", upstream: "origin/feat/environment-materials" };
    expect(explainError(STALE, context)?.headline).toBe("Force push stopped: origin/feat/environment-materials has commits you haven't fetched");
    const explained = explainError(STALE, { ...context, unseen: { count: 2, by: "Theo Park" } });
    expect(explained?.headline).toBe("Force push stopped: origin/feat/environment-materials has 2 commits you haven't fetched, by Theo Park");
    expect(explainError(STALE, { ...context, unseen: { count: 1, by: "Theo Park" } })?.headline).toBe(
      "Force push stopped: origin/feat/environment-materials has a commit you haven't fetched, by Theo Park",
    );
    expect(explained?.fixes).toEqual(["forcePushAnyway", "showUnseen"]);
  });

  it("says why a pull won't combine the two sides when git only fast-forwards", () => {
    const explained = explainError(NOT_FF, { branch: "main", upstream: "origin/main" });
    expect(explained?.headline).toBe("Pull stopped: main and origin/main both have new commits");
    expect(explained?.detail).toContain("pull.ff = only");
    expect(explained?.fixes).toEqual(["sync"]);
  });

  it("says where a branch is protected, and offers a new branch for the commits", () => {
    const explained = explainError(PROTECTED, { branch: "main" });
    expect(explained?.headline).toBe("main is protected on github.com");
    expect(explained?.fixes).toEqual(["newBranch"]);
  });

  it("names the file too big for GitHub", () => {
    const explained = explainError(LARGE);
    expect(explained?.headline).toBe("Content/Maps/Tavern.umap is too big for github.com");
    expect(explained?.fixes).toEqual(["moveToLfs"]);
  });

  it("says which host couldn't be reached, and offers to try again", () => {
    const explained = explainError(OFFLINE);
    expect(explained?.headline).toBe("Couldn't reach github.com");
    expect(explained?.fixes).toEqual(["retry"]);
  });

  it("counts the changes in the way, and offers to put them aside", () => {
    expect(explainError(LOCAL_CHANGES)?.headline).toBe("Your changes to 2 files are in the way");
    expect(explainError(UNTRACKED)?.headline).toBe("1 new file of yours is in the way");
    expect(explainError(LOCAL_CHANGES)?.fixes).toEqual(["stash"]);
  });

  it("explains a branch with no remote branch, and a repository another git program is busy in", () => {
    expect(explainError(NO_TRACKING, { branch: "art/barber" })?.headline).toBe("art/barber isn't linked to a remote branch");
    expect(explainError(LOCKED)?.headline).toBe("Another git program is busy in this repository");
  });

  it("explains the backend's message about credentials, by the host in it", () => {
    const message = `Git needs your credentials for this remote. Sign in once with git in a terminal (or set up a credential helper), then try again.

fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled`;
    expect(explainError(message)?.headline).toBe("git couldn't sign in to gitlab.com");
  });

  it("says a branch's remote branch is gone, and offers to go with another or push it back", () => {
    const message = "Your configuration specifies to merge with the ref 'refs/heads/master'\nfrom the remote, but no such ref was fetched.";
    const explained = explainError(message, { branch: "master", upstream: "origin/master" });
    expect(explained?.headline).toBe("origin has no branch called master any more");
    expect(explained?.detail).toBe("Your master pulls from origin/master, which was renamed or deleted on origin.");
    expect(explained?.fixes).toEqual(["useUpstream", "chooseUpstream", "pushBack"]);
  });

  it("leaves other messages alone", () => {
    expect(explainError("pick-target already has the commit")).toBeNull();
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
