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

The pictures in this README are taken the same way, from the demos. After changing the interface, take them again (into `docs/images`):

```bash
npm run preview:screenshots
```

## Build installers for your platform

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/`.

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

The tests don't run on GitHub Actions, so run them before you build.

## Branches

- **`develop`** is where work comes together. Make a branch from it for each change, and open pull requests into it.
- **`main`** is what's been released. It only changes through a pull request from `develop`, when a release is made.

Merge every pull request with **Create a merge commit**, never squash or rebase. Those copy the commits instead: a branch merged that way looks unmerged in the graph, and between `develop` and `main` the two would drift apart, so the next release's pull request would show old changes again.

Before merging a pull request into `develop`, rebase its branch onto the latest `develop` and push it (with `--force-with-lease`). The branch then starts from the tip of `develop`, and the history shows each change as a short loop that joins straight back in. Pull requests from `develop` into `main` aren't rebased.

## Release

The installers are built by GitHub Actions, only when you start a build: open the **Actions** tab, choose **Build**, then **Run workflow**. When it finishes, download the installers from the **Artifacts** section of the run:

- **macOS:** `.dmg` with a universal app (Apple Silicon and Intel)
- **Windows:** `.msi` and `-setup.exe` installers (64-bit)

A build without a version tag can run on any branch, to try the installers out. It isn't signed for updates, so it installs by hand but isn't offered as an update.

To publish a release:

1. Write the release notes in `docs/release-notes/<tag>.md` (like `v0.2.0.md`), in a pull request into `develop` as usual. They become the release page's notes, and the update window shows them up to the `<!-- release page only -->` comment (put install steps and the like after it). Without a file, the release gets GitHub's list of merged pull requests instead.
2. Open a pull request from `develop` into `main`, and merge it with **Create a merge commit**.
3. In **Actions → Build → Run workflow**, choose `main` under **Use workflow from**, and type a version tag such as `v0.2.0` in the **release** box. The app gets that version.
4. The build waits for approval, because the signing key is in the protected `release` environment: open the run, choose **Review deployments**, tick **release** and approve.
5. When it finishes, a draft GitHub release with the installers attached is waiting on the **Releases** page. Publish it, and Tributary offers the update to everyone running an older version.

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
