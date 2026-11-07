# Browser preview

Runs Tributary in an ordinary browser, against real repositories, without building the
desktop app. The frontend is the real one (`dist/`); its commands are answered by the
app's own Rust code, running headless (`src-tauri/examples/headless.rs`). Only what
needs a desktop is faked (`shim.js`): the file picker asks with a prompt, links open in
a new browser tab, notifications go to the console, and there are no updates.

```bash
npm run preview:build
```

```bash
npm run preview:demo
```

That builds two demo repositories and opens the preview on <http://127.0.0.1:4173>. Choose
**Open repository** and paste a path it printed:

- **notebook**: a small app with feature branches, merges, tags, a stash, uncommitted
  work, and an `origin` that a teammate has pushed to since the last fetch.
- **studio**: a game with lockable assets (the locks come from `lfs-locks.mjs`, a stand-in
  Git LFS server), big files that aren't in Git LFS, a commit lost to a reset, and
  branches with pull requests.

The people in them are made up, and the preview's own commits and stashes in them are made
as Maya Chen, so screenshots don't show your name.

To use your own repositories instead, run `npm run preview` and paste any path. That runs
git as you, with your settings, just like the app.

## Smoke test

```bash
npm run preview:smoke
```

Builds fresh demo repositories and clicks through the main parts of the app in Chromium:
opening a repository, selecting and searching commits, checking out a branch (and
stashing changes in the way), undo, fetching, tabs, Git LFS locks, the big-file warning
and pull request badges. Add `-- --screenshots <folder>` to keep a screenshot of each
step. It needs Playwright with Chromium:

```bash
npm install --no-save playwright && npx playwright install chromium
```

## Scripting the fakes

A test can set `window.__PREVIEW__` before the page loads (Playwright's `addInitScript`):
`pick` is what the file picker returns, `pullRequests` replaces GitHub's answer, and
`update` offers an update. Afterwards, `opened` and `notified` list the links opened and
the notifications sent.

## Safety

The preview server only listens on 127.0.0.1, only answers requests addressed to
localhost, and only takes commands from its own page. Other websites open in the same
browser can't send it any.
