# Tributary

A fast, cross-platform git history graph viewer for macOS and Windows.

![Tributary showing the commit graph of a repository, with the details of a merge commit on the right](docs/screenshot.png)

Open a repository and Tributary draws its history as a colourful commit graph, with branches and tags labelled. Click a commit to see its details. You can also clone, commit, stash, manage branches and tags, merge, rebase (interactively too), cherry-pick, fetch, pull and push. It never changes the repository unless you ask it to.

## Features

- **Commit graph:** each lane has its own colour, merges are drawn as rounded connecting lines, and local branches, remote branches and tags are labelled. Dividers like **Today**, **Last week** and **October** separate commits from different periods (you can turn them off in the View menu), and marks next to the scrollbar show where the checked-out commit, branch tips, search matches and the selection are.
- **Uncommitted changes and stashes:** a row at the top shows your uncommitted changes, and each stash appears as a small box joined to the commit it was made from.
- **Stage and commit:** click the uncommitted changes row to stage or unstage files and write a commit message. You can also amend the last commit. The summary shows its length (amber past 50 characters, red past 72), **Recent messages** reuses one of yours, and **Add co-author** credits someone from the history with a `Co-authored-by:` line.
- **What changed in a file:** click a file in a commit, a stash or your changes to see its changes over the commit list: line numbers, added and removed lines, and the words that changed within a line marked, with an option to ignore whitespace. <kbd>[</kbd> and <kbd>]</kbd> go to the previous and next file, <kbd>Esc</kbd> closes. Your own changes update as you edit, and the view follows a file you stage or unstage. Images show before and after, side by side; other binary files and Git LFS files show their sizes. **Open in diff tool** (or **Open in merge tool**, for a conflicted file) opens it in the tool you set up for git (`git config --global diff.tool vscode`, say, or `meld`, `kdiff3`, `p4merge`, `bc`).
- **Per file:** right-click a changed file to discard its changes (with **Undo**; Tributary keeps them for 30 days), stash just that file, or for a new file, ignore it, every file like it, or its folder (added to `.gitignore`, with **Undo**).
- **Big files and Git LFS:** the changes panel warns about big files (10 MB by default, set in Settings) that aren't stored with Git LFS, with a **Track \*.ext with LFS** button that sets up LFS and moves staged files into it. Committing a big file outside LFS asks first. **Clean Up Git LFS Files…** (Repository menu, or Settings, which shows the space they take) deletes local copies that aren't needed any more.
- **Git LFS files that weren't downloaded:** when files stored with Git LFS are still the small pointer files that stand in for them (after a clone without them, say), a bar says how many and offers **Download them**, with progress. It also says when Git LFS isn't installed (**Get Git LFS**) or git isn't set up to use it (**Set up Git LFS**). Files left out of a sparse checkout don't count.
- **Stashes:** stash all your changes or just the files you pick from the uncommitted changes row, and apply, pop or drop a stash by right-clicking it. When uncommitted changes stop a pull or checkout, **Stash changes and retry** stashes them, tries again, and puts them back.
- **Always up to date:** changes made in a terminal or editor show up as soon as you switch back to Tributary.
- **Commit details:** the full message, author, committer and co-authors, parents (click one to jump to it) and the list of changed files. Links, issue numbers like `#12` and commit ids in the message can be clicked.
- **Search:** find commits by message, author, branch, tag or SHA. Matches are highlighted and you can jump between them.
- **Branches:** right-click a commit to check out a branch on it, check out a remote branch (which creates a local branch that tracks it), check out the commit itself, or create a new branch there. Double-click a branch label to check it out, or right-click it to rename or delete it, locally or on the remote.
- **Branch sidebar:** every branch, remote branch, tag and stash, with a filter. Names that share a prefix, like `feature/…`, are grouped into folders, and you can pin the ones you use most to the top. Each branch shows how many commits it is ahead of (↑) and behind (↓) its upstream. Click one to jump to its commit; double-click a branch to check it out.
- **Worktrees:** work on two branches at once, each in its own folder. Right-click a branch and choose **Open in a new worktree…** (or a commit, to start a new branch there, or use the Repository menu), and it opens in a new tab. The sidebar's **Worktrees** section lists them: click one to see its commit, double-click to open it, or right-click to show it in Finder or Explorer, copy its path or remove it (Tributary asks before throwing away uncommitted changes). A branch that's checked out in another worktree offers to open that one instead.
- **Submodules:** the sidebar lists the repository's submodules and marks those that need something: **out of date** (a checkout or pull changed the commit recorded for it, and git left it where it was), **not set up**, **new commits** (to record with a commit) or **changed**. Click one to open it in a new tab (double-click does too), update it to the recorded commit, stage it, or copy its path or address. After a checkout or pull leaves submodules behind, a bar offers to update them (in Settings you can have it update them without asking, or say nothing). A submodule at a new commit shows among your changes, and its changes list the commits it moved by. Cloning clones submodules too, unless you untick it.
- **Hide or solo branches:** the eye next to a branch in the sidebar hides it (and the commits only it has) from the graph. Right-click a branch and choose **Show only…** to see just that branch and the checked-out one. Tributary remembers this for each repository; **Show all** brings everything back.
- **Merge and rebase:** drag a branch label (from the graph or the sidebar) onto another commit or branch, then choose **Merge**, **Merge with a merge commit** (never a fast-forward), **Squash** (all its changes staged as one commit, with a message listing what was squashed) or **Rebase**. You can also right-click a branch or commit. Both act on the checked-out branch. If git stops because of conflicts, a bar at the top shows how many files conflict, with **Continue** (or **Commit merge**), **Skip commit** and **Abort**. The commit message is filled in for you.
- **Keep mine or take theirs:** files that can't be merged, like game assets, are resolved by picking a whole version. The uncommitted changes panel lists conflicted files with **Mine** and **Theirs** buttons (named after the branches when you hover), and the conflict bar has **Keep all mine** and **Take all theirs**. If one side deleted the file, picking it deletes the file. During a rebase, "mine" is still your branch (git calls it "theirs" then). **Undo** puts the conflicts back.
- **Git LFS file locks:** in repositories that use Git LFS, the sidebar lists the locked files and who locked them, and changed files show a padlock. Lock a file from its right-click menu or with **Lock Files…** in the Repository menu, unlock your own, or force-unlock someone else's after a warning. If you've changed a file someone else has locked, the changes panel says so before you try to push. If you've changed a lockable file nobody has locked, it offers to lock it for you (or, with the setting on, locks it as soon as you change it). After you push, it offers to release your locks on the files you pushed, so your teammates can work on them (files you're still changing keep theirs); in Settings you can have it release them without asking, or never.
- **Also changed elsewhere:** when a file you're working on (uncommitted, or changed by your branch's own commits: those not on the main branch, or not pushed yet when you're on it) was also changed on another branch in the last 30 days, the changes panel says where, by whom and in which commit, and the file gets a branch mark. Files that can't be merged, like Git LFS, lockable or binary assets, come first and stand out, since one version will have to win: better to talk to whoever changed it before spending a day on yours. The status bar shows how many; click it for the branches they're being worked on, who's working on each and when, and your files on each (click a file for that branch's change to it, or the eye to highlight the branch).
- **File history:** right-click a file in a commit or in your changes and choose **Show this file's history** (or its folder's). The commits that changed it stay bright, renames included, the bar at the top steps through them, and the file stands out in each commit's file list. **File History…** and **Folder History…** in the Repository menu let you pick any file or folder.
- **Cherry-pick and revert:** right-click a commit to copy it onto the checked-out branch, or to add a commit that undoes it. Shift-click or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>-click to select several commits and cherry-pick or revert them all at once.
- **Interactive rebase:** right-click a commit on the checked-out branch and choose **Interactive rebase** to rewrite the commits after it: drag them into a new order, reword their messages, squash or fix them up into the commit below, or drop them.
- **Prune branches:** clean up local branches whose remote branch was deleted (usually merged pull requests) and branches merged into the main branch, from the Repository menu, the broom on the sidebar's Branches heading, or the status bar when a fetch finds some. Branches with commits that aren't in the main branch are listed but left unticked, the checked-out branch and long-lived ones like main are never offered, and **Undo** puts them all back.
- **Branch safety:**
  - **Protected branches:** main, master and develop by default, plus any you protect from a branch's right-click menu (shown with a padlock). They can't be deleted, and rebasing, hard resetting or force pushing one needs its name typed first.
  - **What would be lost:** deleting a branch (here or on the remote) first lists the commits that are on no other branch, remote branch or tag, or says that nothing is lost.
  - **Recover Commits…:** git's reflog, everything that moved HEAD here (commits, checkouts, resets, rebases), newest first. Commits that are on no branch any more, say after a reset in the terminal, can get a branch again.
  - **Restore Branch…:** whenever Tributary deletes, prunes, resets, rebases or force-pushes a branch, it keeps where the branch was for 30 days (as hidden refs under `refs/tributary/backups/`, which also keep the commits from git's garbage collection). The Repository menu lists them and puts any of them back, without overwriting anything. Deleting a branch from the remote can also be undone straight away.
- **Tags:** create a tag on any commit (annotated when you give it a message), push it, or delete it here or on the remote.
- **Highlight a branch's history or an author's commits:** <kbd>Alt</kbd>+click a branch label (or right-click it and choose **Highlight**) to fade every commit that isn't part of its history. Right-click a commit to highlight everything its author committed, or turn on **Highlight My Commits** in the View menu. Press <kbd>Esc</kbd> to stop.
- **Only this branch:** in the View menu, **Only *branch*'s own history** hides merged-in side branches and shows just the commits made on the checked-out branch, following first parents.
- **Hover previews:** rest the mouse on a commit for a moment to see its full message and changed files without opening it. You can turn this off in the View menu.
- **Command palette:** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> lists the commands and branches, so you can check out, merge, highlight or run almost anything by typing a few letters. Press <kbd>?</kbd> to see all keyboard shortcuts.
- **Undo:** after a checkout, commit, merge, rebase, interactive rebase, cherry-pick, revert, hard reset, rename, new tag, or branch or tag deletion, the confirmation message has an **Undo** button.
- **Fetch, pull and push:** buttons in the toolbar, with the number of commits to pull and to push. A progress bar shows how far along they are, with a **Cancel** button, including Git LFS uploads and downloads (files, megabytes and speed). Tributary also fetches by itself every few minutes, so the numbers stay current. Every open tab is fetched, not just the one you're looking at. When that finds new commits on main or on the branch yours tracks, it tells you who pushed what, with a **Pull** button (or a dot on the tab, and **Open**, for another tab) (in Settings you can choose how often to fetch, turn the messages off, or also get a system notification while Tributary is in the background). The first push of a new branch sets its upstream, and when the remote suggests opening a pull request, a **Create pull request** button takes you there. When a pull needs a merge and you haven't told git whether to merge or rebase, it merges.
- **Force push:** from the menu next to Push, after a confirmation. It uses `--force-with-lease`, so it stops if someone else pushed in the meantime.
- **Hard reset:** right-click a commit (or use the button in its details) to hard reset the checked-out branch to it. A confirmation shows exactly what will be lost first.
- **Large repositories:** the 10,000 most recent commits load at once, and a button at the end of the list loads more. Only the visible rows are drawn, so scrolling stays smooth.
- **On GitHub, GitLab and Bitbucket:** right-click a commit, branch or tag to open it on the website, or a branch to create a pull (or merge) request. On GitHub, branches with an open pull request show its number, with a dot for its checks (green passed, red failed, amber running); click it to open the pull request. On GitLab, branches with an open merge request show it the same way, like **!12**, with a dot for its latest pipeline. For private GitLab projects, Tributary uses the token git keeps for your GitLab server (a personal access token that can read the API). For private repositories, sign in to GitHub in Settings with a personal access token (or in the browser, with Git Credential Manager): Tributary checks it with GitHub and hands it to git's own credential helper, so pushing uses it too. Tributary doesn't store it itself.
- **Status bar:** the checked-out branch and how it compares to its upstream, when the repository was last fetched (click to fetch), and the repository's folder (click to show it in Finder or Explorer).
- **Activity log:** every git command Tributary runs, with what git printed, how long it took and whether it worked. Open it from the status bar or with <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>.
- **Reporting a problem:** **Copy Diagnostics…** in the Help menu shows Tributary's version, your system, which git and Git LFS it uses, how the open repository is set up and the last git commands that failed there, so you can read it before you copy it into a report. Passwords and tokens in remote addresses are left out.
- **Keyboard and accessibility:** menus, tabs and the sidebar work with the arrow keys, dialogs keep the keyboard inside them and give it back when they close, every button has a name for screen readers, and animations (the side panels sliding open and closed, windows and menus fading in) stop when your system asks for reduced motion.
- **No git install needed to browse:** history is read directly with [gitoxide](https://github.com/GitoxideLabs/gitoxide). Actions that change the repository (cloning, committing, stashing, branches, tags, merge, rebase, cherry-pick, revert, fetch, pull, push, reset) run your installed git, so they behave exactly like the command line and use the credentials you already set up for it.
- **Open, clone or create:** open a repository, clone one from its address (with progress and **Cancel**), create a new one in a folder, or drop a folder onto the window. For big repositories, the clone dialog can leave Git LFS files to download later, check out only some folders (the contents of the rest aren't downloaded), or download only recent history. The welcome screen lists recent repositories with the branch you were on; pin the ones you use most, or type to find one.
- **Tabs:** open several repositories at once, each in its own tab. Tributary reopens your tabs when it starts, and each tab remembers the selected commit, where you scrolled to and your unfinished commit message. The **+** button opens a new tab with the start screen: open, clone or create a repository, or pick a recent one.
- **Menu bar:** File, View, Repository and Help menus with every command and its shortcut: in the macOS menu bar, and next to the tabs on Windows. On Windows the tab bar is the title bar, with the minimize, maximize and close buttons at its right.
- **Settings:** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>,</kbd> opens the app's settings, grouped in a list on the left: general (submodules, updates), accounts (your GitHub sign-in), background fetching and notifications, large files and Git LFS, and how the commit list looks.
- **Repository settings:** each repository has its own window, from its tab's right-click menu, **Repository Settings…** in the Repository menu, or the command palette: the name and email you commit with in that repository (when it should differ from your usual one, like a work address), its protected branches, and Git LFS: which files it stores with Git LFS (add or remove patterns like `*.psd`; a repository that doesn't use it yet is offered the kinds of big files it has, or common ones) and the space those files take on this computer. The tab's menu can also show the folder, copy its path, and close the tab or the others.
- **Automatic updates:** Tributary checks its GitHub releases now and then, and an **Update** button appears in the tab bar when there's a new version. It shows what changed, then downloads, installs and restarts. Updates are signed, and installed only when the signature matches. (When the GitHub repository is private, it signs in with the GitHub account git already uses on your computer.)
- **Profile pictures (optional):** turn on **Profile pictures** in Settings (or the View menu) to show authors' pictures instead of initials. For a repository on GitHub, Tributary asks GitHub which account each author's email belongs to (signed in, it can ask about every author; otherwise it goes by the latest 100 commits); on GitLab, it asks the GitLab server; otherwise, or when they don't know, it tries Gravatar. It is off by default, because it sends authors' email addresses to GitHub or GitLab (which host the repository anyway) and a hash of them to Gravatar. The pictures are fetched by the app itself, not the page, and kept until you quit.
- **Your layout:** drag the edges of the sidebar, the details panel and the Branch / Tag and Graph columns (double-click to reset). Right-click the column headings to show or hide Author, Date and SHA, and to show exact dates or commit dates instead of "3 hours ago". The View menu has compact rows and zoom. All of it is remembered. On macOS the toolbar sits in the title bar, next to the window buttons.

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
| `src-tauri/src/github/` | Open pull requests and their checks; signing in |
| `src-tauri/src/gitlab.rs` | Open merge requests on GitLab and their pipelines |
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
| `src/styles.css` | The dark theme |
| `tools/preview/` | The browser preview, demo repositories and the smoke test |

The app icons are generated from `src-tauri/icons/app-icon.svg`. Tauri's own SVG renderer shows the background's gradient in visible bands, so render the SVG with Chrome first, then generate the icons from that PNG (on macOS):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars --window-size=1024,1024 --default-background-color=00000000 --screenshot="$TMPDIR/app-icon.png" "file://$PWD/src-tauri/icons/app-icon.svg"
```

```bash
npm run tauri icon "$TMPDIR/app-icon.png" && rm -rf src-tauri/icons/android src-tauri/icons/ios
```

The in-app logo (`Logo` in `src/components/Icons.tsx`) is the same drawing without the tile; change both together.

## License

[MIT](LICENSE)

The interface uses [Google Sans](https://fonts.google.com/specimen/Google+Sans) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (for SHAs, branch names, file names and code), both under the [SIL Open Font License 1.1](https://openfontlicense.org), bundled from their `@fontsource-variable` packages.
