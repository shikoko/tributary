# Development

Tributary is a [Tauri 2](https://tauri.app) app: a Rust backend reads the repository and runs git, and a React + TypeScript frontend draws it.

- [Prerequisites](#prerequisites)
- [Run it](#run-it)
- [Try it in a browser](#try-it-in-a-browser)
- [Build installers for your platform](#build-installers-for-your-platform)
- [Test](#test)
- [Branches](#branches)
- [Release](#release)
- [Project layout](#project-layout)

## Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) (stable)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++". WebView2 comes with Windows 10 and 11.
- **Linux** (experimental): WebKitGTK and the other packages listed for your distribution in Tauri's guide.

The [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) has more detail.

## Run it

```bash
npm install
```

```bash
npm run tauri dev
```

## Try it in a browser

The interface runs in an ordinary browser too, against real repositories, with the app's own Rust code answering it (`tools/preview`). That's quicker for working on the interface, and it's how the screenshots are made:

```bash
npm run preview:build
```

```bash
npm run preview:demo
```

That builds demo repositories with made-up people and history and serves the app on <http://127.0.0.1:4173>; choose **Open repository** and paste a path it printed. `npm run preview` does the same for your own repositories. See [tools/preview](../tools/preview/README.md).

The pictures in this README are taken the same way, from the demos. After changing the interface, take them again (into `docs/images`). The README's opening image and the repository's social preview (`social-preview.png`, uploaded in its settings) are made from the overview with `tools/preview/hero.html`:

```bash
npm run preview:screenshots
```

## Build installers for your platform

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/`.

On Windows, the release build also wraps the NSIS installers in Tributary's own setup (`src-tauri/setup/`): a small window in the app's style, with the terms of use (`TERMS.txt`), just for you or for everyone, and the folder, that runs the right installer silently. The automatic updates run it too. It carries two installers, named when it's built: `TRIBUTARY_INSTALLER` (just for you) and `TRIBUTARY_INSTALLER_ALL` (for everyone, `installMode: "perMachine"`). Built without them, it's the uninstall window: the release build installs it with the app as `tributary-uninstall.exe`, and `src-tauri/windows/hooks.nsh` points the uninstall entry to it (it runs `uninstall.exe` silently; `QuietUninstallString` stays `uninstall.exe /S`). To work on its window, build the page and run it (it opens, but has nothing to install without them):

```bash
npm run setup:build
cargo run --manifest-path src-tauri/Cargo.toml -p tributary-setup
```

## Test

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

A smoke test clicks through the main parts of the app in Chromium, on fresh demo repositories (it needs Playwright, see [tools/preview](../tools/preview/README.md)):

```bash
npm run preview:smoke
```

End-to-end tests drive the real desktop app (its backend, its permissions and its window, not the browser preview) through WebDriver, on fresh demo repositories with a temporary home folder, so your own settings aren't touched. They run on Linux and Windows (macOS has no WebDriver for the app's web view), and need [tauri-driver](https://v2.tauri.app/develop/tests/webdriver/) and the platform's WebDriver, once:

```bash
cargo install tauri-driver --locked
```

On Debian and Ubuntu, also the WebKit WebDriver (and `xvfb-run` from the `xvfb` package, to run them without a screen):

```bash
sudo apt install webkit2gtk-driver xvfb
```

On Windows, `msedgedriver.exe` matching your Edge's version, on the `PATH`. Then:

```bash
npm run e2e
```

That builds the app first; `npm run e2e -- --no-build` tests the one already built. When a step fails, a screenshot of the window goes into `tools/e2e/output/`.

These desktop tests don't run on GitHub Actions, so run them before you build.

## Branches

- **`develop`** is where work comes together. Make a branch from it for each change, and open pull requests into it.
- **`main`** is what's been released. It only changes through a pull request from `develop`, when a release is made.

Merge every pull request with **Create a merge commit**, never squash or rebase. Those copy the commits instead: a branch merged that way looks unmerged in the graph, and between `develop` and `main` the two would drift apart, so the next release's pull request would show old changes again.

Before merging a pull request into `develop`, rebase its branch onto the latest `develop` and push it (with `--force-with-lease`). The branch then starts from the tip of `develop`, and the history shows each change as a short loop that joins straight back in. Pull requests from `develop` into `main` aren't rebased.

Every pull request into `develop` or `main` runs the **Checks** workflow (`.github/workflows/checks.yml`): types, lint and unit tests; Rust formatting, clippy and tests on Linux, macOS and Windows; and the smoke test. A pull request that only changes documentation (Markdown, `docs/`, the issue forms, the licence) skips those: its first job, **What changed**, says so. The Linux jobs install their system libraries with retries, as Ubuntu's mirror sometimes can't be reached for a moment. A pull request into `main` also checks that it's ready to release (see below). A ruleset on `develop` and `main` makes the checks required, so a pull request merges only once they pass.

## Release

The **Build** workflow (`.github/workflows/build.yml`) makes the installers:

- **macOS:** `.dmg` with a universal app (Apple Silicon and Intel)
- **Windows:** `-setup.exe`, Tributary's own setup, which the automatic updates run too

It runs on every merge into `develop`, so the latest is always there to try: open the run in the **Actions** tab and download them from its **Artifacts**. To try a branch before it's merged, start a build by hand: **Actions → Build → Run workflow**, and choose the branch. These builds aren't signed for updates, so they install by hand but aren't offered as an update.

Nobody sets the version by hand: it's worked out from the pull requests merged into `develop` since the last release (`.github/scripts/next-version.mjs`). Each pull request into `develop` gets one label for its kind of change, and the **Labels** check asks for it:

| Label | The next release |
| --- | --- |
| `fix` (fixes and other small changes) | 0.2.0 → 0.2.1 |
| `feature` | 0.2.0 → 0.3.0 |
| `breaking` | 0.2.0 → 1.0.0 |

Dependabot's pull requests (`.github/dependabot.yml`: security fixes as they come, and a weekly round of version updates) are labelled `fix` already.

The biggest change since the last release decides, once: two features and a fix after 0.2.0 make 0.3.0. Builds of `develop` are named after the release they lead to and the number of pull requests merged since the last one, like `0.3.0-dev.3`, so About shows which build it is, and a release counts as newer. Before the first release, the version is the one in `package.json`. The version in the other files (`Cargo.toml`, `tauri.conf.json`) is only for builds on your own computer.

A merge into `main` makes a release. To make one:

1. In a pull request into `develop` as usual, write the release's notes in `docs/release-notes/v<version>.md` (like `v0.2.0.md`): the latest build of `develop` shows the version, like `0.3.0-dev.3` for 0.3.0. They become the release page's notes, and the update window shows them up to the `<!-- release page only -->` comment (put install steps and the like after it).
2. Open a pull request from `develop` into `main`. Its checks include **Ready to release**, which says which version merging it releases, and fails if that version's notes aren't there. Merge it with **Create a merge commit**.
3. The merge starts the Build workflow on `main`, which signs the installers with the key in the protected `release` environment (if the environment asks for approval, open the run, choose **Review deployments**, tick **release** and approve).
4. When it finishes, a draft GitHub release of that version, with the installers attached, is waiting on the **Releases** page. Publish it, and Tributary offers the update to everyone running an older version. Publishing tags the release, and the next version counts from there.

If a release build fails, **Re-run failed jobs** on its run, or start **Build** by hand on `main`: a draft of the same version is replaced, and a version that's already been published is never built again.

Tributary finds new versions by reading `latest.json` from the latest release (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`), and installs them only if they're signed with the key whose public half is `plugins.updater.pubkey` there. A fork that publishes its own releases needs to change both.

The private key lives in the `release` environment's secrets, as `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, if it has a password). Without them, builds still work, but they can't be installed as updates. To make a new key pair:

```bash
npm run tauri signer generate -- -w ~/.tauri/tributary.key
```

Then save the private key in the environment:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/tributary.key
```

and put the public key in `tauri.conf.json`. Apps signed with the old key can't install updates signed with a new one, so they need to be reinstalled by hand once.

### Third-party notices

`THIRD_PARTY_NOTICES.txt` lists the licence of every Rust crate and npm package that goes into the app, and is installed with it (Help → Third-Party Licences opens it). The Build workflow makes it afresh before building; to update the copy in the repository after changing dependencies:

```bash
npm run notices
```

## Project layout

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
| `src-tauri/src/problems.rs` | The problems log (the window's errors, WebKit's web content process stopping), loading the window again when it stops, and copies of macOS's crash reports |
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
| `tools/e2e/` | End-to-end tests of the desktop app, through tauri-driver and WebDriver |
| `tools/icons/` | Draws the app icon, light and dark, and renders it at every size |

The app icon comes in a light and a dark version, and the app shows the one that matches its theme while it runs (in the Dock on macOS, on the taskbar elsewhere); the installed app carries the light one. Both are drawn by `tools/icons/draw.py` (into `src-tauri/icons/app-icon.svg` and `app-icon-dark.svg`), then rendered at every size with Chromium, whose gradients come out smooth. The macOS icon keeps Apple's margins around the tile; the Windows and Linux ones fill their square, so they're as big as they can be in a taskbar:

```bash
python3 tools/icons/draw.py
```

```bash
node tools/icons/render.mjs
```

The in-app logo (`Logo` in `src/components/Icons.tsx`) is the same drawing, with or without its tile; change both together.
