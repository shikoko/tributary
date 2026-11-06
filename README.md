# Tributary

A fast, cross-platform git history graph viewer for macOS and Windows.

![Tributary showing the commit graph of a repository, with the details of a merge commit on the right](docs/screenshot.png)

Open a repository and Tributary draws its history as a colourful commit graph, with branches and tags labelled. Click a commit to see its details. It only reads the repository and never changes it.

## Features

- **Commit graph:** each lane has its own colour, merges are drawn as rounded connecting lines, and local branches, remote branches and tags are labelled.
- **Commit details:** the full message, author and committer, parents (click one to jump to it) and the list of changed files.
- **Large repositories:** the 10,000 most recent commits load at once, and a button at the end of the list loads more. Only the visible rows are drawn, so scrolling stays smooth.
- **No git install needed:** history is read directly with [gitoxide](https://github.com/GitoxideLabs/gitoxide).
- **Recent repositories:** the welcome screen lists the repositories you opened before.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>O</kbd> | Open a repository |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>R</kbd> or <kbd>F5</kbd> | Refresh |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Page Up</kbd> <kbd>Page Down</kbd> <kbd>Home</kbd> <kbd>End</kbd> | Move through commits |
| <kbd>Esc</kbd> | Close the details panel |

## Download

GitHub Actions builds the installers on every push to `main`. Download them from the **Artifacts** section of a run on the Actions tab:

- **macOS:** `.dmg` with a universal app (Apple Silicon and Intel)
- **Windows:** `.msi` and `-setup.exe` installers (64-bit)

Pushing a version tag such as `v0.1.0` also creates a draft GitHub release with the installers attached.

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

The integration tests create small repositories with the `git` command, so git needs to be installed to run them.

### Project layout

| Path | What it does |
| --- | --- |
| `src-tauri/src/repo.rs` | Reads commits, branches, tags and changed files with gix |
| `src-tauri/src/graph.rs` | Gives each commit a lane and works out the lines to draw in each row |
| `src-tauri/src/lib.rs` | The commands the frontend calls |
| `src/components/CommitList.tsx` | The commit list, which only renders the rows on screen |
| `src/components/graphPainter.ts` | Draws the graph for the visible rows on a canvas |
| `src/components/CommitDetails.tsx` | The details panel |
| `src/styles.css` | The dark theme |

The app icons are generated from `src-tauri/icons/app-icon.svg`. After changing it, run `npm run tauri icon src-tauri/icons/app-icon.svg` and delete the `android` and `ios` folders it creates.

## License

[MIT](LICENSE)
