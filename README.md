# Tributary

A fast, cross-platform git client built around the history graph, for macOS and Windows.

![Tributary showing the commit graph of a repository, with the details of a merge commit on the right](docs/images/overview.png)

Open a repository and Tributary draws its history as a colourful commit graph, with branches and tags labelled. Click a commit to see its details. You can also clone, commit, stash, manage branches and tags, merge, rebase (interactively too), cherry-pick, fetch, pull and push. It never changes the repository unless you ask it to.

**[Features](#features)** · **[Keyboard shortcuts](#keyboard-shortcuts)** · **[Download](#download)** · **[Development](#development)** · **[License](#license)**

## Contents

- [Features](#features)
  - [The commit graph](#the-commit-graph)
  - [Changes, line by line](#changes-line-by-line)
  - [Committing](#committing)
  - [Branches, merging and rewriting history](#branches-merging-and-rewriting-history)
  - [Conflicts](#conflicts)
  - [Who changed what, and why](#who-changed-what-and-why)
  - [Finding what broke](#finding-what-broke)
  - [Pull requests and remotes](#pull-requests-and-remotes)
  - [Working as a team](#working-as-a-team)
  - [Game projects, big files and Git LFS](#game-projects-big-files-and-git-lfs)
  - [Safety nets](#safety-nets)
  - [Tabs, repositories and the start screen](#tabs-repositories-and-the-start-screen)
  - [Make it yours](#make-it-yours)
  - [Under the hood](#under-the-hood)
  - [Keyboard shortcuts](#keyboard-shortcuts)
- [Download](#download)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Run it](#run-it)
  - [Try it in a browser](#try-it-in-a-browser)
  - [Build installers for your platform](#build-installers-for-your-platform)
  - [Test](#test)
  - [Project layout](#project-layout)
- [License](#license)

## Features

### The commit graph

- **Commit graph:** each lane has its own colour, merges are drawn as rounded connecting lines, and local branches, remote branches and tags are labelled. Dividers like **Today**, **Last week** and **October** separate commits from different periods (you can turn them off in the View menu), and marks next to the scrollbar show where the checked-out commit, branch tips, search matches and the selection are.
- **Uncommitted changes and stashes:** a row at the top shows your uncommitted changes, and each stash appears as a small box joined to the commit it was made from.
- **Always up to date:** changes made outside the app (saving in an editor, committing in the terminal, a pull by a script or an agent) show up as they happen: the open repository is watched, leaving out what `.gitignore` ignores, like build output.
- **Commit details:** the full message, author, committer and co-authors, parents (click one to jump to it) and the list of changed files, each with a small icon for its kind (picture, sound, video, 3D model, game engine asset, code, data, text, archive, font, program), as in every file list. Every file is listed, however many there are (only the rows on screen are drawn), and a long list has a filter: type part of a name or folder, like `level03 instance`. In your changes, the filter also turns **Stage all** into **Stage these 12**. Links, issue numbers like `#12` (or Jira and Linear keys like `FEAST-12`), and commit ids in the message can be clicked, and the issues it mentions are listed with their titles and states ([see below](#pull-requests-and-remotes)).
- **Search:** find commits by message, author, branch, tag or SHA. Matches are highlighted and you can jump between them. Switch the search box to **Files** to find the commits in any branch that changed a file whose path contains what you type (or matches a pattern like `*.psd`), or to **Code** for the commits that added or removed some exact text, like a function's name (`git log -S`). Matches further back than the loaded commits are counted, and appear as you scroll.
- **Branch sidebar:** every branch, remote branch, tag and stash, with a filter. Names that share a prefix, like `feature/…`, are grouped into folders, and you can pin the ones you use most to the top. Each branch shows how many commits it is ahead of (↑) and behind (↓) its upstream (counted by git over the whole history, not just the commits loaded), and so does its label in the graph (hover it for the details: a branch someone merged main into on the remote is behind by the merge and the commits it brought in, and a pull fast-forwards it). Click one to jump to its commit; double-click a branch to check it out. Double-clicking a remote branch, like `origin/feature`, checks out its local branch, and brings it up to date when it's only behind (a fast-forward).
- **Hide or solo branches:** the eye next to a branch in the sidebar hides it (and the commits only it has) from the graph. Right-click a branch and choose **Show only…** to see just that branch and the checked-out one. Tributary remembers this for each repository; **Show all** brings everything back.
- **Highlight a branch's history or an author's commits:** <kbd>Alt</kbd>+click a branch label (or right-click it and choose **Highlight**) to fade every commit that isn't part of its history. Right-click a commit to highlight everything its author committed, or turn on **Highlight My Commits** in the View menu. Press <kbd>Esc</kbd> to stop.
- **Only this branch:** in the View menu, **Only *branch*'s own history** hides merged-in side branches and shows just the commits made on the checked-out branch, following first parents.
- **Hover previews:** rest the mouse on a commit for a moment to see its full message and changed files without opening it. You can turn this off in the View menu.
- **Large repositories:** the 10,000 most recent commits load at once, and a button at the end of the list loads more. Only the visible rows are drawn, so scrolling stays smooth.

<sub>[↑ Contents](#contents)</sub>

### Changes, line by line

![A file's changes side by side, before and after, coloured by syntax, with the changed words marked](docs/images/side-by-side.png)

- **What changed in a file:** click a file in a commit, a stash or your changes to see its changes over the commit list: line numbers, added and removed lines coloured by their syntax (TypeScript, C++, C#, Rust, Python, shaders, JSON, YAML and some twenty more), and the words that changed within a line marked, with an option to ignore whitespace. The side-by-side button shows before and after in two columns instead, removed lines next to the lines that replaced them and long lines wrapping (in a panel too narrow for two columns, the changes stay in one); picking lines to stage works the same way there. <kbd>[</kbd> and <kbd>]</kbd> go to the previous and next file, <kbd>Esc</kbd> closes. Your own changes update as you edit, and the view follows a file you stage or unstage. Text stored with Git LFS is compared by its real contents. Pictures, sounds, videos and 3D models show as what they are ([see below](#game-projects-big-files-and-git-lfs)). Other binary files (like Unreal's `.uasset`, which only Unreal can read) show their sizes, with a button to open them in your diff tool (or **Open in merge tool**, for a conflicted file).
- **Diff and merge tools:** choose them in Settings, under **Diff and merge**: the tools git finds on your computer (Meld, Beyond Compare, WinMerge, P4Merge, KDiff3, …), Visual Studio Code, or a command of your own. They're git's own settings (`diff.tool`, `merge.tool`), so `git difftool` and `git mergetool` use them too. Until one is chosen, the diff view's button offers to choose one.
- **Per file:** right-click a changed file to discard its changes (with **Undo**; Tributary keeps them for 30 days), stash just that file, or for a new file, ignore it, every file like it, or its folder (added to `.gitignore`, with **Undo**).

<sub>[↑ Contents](#contents)</sub>

### Committing

![Two lines of a file chosen to stage, with the bar to stage or discard them, next to the commit box](docs/images/stage-lines.png)

- **Stage and commit:** click the uncommitted changes row to stage or unstage files and write a commit message. You can also amend the last commit. The summary shows its length (amber past 50 characters, red past 72), **Recent messages** reuses one of yours, and **Add co-author** credits someone from the history with a `Co-authored-by:` line.
- **Stage, unstage or discard parts of a file:** in the changes of a file you're working on, each hunk (a stretch of changed lines) has **Stage** and **Discard** buttons (**Unstage** for staged changes). To pick lines instead, click their line numbers (shift-click or drag for several), then **Stage 3 lines** or **Discard** in the bar that appears; <kbd>Esc</kbd> lets go of them. Discarded lines are kept for 30 days too, so **Undo** puts them back. New, renamed and Git LFS files are staged whole, and lines can't be picked while whitespace is ignored.
- **Stashes:** stash all your changes or just the files you pick from the uncommitted changes row, and apply, pop or drop a stash by right-clicking it. When uncommitted changes stop a pull or checkout, **Stash changes and retry** stashes them, tries again, and puts them back.
- **Fix up an earlier commit:** forgot something in a commit a few back? Stage the fix, right-click that commit and choose **Fix up this commit with the staged changes**. The fix is folded into it and the commits after it are rebased on top; changes you haven't staged are put aside meanwhile and put back after. **Undo** takes the fix back out, staged again.
- **When a hook stops a commit or push:** a repository's pre-commit, commit-msg or pre-push hook that fails shows what it printed, readably, with **Commit anyway (skip hooks)** (or **Push anyway**) to go ahead without it this once (`--no-verify`).
- **Why is a file ignored?** **Why Is a File Ignored…** in the Repository menu shows the rule that leaves a file out: which `.gitignore` (or exclude file), which line, and the pattern, with **Stage it anyway** to commit it despite the rule.
- **Split a commit:** right-click a commit on the checked-out branch and choose **Split this commit in two…**, tick the files that go into a commit of their own right after it, and write both messages. The files end up just as they were, your uncommitted changes aren't touched, and the commits after it are made again on top; **Undo** puts it back.
- **File names that won't work everywhere:** before you commit a new file whose name breaks a teammate's checkout on another system, the changes panel says so, and committing it asks first: names that differ only in capitals from another file or folder (`Content/props` next to `Content/Props`, one folder on Windows and macOS), names Windows keeps for devices (`CON`, `aux.txt`), characters it doesn't allow (`?`, `:`), names ending in a dot or a space, and paths too long for Windows once it's cloned into a folder.
- **Signed commits:** signed commits show a **Verified** mark in their details (or why not: a bad signature, an expired or revoked key, or one that couldn't be checked), with who signed them. To sign your own, open the repository's settings and choose **Signing**: as git is set up everywhere, not at all, with a GPG key, or with an SSH key. Tributary lists the GPG keys and the SSH keys in `~/.ssh` it finds to choose from, and git signs each commit (GPG or ssh-keygen asks for the key's passphrase if it has one).

<sub>[↑ Contents](#contents)</sub>

### Branches, merging and rewriting history

- **Branches:** right-click a commit to check out a branch on it, check out a remote branch (which creates a local branch that tracks it, or brings the one you have up to date when it's only behind), check out the commit itself, or create a new branch there. Double-click a branch label to check it out, or right-click it to rename or delete it, locally or on the remote. A checkout that takes a while (a big one, or one with Git LFS files to download) shows its progress under the toolbar: files updated, and Git LFS files checked out, with megabytes and speed.
- **Merge and rebase:** drag a branch label (from the graph or the sidebar) onto another commit or branch, then choose **Merge**, **Merge with a merge commit** (never a fast-forward), **Squash** (all its changes staged as one commit, with a message listing what was squashed) or **Rebase**. You can also right-click a branch or commit. Both act on the checked-out branch. If git stops because of conflicts, a bar at the top shows how many files conflict, with **Continue** (or **Commit merge**), **Skip commit** and **Abort**. The commit message is filled in for you.
- **Know before you merge:** the **Merge** and **Rebase** items in a branch's right-click menu say whether it would go cleanly (**3 commits, no conflicts**, or **Conflicts in Barber.uasset and 1 more file**, with the files when you hover), worked out by git without merging (`git merge-tree`, git 2.38 or later). A pull request the site says conflicts lists the files that do, merged here from its commits.

  ![A branch's menu: merging it would conflict in two files, and a rebase may stop at them](docs/images/merge-check.png)

- **Stacked branches:** a branch built on another one that isn't merged yet (`feature/export-pdf` on `feature/export`) says so in the sidebar. Rebasing, rewriting, fixing up or splitting commits moves the branches built on them along (git 2.38 or later), and the message says which. When the branch below was rewritten on its own (amended, rebased or force-pushed), the one on top shows **feature/export moved**, and its menu has **Move it onto the new feature/export**.
- **What changed when a branch was force-pushed:** right-click a branch and choose **What changed when it was force-pushed…** (or **…rewritten…** for your own), or **Since the force-push** in its pull request: each commit of the version before matched with its new version (`git range-diff`), so you see only what really changed, not the commits it was moved onto: the same, changed (with how), new or dropped. Earlier rewrites can be picked too.

  ![What changed in origin/fix/stool since it was force-pushed: two commits changed, with how, and a new one](docs/images/rewrite.png)

- **Cherry-pick and revert:** right-click a commit to copy it onto the checked-out branch, or to add a commit that undoes it. Shift-click or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>-click to select several commits and cherry-pick or revert them all at once.
- **Interactive rebase:** right-click a commit on the checked-out branch and choose **Interactive rebase** to rewrite the commits after it: drag them into a new order, reword their messages, squash or fix them up into the commit below, or drop them.
- **Tags and release notes:** create a tag on any commit (annotated when you give it a message), push it, or delete it here or on the remote. **Release notes for v0.3.0…** in a tag's menu writes what went into it since the tag before (or one you pick): each pull request merged, by its title and number, and each commit made on the main line, the Jira or Linear issues they mention, and who contributed, as Markdown to edit, copy, or publish as the tag's release on GitHub or GitLab.
- **Hard reset:** right-click a commit (or use the button in its details) to hard reset the checked-out branch to it, or right-click a branch or tag label, like `origin/main`, to reset to where it points. A confirmation shows exactly what will be lost first.
- **Patches:** right-click a commit (or several selected) and choose **Save as a patch…** to write them as one `.patch` file, oldest first, with their authors and messages (as `git format-patch` does), or **Copy as a patch** to paste it in a message. **Apply Patch…** in the Repository menu (or dropping a `.patch`, `.diff`, `.mbox` or `.eml` file on the window) shows what's in one, its commits and files and whether it applies to your files as they are, then applies it as commits (`git am`) or as changes to commit yourself (`git apply`). One that conflicts stops like a rebase, with the bar at the top.
- **Prune branches:** clean up local branches whose remote branch was deleted (usually merged pull requests) and branches merged into the main branch, from the Repository menu, the broom on the sidebar's Branches heading, or the status bar when a fetch finds some. Branches with commits that aren't in the main branch are listed but left unticked, the checked-out branch and long-lived ones like main are never offered, and **Undo** puts them all back.

<sub>[↑ Contents](#contents)</sub>

### Conflicts

![A merge conflict in a code file, with mine and theirs kept one after the other, ready to save and mark resolved](docs/images/conflicts.png)

- **Resolve conflicts here:** click a conflicted text file to go through its conflicts one by one: your side and theirs next to each other (and what it was before either change, when git wrote that), with the unchanged lines around them. Keep **Mine**, **Theirs**, both in either order, or **Edit…** to write it yourself; **All mine** and **All theirs** answer every conflict at once. **Save and mark resolved** saves the file and stages it, with **Undo** to put the conflicts back.
- **Keep mine or take theirs:** files that can't be merged, like game assets, are resolved by picking a whole version. The uncommitted changes panel lists conflicted files with **Mine** and **Theirs** buttons (named after the branches when you hover), and the conflict bar has **Keep all mine** and **Take all theirs**. If one side deleted the file, picking it deletes the file. During a rebase, "mine" is still your branch (git calls it "theirs" then). **Undo** puts the conflicts back.

<sub>[↑ Contents](#contents)</sub>

### Who changed what, and why

![Who changed each line of a file, a stretch of lines per commit, with the button to see the version before a change](docs/images/blame.png)

- **Who changed each line:** right-click a file (or use the button over its changes) for each line's last change: who, when and in which commit, a stretch of lines at a time, with newer changes marked brighter. In a commit it's the file as it was then; in your changes, as it is now (lines you haven't committed say so). Click an author to go to their commit. To dig further back, hover a change and click the clock next to it: the file as it was before that commit, showing who wrote those lines before (following renames). **Back** and **Forward** go between the versions you've looked at.
- **File history:** right-click a file in a commit or in your changes and choose **Show this file's history** (or its folder's). The commits that changed it stay bright, renames included, the bar at the top steps through them, and the file stands out in each commit's file list. **File History…** and **Folder History…** in the Repository menu let you pick any file or folder.
- **Compare two commits or branches:** right-click a branch label and choose **Compare with main** (the checked-out branch) to see what it has that yours doesn't, like a pull request: how many commits each has that the other doesn't, where they split, and the files that differ since then (or **Directly**, everything that's different). Select two commits (<kbd>⌘</kbd>/<kbd>Ctrl</kbd>-click) to compare them, right-click any commit to compare it with yours, or a tag to see what's changed since. Click a file to see its changes; <kbd>Esc</kbd> closes the comparison.

![feature/export compared with main: the commits each has that the other doesn't, where they split, and the files that differ](docs/images/compare.png)


<sub>[↑ Contents](#contents)</sub>

### Finding what broke

![A bisect that found the first bad commit, with the commits tested marked good and bad in the list](docs/images/bisect.png)

- **Find what broke (bisect):** something worked before and doesn't now? Right-click a commit where it still worked and choose **Find what broke since this commit (bisect)…**. Tributary checks out the commit halfway to the one you're on; try it, then click **Good** or **Bad** in the bar (or **Skip** if it can't be tested), and it halves what's left until it finds the first bad commit, with how many commits could still be the one along the way. Tested commits are marked good or bad in the list, and **Done** takes you back where you were.

<sub>[↑ Contents](#contents)</sub>

### Pull requests and remotes

![A pull request over the commit list: it can't be merged yet because changes were asked for, with its reviews, checks, description and conversation](docs/images/pull-request.png)

- **Pull requests in the app:** click a branch's pull request number to see it over the commit list: whether it can be merged (and if not, why: conflicts, changes asked for, failing checks), each reviewer's say, every check or pipeline job with a link to its page, the description, and the conversation. Checks that are still running are followed until they finish. To open one, right-click a branch and choose **Create pull request…** (or click it in the message after pushing): the title and description start from its commits, you pick the branch it goes into and whether it's a draft, and a branch that isn't pushed yet is pushed first. Without a token for the site, it opens on the website instead. GitLab merge requests work the same way.

  ![A pull request's conversation: a comment on a line of a file with the lines it's about, its reply, and a reply being written](docs/images/review.png)

- **CI on every commit:** for a repository on GitHub or GitLab, the newest commits in the list get a dot for their checks or pipeline: green passed, red failed, amber running (followed until they finish). A commit's details list them, failures first, with links, and **Re-run failed** runs the failed GitHub Actions jobs (or retries the GitLab pipeline) again. On GitHub, signed in, one request asks about all of them at once.
- **Pull request controls:** an open pull request's view can mark it **Ready for review** or put it **Back to draft**, **Ask for review…** from more people or teams, and turn on **Merge when checks pass** (GitHub's auto-merge, which the repository has to allow; GitLab's merge when the pipeline succeeds), or off again.
- **Code owners:** with a `CODEOWNERS` file (in `.github/`, at the top, in `docs/` or `.gitlab/`), opening a pull request offers to ask the owners of the files it changes for a review, and a file's changes say who owns it.
- **Review, comment and merge:** a pull request's conversation shows its comments, reviews and comments on lines (with the lines they're about), each thread with its replies. Reply in a thread, add a comment, or **Review** it: approve, ask for changes, or just comment. **Merge…** merges it on the site with a merge commit, squashed or rebased (the ways the repository allows), with the commit's summary and description, and can delete its branch afterwards; it warns when the site is likely to refuse. **See its changes** compares its branch with the one it goes into, in the app.
- **News of your pull requests:** Tributary follows the pull requests you opened (and those from your branches), and tells you when someone reviews or comments on one, when its checks finish or fail, and when it's merged or closed, with **Show** to open it (and a system notification while Tributary is in the background, if you like; set in Settings next to the new-commit notices).
- **Issues:** the repository's settings choose its issue tracker: its remote's own issues (GitHub or GitLab), Jira (its address and project keys) or Linear (its workspace and team keys), signing in to Jira and Linear with an API token, which git's credential helper keeps. Issue keys in commit messages link to their issues, commit details list the issues a commit mentions with their titles and states, and **New branch…** can start from one of the open issues assigned to you, named after it (`FEAST-23-tavern-sign-add-the-opening-hours`).

  ![Commit details listing the Jira issues the message mentions, with their states, and a new branch named after an issue assigned to you](docs/images/issues.png)
- **On GitHub, GitLab and Bitbucket:** right-click a commit, branch or tag to open it on the website. On GitHub, branches with an open pull request show its number, with a dot for its checks (green passed, red failed, amber running). On GitLab, branches with an open merge request show it the same way, like **!12**, with a dot for its latest pipeline. For private GitLab projects, Tributary uses the token git keeps for your GitLab server (a personal access token that can read the API). For private repositories, sign in to GitHub in Settings with a personal access token (or in the browser, with Git Credential Manager): Tributary checks it with GitHub and hands it to git's own credential helper, so pushing uses it too. Tributary doesn't store it itself.
- **Fetch, pull and push:** buttons in the toolbar, with the number of commits to pull and to push. A progress bar shows how far along they are, with a **Cancel** button, including Git LFS uploads and downloads (files, megabytes and speed). Tributary also fetches by itself every few minutes, so the numbers stay current. Every open tab is fetched, not just the one you're looking at. When that finds new commits on main or on the branch yours tracks, it tells you who pushed what, with a **Pull** button (or a dot on the tab, and **Open**, for another tab) (in Settings you can choose how often to fetch, turn the messages off, or also get a system notification while Tributary is in the background). The first push of a new branch sets its upstream, and when the remote suggests opening a pull request, a **Create pull request** button takes you there. When a pull needs a merge and you haven't told git whether to merge or rebase, it merges.
- **Force push:** from the menu next to Push, after a confirmation. It uses `--force-with-lease`, so it stops if someone else pushed in the meantime.
- **Remotes:** add, rename and remove remotes, and change their addresses (or give pushes an address of their own), from the repository's settings or the gear on the sidebar's Remotes heading. Passwords and tokens in addresses are never shown, there or in the activity log.

<sub>[↑ Contents](#contents)</sub>

### Working as a team

![Team activity: who committed in the last 7 days and where, the branches being worked on, and who holds which Git LFS locks](docs/images/team.png)

- **Team activity:** **View → Team Activity** sums up the last 7, 14 or 30 days: who committed (and how often, and when last) and on which branches; the branches being worked on, with who's on them, how far ahead of and behind the main branch they are, how many files they change, and whether they touch files you're changing; and who holds which Git LFS locks. Click a person to highlight their commits, or a branch to highlight its history. Fetch first to see your teammates' latest work.
- **Also changed elsewhere:** when a file you're working on (uncommitted, or changed by your branch's own commits: those not on the main branch, or not pushed yet when you're on it) was also changed on another branch in the last 30 days, the changes panel says where, by whom and in which commit, and the file gets a branch mark. Files that can't be merged, like Git LFS, lockable or binary assets, come first and stand out, since one version will have to win: better to talk to whoever changed it before spending a day on yours. The status bar shows how many; click it for the branches they're being worked on, who's working on each and when, and your files on each (click a file for that branch's change to it, or the eye to highlight the branch).
- **Git LFS file locks:** in repositories that use Git LFS, the sidebar lists the locked files and who locked them, and changed files show a padlock. Lock a file from its right-click menu or with **Lock Files…** in the Repository menu, unlock your own, or force-unlock someone else's after a warning. If you've changed a file someone else has locked, the changes panel says so before you try to push. If you've changed a lockable file nobody has locked, it offers to lock it for you (or, with the setting on, locks it as soon as you change it). After you push, it offers to release your locks on the files you pushed, so your teammates can work on them (files you're still changing keep theirs); in Settings you can have it release them without asking, or never.

<sub>[↑ Contents](#contents)</sub>

### Game projects, big files and Git LFS

![A Photoshop texture's changes: the pixels that changed lit up over a greyed copy, with how many changed and where](docs/images/textures.png)

- **Pictures, sounds, videos and 3D models:** show as what they are, before and after: images side by side; sounds with players and waveforms on the same time scale; videos side by side with **Play both**; 3D models (glTF/GLB, OBJ, FBX, STL, PLY) in two views that turn together, with a wireframe option and their meshes, vertices, triangles, materials and size compared.

  ![A 3D model before and after, in two views that turn together, with its vertices, triangles and size compared](docs/images/media.png)

- **Textures:** Photoshop (`.psd`, `.psb`), Targa, DDS (DXT1, DXT3, DXT5), OpenEXR, TIFF and Radiance HDR files show as pictures too, Blender files (`.blend`, compressed or not) as the preview picture Blender saves in them, and Unreal assets (`.uasset`, `.umap`) as the thumbnail Unreal saves in them, read by the app (high dynamic range ones as they'd look on screen), at most 2048 pixels a side, with their real sizes. Compare two versions of a picture side by side, by **Swipe** (one over the other, dragging across), **Onion skin** (faded over each other), or **Changed pixels**, lit up over a greyed copy, with how many changed and where (or that none did, when only the file's settings changed).

  ![An Unreal level's actors, saved one per file, listed by their names, classes and level instead of their hashed file names](docs/images/actors.png)

- **Unreal levels saved one actor per file:** with World Partition, each actor is a file under `__ExternalActors__` named by a hash. Tributary reads each one's name in the editor and its class from the file, and lists it as `SM_Bench_Long  StaticMeshActor · Maps/Tavern`: in commits, your changes, comparisons, the diff view and the locked files, and the file filter finds them by name. Git LFS files are read from the local copy Git LFS downloaded.
- **Unity's .meta files:** in a Unity project, before you commit, the changes panel flags new files and folders under `Assets` that have no `.meta` yet, `.meta` files whose asset is gone, and deleted assets whose `.meta` was left behind; committing them (or an asset whose new `.meta` isn't staged with it) asks first. A teammate's copy of an asset without its `.meta` gets a new id, and whatever used it loses it.
- **Unity scenes and prefabs:** in a Unity project, the repository's settings set up Unity's Smart Merge (UnityYAMLMerge, found in the editors Unity Hub installed, the project's own version first) as git's merge driver for the files Unity saves as YAML, so merges combine them by what changed in them. It's set up for this repository on this computer only. A conflicted scene or prefab also gets a **Smart Merge** button next to **Mine** and **Theirs**.
- **Big repositories:** **Folders**, in the repository's settings, changes which folders are checked out after cloning (a sparse checkout): the others leave the disk, and in a partial clone, folders you add are downloaded. **Speed** turns on git's own speed-ups, which it leaves off: its file watcher (Windows and macOS), the untracked cache, a commit graph that fetches keep up to date, and background maintenance. A big repository without any of them gets a one-time offer.
- **What makes it big:** **What Makes It Big…** in the Repository menu shows what the history takes on disk, the biggest files in all of it (deleted ones too, since everyone who clones still downloads them), and what each folder and kind of file costs. Kinds of big file move into Git LFS from now on, or by rewriting history (`git lfs migrate`): the branch's commits that aren't pushed yet, or every branch's whole history (each backed up first, then to force-push).
- **Big files and Git LFS:** the changes panel warns about big files (10 MB by default, set in Settings) that aren't stored with Git LFS, with a **Track \*.ext with LFS** button that sets up LFS and moves staged files into it. Committing a big file outside LFS asks first. **Clean Up Git LFS Files…** (Repository menu, or Settings, which shows the space they take) deletes local copies that aren't needed any more.
- **Git LFS files that weren't downloaded:** when files stored with Git LFS are still the small pointer files that stand in for them (after a clone without them, say), a bar says how many and offers **Download them**, with progress. It also says when Git LFS isn't installed (**Get Git LFS**) or git isn't set up to use it (**Set up Git LFS**). Files left out of a sparse checkout don't count.

<sub>[↑ Contents](#contents)</sub>

### Safety nets

- **Undo:** after a checkout, commit, merge, rebase, interactive rebase, split, cherry-pick, revert, hard reset, rename, new tag, or branch or tag deletion, the confirmation message has an **Undo** button.
- **Branch safety:**
  - **Protected branches:** main, master and develop by default, plus any you protect from a branch's right-click menu (shown with a padlock). They can't be deleted, and rebasing, hard resetting or force pushing one needs its name typed first.
  - **What would be lost:** deleting a branch (here or on the remote) first lists the commits that are on no other branch, remote branch or tag, or says that nothing is lost.
  - **Recover Commits…:** git's reflog, everything that moved HEAD here (commits, checkouts, resets, rebases), newest first. Commits that are on no branch any more, say after a reset in the terminal, can get a branch again.
  - **Restore Branch…:** whenever Tributary deletes, prunes, resets, rebases, splits or force-pushes a branch (or moves the branches stacked on it), it keeps where the branch was for 30 days (as hidden refs under `refs/tributary/backups/`, which also keep the commits from git's garbage collection). The Repository menu lists them and puts any of them back, without overwriting anything. Deleting a branch from the remote can also be undone straight away.

<sub>[↑ Contents](#contents)</sub>

### Tabs, repositories and the start screen

![The start screen, with each recent repository's branch, uncommitted changes, commits to push, or that its folder is gone](docs/images/start.png)

- **Open, clone or create:** open a repository, clone one from its address (with progress and **Cancel**), create a new one in a folder, or drop a folder onto the window. For big repositories, the clone dialog can leave Git LFS files to download later, check out only some folders (the contents of the rest aren't downloaded), or download only recent history. The welcome screen lists recent repositories with where each stands now: its branch, uncommitted changes and conflicts, commits to push and pull, or that its folder is gone. Pin the ones you use most, or type to find one.
- **Tabs:** open several repositories at once, each in its own tab. Tributary reopens your tabs when it starts, and each tab remembers the selected commit, where you scrolled to and your unfinished commit message. The **+** button opens a new tab with the start screen: open, clone or create a repository, or pick a recent one.
- **Worktrees:** work on two branches at once, each in its own folder. Right-click a branch and choose **Open in a new worktree…** (or a commit, to start a new branch there, or use the Repository menu), and it opens in a new tab. The sidebar's **Worktrees** section lists them: click one to see its commit, double-click to open it, or right-click to show it in Finder or Explorer, copy its path or remove it (Tributary asks before throwing away uncommitted changes). A branch that's checked out in another worktree offers to open that one instead.
- **Submodules:** the sidebar lists the repository's submodules and marks those that need something: **out of date** (a checkout or pull changed the commit recorded for it, and git left it where it was), **not set up**, **new commits** (to record with a commit) or **changed**. Click one to open it in a new tab (double-click does too), update it to the recorded commit, stage it, or copy its path or address. After a checkout or pull leaves submodules behind, a bar offers to update them (in Settings you can have it update them without asking, or say nothing). A submodule at a new commit shows among your changes, and its changes list the commits it moved by. Cloning clones submodules too, unless you untick it.
- **Repository settings:** each repository has its own window, from its tab's right-click menu, **Repository Settings…** in the Repository menu, or the command palette: the name and email you commit with in that repository (when it should differ from your usual one, like a work address), how its commits are signed, its remotes, its issue tracker, its protected branches, which folders are checked out, git's speed-ups, Unity's Smart Merge (in a Unity project), and Git LFS: which files it stores with Git LFS (add or remove patterns like `*.psd`; a repository that doesn't use it yet is offered the kinds of big files it has, or common ones) the space those files take on this computer, and which folders' Git LFS files to download: every folder, only some (like `Content/Characters`), or all but some, with the folders that have Git LFS files offered with their sizes (git-lfs's own `lfs.fetchinclude` and `lfs.fetchexclude`, so pulling and checking out follow it too). The tab's menu can also show the folder, copy its path, and close the tab or the others.
- **Menu bar:** File, View, Repository and Help menus with every command and its shortcut: in the macOS menu bar, and next to the tabs on Windows. On Windows the tab bar is the title bar, with the minimize, maximize and close buttons at its right.
- **Status bar:** the checked-out branch and how it compares to its upstream, when the repository was last fetched (click to fetch), and the repository's folder (click to show it in Finder or Explorer).
- **Activity log:** every git command Tributary runs, with what git printed, how long it took and whether it worked. Open it from the status bar or with <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>.
- **Command palette:** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> lists the commands and branches, so you can check out, merge, highlight or run almost anything by typing a few letters. Press <kbd>?</kbd> to see all keyboard shortcuts.

<sub>[↑ Contents](#contents)</sub>

### Make it yours

![The light theme, with the appearance settings: theme, accent colour, graph colours, commits as their authors' pictures, line bends and diff colours](docs/images/appearance.png)

- **Appearance:** dark, light, or the same as your system (switching when it does). An accent colour for buttons, selections, links, focus and the checked-out branch: one of nine, or any colour you like, from the colour picker or typed as a hex code like `#e8702a` (text in it is darkened or lightened until it's easy to read). Commits on the graph as their authors' pictures (or initials), ringed in their branch's colour, or as dots (merges are small dots either way). The graph's colours: vivid, soft, colour-blind safe (built on the Okabe–Ito colours), or your own (start from any of them, then click a colour to change it, add or take out colours). And how its lines bend between lanes: smoothly into the next lane and round for longer jumps (the default), or round, smooth (like Apple's rounded corners), tight or sweeping everywhere. Added and removed lines in green and red, or in blue and orange, which are easier to tell apart with red–green colour blindness. Notes and warnings keep their own colours whatever the accent, so they don't look like something else. The app's icon follows the theme too: light or dark, in the Dock or on the taskbar.
- **Settings:** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>,</kbd> opens the app's settings, grouped in a list on the left: general (submodules, updates), appearance, accounts (your GitHub sign-in), background fetching and notifications, large files and Git LFS, and how the commit list looks.
- **Your layout:** drag the edges of the sidebar, the details panel and the Branch / Tag and Graph columns (double-click to reset). Right-click the column headings to show or hide Author, Date and SHA, and to show exact dates or commit dates instead of "3 hours ago". The View menu has compact rows and zoom. All of it is remembered. On macOS the toolbar sits in the title bar, next to the window buttons.
- **Profile pictures (optional):** turn on **Profile pictures** in Settings (or the View menu) to show authors' pictures instead of initials. For a repository on GitHub, Tributary asks GitHub which account each author's email belongs to (signed in, it can ask about every author; otherwise it goes by the latest 100 commits); on GitLab, it asks the GitLab server; otherwise, or when they don't know, it tries Gravatar. It is off by default, because it sends authors' email addresses to GitHub or GitLab (which host the repository anyway) and a hash of them to Gravatar. The pictures are fetched by the app itself, not the page, and kept on this computer for a week (in Tributary's cache folder, named by a hash of each address, not the address), so they show at once the next time; older ones show while they're fetched again. Turning profile pictures off deletes them.
- **Open in your editor or terminal:** the toolbar's **Open** button (and the Repository menu) opens the repository on GitHub or GitLab, in Finder or Explorer, or in your editor or terminal, or copies its folder's path. A changed file's menu opens the file, in the editor and terminal chosen in Settings (or the first found): Visual Studio Code, Cursor, Visual Studio, Rider, Zed, Sublime Text, IntelliJ IDEA or Fleet; Terminal, iTerm, Warp, Ghostty, Windows Terminal, PowerShell, Git Bash or the Command Prompt, or Linux's usual terminals.
- **Move your settings:** Settings, General, saves every setting to a file and reads it back on another computer: appearance, columns, notices, and each repository's pinned, hidden and protected branches (matched to the repository with the same folder name there). Passwords and tokens aren't in it: git's credential helper keeps those.
- **Keyboard and accessibility:** menus, tabs and the sidebar work with the arrow keys, dialogs keep the keyboard inside them and give it back when they close, every button has a name for screen readers, and animations (the side panels sliding open and closed, the progress bar sliding down, windows and menus fading in) stop when your system asks for reduced motion.

<sub>[↑ Contents](#contents)</sub>

### Under the hood

- **No git install needed to browse:** history is read directly with [gitoxide](https://github.com/GitoxideLabs/gitoxide). Actions that change the repository (cloning, committing, stashing, branches, tags, merge, rebase, cherry-pick, revert, fetch, pull, push, reset) run your installed git, so they behave exactly like the command line and use the credentials you already set up for it.
- **Automatic updates:** Tributary checks its GitHub releases now and then, and an **Update** button appears in the tab bar when there's a new version. It shows what changed, then downloads, installs and restarts. Updates are signed, and installed only when the signature matches. (When the GitHub repository is private, it signs in with the GitHub account git already uses on your computer.)
- **Reporting a problem:** **Copy Diagnostics…** in the Help menu shows Tributary's version, your system, which git and Git LFS it uses, how the open repository is set up and the last git commands that failed there, so you can read it before you copy it into a report. Passwords and tokens in remote addresses are left out.

<sub>[↑ Contents](#contents)</sub>

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> | Command palette |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>O</kbd> | Open a repository |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>,</kbd> | Settings |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>T</kbd> | New tab, with the start screen |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>W</kbd> | Close the tab |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>1</kbd> … <kbd>9</kbd>, <kbd>Ctrl</kbd> + <kbd>Tab</kbd> | Switch tabs |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>R</kbd> or <kbd>F5</kbd> | Refresh |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>F</kbd> | Search; <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> for the next / previous match |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>B</kbd> | Show or hide the branch sidebar |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> | Show or hide the activity log |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Commit, in the commit message box |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd> | Zoom in, zoom out, actual size |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Page Up</kbd> <kbd>Page Down</kbd> <kbd>Home</kbd> <kbd>End</kbd> | Move through commits |
| <kbd>Shift</kbd> + click, <kbd>Shift</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> | Select a range of commits |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + click | Add a commit to the selection, or take it out |
| <kbd>Alt</kbd> + click a branch label | Highlight the branch's history |
| Click a changed file, or <kbd>Enter</kbd> on it | Show its changes; <kbd>[</kbd> <kbd>]</kbd> for the previous and next file, <kbd>Esc</kbd> to close |
| <kbd>Esc</kbd> | Stop highlighting, then clear the selection, then close the details panel |
| <kbd>?</kbd> | Show the keyboard shortcuts |
| <kbd>F10</kbd> (Windows and Linux) | Open the menu bar; <kbd>←</kbd> <kbd>→</kbd> move between its menus |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Home</kbd> <kbd>End</kbd>, or a letter | Move through a menu; <kbd>Enter</kbd> picks, <kbd>Esc</kbd> closes |
| <kbd>←</kbd> <kbd>→</kbd> on a tab | Move between tabs; <kbd>Enter</kbd> switches, <kbd>Delete</kbd> closes |
| <kbd>↑</kbd> <kbd>↓</kbd> in the sidebar | Move between branches, tags and stashes; <kbd>←</kbd> <kbd>→</kbd> fold and unfold folders |

<sub>[↑ Contents](#contents)</sub>

## Download

The installers are built by GitHub Actions, only when you start a build: open the **Actions** tab, choose **Build**, then **Run workflow**. When it finishes, download the installers from the **Artifacts** section of the run:

- **macOS:** `.dmg` with a universal app (Apple Silicon and Intel)
- **Windows:** `.msi` and `-setup.exe` installers (64-bit)

To publish a release, type a version tag such as `v0.2.0` in the **release** box before starting the build. The app gets that version, and a draft GitHub release with the installers attached is created when it finishes. Publish the draft, and Tributary offers the update to everyone running an older version.

For updates, the installers are signed with a key kept in the repository's `TAURI_SIGNING_PRIVATE_KEY` secret (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, if it has a password); the matching public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Without the secret, builds still work, but they can't be installed as updates. To make a new key pair:

```bash
npm run tauri signer generate -- -w ~/.tauri/tributary.key
```

Then save the private key as the secret (`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/tributary.key`) and put the public key in `tauri.conf.json`. Apps signed with the old key can't install updates signed with a new one, so they need to be reinstalled by hand once.

The builds are not code-signed yet, so the first launch needs one extra step:

- **macOS:** if macOS says the app "is damaged" or "can't be opened", move it to Applications and run `xattr -cr /Applications/Tributary.app` once.
- **Windows:** if SmartScreen shows a warning, choose **More info → Run anyway**.

## Development

Tributary is a [Tauri 2](https://tauri.app) app: a Rust backend reads the repository, and a React + TypeScript frontend draws it.

### Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) (stable)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++". WebView2 comes with Windows 10 and 11.

The [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) has more detail.

### Run it

```bash
npm install
```

```bash
npm run tauri dev
```

### Try it in a browser

The interface runs in an ordinary browser too, against real repositories, with the app's own Rust code answering it (`tools/preview`). That's quicker for working on the interface, and it's how the screenshots are made:

```bash
npm run preview:build
```

```bash
npm run preview:demo
```

That builds demo repositories with made-up people and history and serves the app on <http://127.0.0.1:4173>; choose **Open repository** and paste a path it printed. `npm run preview` does the same for your own repositories. See [tools/preview](tools/preview/README.md).

The pictures in this README are taken the same way, from the demos. After changing the interface, take them again (into `docs/images`):

```bash
npm run preview:screenshots
```

### Build installers for your platform

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/`.

### Test

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The integration tests create small repositories with the `git` command, so git needs to be installed to run them (and Git LFS, for the LFS tests; they're skipped without it). The interface's own logic has tests too:

```bash
npm test
```

ESLint checks the interface's code, with React's rules of hooks:

```bash
npm run lint
```

A smoke test clicks through the main parts of the app in Chromium, on fresh demo repositories (it needs Playwright, see [tools/preview](tools/preview/README.md)):

```bash
npm run preview:smoke
```

The tests don't run on GitHub Actions, so run them before you build.

### Project layout

| Path | What it does |
| --- | --- |
| `src-tauri/src/repo/` | Reads commits, branches, tags, changed files, the reflog and worktrees with gix |
| `src-tauri/src/graph.rs` | Gives each commit a lane and works out the lines to draw in each row |
| `src-tauri/src/actions/` | Runs git for everything that changes the repository, one module per area (branches, history, stashes, conflicts, Git LFS, worktrees, backups, …) |
| `src-tauri/src/git/` | Runs the user's git: progress and cancel, Git LFS progress, the activity log, credentials |
| `src-tauri/src/commands.rs` | The commands the frontend calls |
| `src-tauri/src/error.rs` | The error every command can return |
| `src-tauri/src/github/` | Open pull requests and their checks, opening one and reading one in full; signing in |
| `src-tauri/src/gitlab/` | The same for merge requests on GitLab and their pipelines |
| `src-tauri/src/requests.rs` | Pull and merge requests in the app, whichever site the repository is on |
| `src-tauri/src/reviews.rs` | A request's conversation, reviewing, commenting on and merging it (GitHub's and GitLab's sides in their folders) |
| `src-tauri/src/issues.rs` | Issue trackers: GitHub and GitLab issues, Jira and Linear |
| `src-tauri/src/textures.rs` | Reads textures the window can't show (Photoshop, Targa, DDS, OpenEXR, TIFF, HDR, Blender's and Unreal's previews) into PNG previews |
| `src-tauri/src/codeowners.rs` | Reads `CODEOWNERS`: who owns which files |
| `src-tauri/src/ci.rs` | CI for any commit on GitHub or GitLab: each one's state, its checks or jobs, re-running failed ones |
| `src-tauri/src/apps.rs` | Finds the editors and terminals installed, and opens a repository or file in one |
| `src-tauri/src/unreal.rs` | Names Unreal actors saved in their own files, from their asset registry tags |
| `src-tauri/src/locks.rs` | Lists Git LFS file locks, telling yours from everyone else's |
| `src-tauri/src/diagnostics.rs` | What **Copy Diagnostics** shows |
| `src-tauri/src/links.rs` | Turns remote addresses into web pages (GitHub, GitLab, …) |
| `src-tauri/src/updates.rs` | Finds, downloads and installs new versions from the GitHub releases |
| `src-tauri/tests/` | Integration tests, one file per area, on throwaway repositories |
| `src-tauri/examples/headless.rs` | The app's commands without a window, for the browser preview |
| `src/App.tsx` | Connects the parts: the tabs, the open repository or the start screen, and what opens over them |
| `src/app/` | The app's state, in hooks (the open repository, tabs, selection, search, highlighting, actions, per-repository settings, …), and its screens, menus, command palette and dialogs |
| `src/api/` | The commands the frontend calls, and the shapes of what they take and give back, one file per area |
| `src/menus/` | The right-click menus of commits, branch and tag labels and the sidebar |
| `src/components/` | The interface: the commit list (only the rows on screen are rendered; its layout, header, rows and canvases in `commitList/`), the sidebar (`sidebar/`), the changes panel (`worktree/`), the details panel, the dialogs, … |
| `src/lib/` | Logic without an interface (search, selection, undo, paths, diagnostics, …), with its tests |
| `src/styles/` | The styles, an area per file (colours and themes in `theme.css`), applied in the order `src/styles.css` lists them |
| `tools/preview/` | The browser preview, demo repositories and the smoke test |
| `tools/icons/` | Draws the app icon, light and dark, and renders it at every size |

The app icon comes in a light and a dark version, and the app shows the one that matches its theme while it runs (in the Dock on macOS, on the taskbar elsewhere); the installed app carries the light one. Both are drawn by `tools/icons/draw.py` (into `src-tauri/icons/app-icon.svg` and `app-icon-dark.svg`), then rendered at every size with Chromium, whose gradients come out smooth. The macOS icon keeps Apple's margins around the tile; the Windows and Linux ones fill their square, so they're as big as they can be in a taskbar:

```bash
python3 tools/icons/draw.py
```

```bash
node tools/icons/render.mjs
```

The in-app logo (`Logo` in `src/components/Icons.tsx`) is the same drawing, with or without its tile; change both together.

## License

[MIT](LICENSE)

The interface uses [Google Sans](https://fonts.google.com/specimen/Google+Sans) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (for SHAs, branch names, file names and code), both under the [SIL Open Font License 1.1](https://openfontlicense.org), bundled from their `@fontsource-variable` packages. 3D models are shown with [three.js](https://threejs.org) (MIT), and code is coloured with [highlight.js](https://highlightjs.org) (BSD-3-Clause).
