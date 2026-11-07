# Tributary

A fast, cross-platform git history graph viewer for macOS and Windows.

![Tributary showing the commit graph of a repository, with the details of a merge commit on the right](docs/screenshot.png)

Open a repository and Tributary draws its history as a colourful commit graph, with branches and tags labelled. Click a commit to see its details. You can also commit, stash, manage branches, merge, rebase, cherry-pick, fetch, pull and push. It never changes the repository unless you ask it to.

## Features

- **Commit graph:** each lane has its own colour, merges are drawn as rounded connecting lines, and local branches, remote branches and tags are labelled.
- **Uncommitted changes and stashes:** a row at the top shows your uncommitted changes, and each stash appears as a small box joined to the commit it was made from.
- **Stage and commit:** click the uncommitted changes row to stage or unstage files and write a commit message. You can also amend the last commit.
- **Stashes:** stash your changes from the uncommitted changes row, and apply, pop or drop a stash by right-clicking it. When uncommitted changes stop a pull or checkout, **Stash changes and retry** stashes them, tries again, and puts them back.
- **Always up to date:** changes made in a terminal or editor show up as soon as you switch back to Tributary.
- **Commit details:** the full message, author and committer, parents (click one to jump to it) and the list of changed files.
- **Search:** find commits by message, author, branch, tag or SHA. Matches are highlighted and you can jump between them.
- **Branches:** right-click a commit to check out a branch on it, check out a remote branch (which creates a local branch that tracks it), check out the commit itself, or create a new branch there. Double-click a branch label to check it out, or right-click it to rename or delete it, locally or on the remote.
- **Branch sidebar:** every branch, remote branch, tag and stash, with a filter. Each branch shows how many commits it is ahead of (↑) and behind (↓) its upstream. Click one to jump to its commit; double-click a branch to check it out.
- **Merge and rebase:** drag a branch label (from the graph or the sidebar) onto another commit or branch, then choose **Merge** or **Rebase**. You can also right-click a branch or commit. Both act on the checked-out branch. If git stops because of conflicts, a bar at the top shows how many files conflict, with **Continue** (or **Commit merge**), **Skip commit** and **Abort**. The commit message is filled in for you.
- **Cherry-pick and revert:** right-click a commit to copy it onto the checked-out branch, or to add a commit that undoes it.
- **Highlight a branch's history:** <kbd>Alt</kbd>+click a branch label (or right-click it and choose **Highlight**) to fade every commit that isn't part of its history. Press <kbd>Esc</kbd> to stop.
- **Only this branch:** in the View menu, **Only *branch*'s own history** hides merged-in side branches and shows just the commits made on the checked-out branch, following first parents.
- **Hover previews:** rest the mouse on a commit for a moment to see its full message and changed files without opening it. You can turn this off in the View menu.
- **Command palette:** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> lists the commands and branches, so you can check out, merge, highlight or run almost anything by typing a few letters. Press <kbd>?</kbd> to see all keyboard shortcuts.
- **Undo:** after a checkout, commit, merge, rebase, cherry-pick, revert, hard reset, rename or branch deletion, the confirmation message has an **Undo** button.
- **Fetch, pull and push:** buttons in the toolbar, with the number of commits to pull and to push. A progress bar shows how far along they are, with a **Cancel** button. Tributary also fetches by itself every 5 minutes, so the numbers stay current (you can turn this off in the View menu). The first push of a new branch sets its upstream. When a pull needs a merge and you haven't told git whether to merge or rebase, it merges.
- **Force push:** from the menu next to Push, after a confirmation. It uses `--force-with-lease`, so it stops if someone else pushed in the meantime.
- **Hard reset:** right-click a commit (or use the button in its details) to hard reset the checked-out branch to it. A confirmation shows exactly what will be lost first.
- **Large repositories:** the 10,000 most recent commits load at once, and a button at the end of the list loads more. Only the visible rows are drawn, so scrolling stays smooth.
- **No git install needed to browse:** history is read directly with [gitoxide](https://github.com/GitoxideLabs/gitoxide). Actions that change the repository (committing, stashing, branches, merge, rebase, cherry-pick, revert, fetch, pull, push, reset) run your installed git, so they behave exactly like the command line and use the credentials you already set up for it.
- **Tabs:** open several repositories at once, each in its own tab. Tributary reopens your tabs when it starts, and each tab remembers the selected commit, where you scrolled to and your unfinished commit message. The **+** button opens another repository or a recent one.
- **Profile pictures (optional):** turn on **Profile pictures** in the View menu to show authors' Gravatar or GitHub pictures instead of initials. It is off by default, because it sends a hash of each author's email address to Gravatar (or the GitHub username, for GitHub `noreply` addresses).
- **Your layout:** drag the edges of the sidebar, the details panel and the Branch / Tag and Graph columns (double-click to reset). The View menu has compact rows and zoom. All of it is remembered. On macOS the toolbar sits in the title bar, next to the window buttons.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> | Command palette |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>O</kbd> or <kbd>T</kbd> | Open a repository in a new tab |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>W</kbd> | Close the tab |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>1</kbd> … <kbd>9</kbd>, <kbd>Ctrl</kbd> + <kbd>Tab</kbd> | Switch tabs |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>R</kbd> or <kbd>F5</kbd> | Refresh |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>F</kbd> | Search; <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> for the next / previous match |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>B</kbd> | Show or hide the branch sidebar |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Commit, in the commit message box |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd> | Zoom in, zoom out, actual size |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Page Up</kbd> <kbd>Page Down</kbd> <kbd>Home</kbd> <kbd>End</kbd> | Move through commits |
| <kbd>Alt</kbd> + click a branch label | Highlight the branch's history |
| <kbd>Esc</kbd> | Stop highlighting, then close the details panel |
| <kbd>?</kbd> | Show the keyboard shortcuts |

## Download

The installers are built by GitHub Actions, only when you start a build: open the **Actions** tab, choose **Build**, then **Run workflow**. When it finishes, download the installers from the **Artifacts** section of the run:

- **macOS:** `.dmg` with a universal app (Apple Silicon and Intel)
- **Windows:** `.msi` and `-setup.exe` installers (64-bit)

To publish a release, type a version tag such as `v0.2.0` in the **release** box before starting the build. A draft GitHub release with the installers attached is created when it finishes. Update `version` in `src-tauri/tauri.conf.json` and `package.json` first, so the installer names match.

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

### Build installers for your platform

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/`.

### Test

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The integration tests create small repositories with the `git` command, so git needs to be installed to run them. The tests don't run on GitHub Actions, so run them before you build.

### Project layout

| Path | What it does |
| --- | --- |
| `src-tauri/src/repo.rs` | Reads commits, branches, tags and changed files with gix |
| `src-tauri/src/graph.rs` | Gives each commit a lane and works out the lines to draw in each row |
| `src-tauri/src/lib.rs` | The commands the frontend calls |
| `src-tauri/src/actions.rs` | Runs git for everything that changes the repository, with progress and cancel |
| `src/components/CommitList.tsx` | The commit list, which only renders the rows on screen |
| `src/components/graphPainter.ts` | Draws the graph for the visible rows on a canvas |
| `src/components/CommitDetails.tsx` | The details panel |
| `src/styles.css` | The dark theme |

The app icons are generated from `src-tauri/icons/app-icon.svg`. After changing it, run `npm run tauri icon src-tauri/icons/app-icon.svg` and delete the `android` and `ios` folders it creates.

## License

[MIT](LICENSE)
