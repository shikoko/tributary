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
as Maya Chen, so screenshots don't show your name. While it works on the demos, git also
reads a stand-in global config (Maya Chen, with Git LFS set up) instead of yours.

To use your own repositories instead, run `npm run preview` and paste any path. That runs
git as you, with your settings, just like the app.

## Screenshots

```bash
npm run preview:screenshots
```

Takes the README's pictures (`docs/images`) from fresh demo repositories, at twice the
size for sharp screens: each one sets up its scene (a merge conflict, a bisect, a pull
request, …) and captures it. `-- --only blame,bisect` takes just those, and a folder after
`--` saves them somewhere else. The README's opening image (`hero.png`) and the social preview
(`social-preview.png`) are made from the overview with `hero.html`, whenever the overview is
taken (or with `--only hero`).

## What's new, moving

```bash
npm run preview:clips -- v0.6.0
```

Records each new thing in a version working, for What's New and the release page: every
scene in `clips/v0.6.0.mjs` is played on a fresh demo repository, with a pointer drawn where
the mouse is, and saved as an animated WebP in `docs/release-notes/v0.6.0/`. A scene says
which part of the window to show (16:10, like 720 by 450) and what happens in it, and ends
where it started, as they loop. `-- v0.6.0 --only <name>` records just that one. Put each
under its item in the notes, as `![what it shows](v0.6.0/<name>.webp)` on its own indented
line; `src/lib/whatsNew.test.ts` fails if a new thing has none, or one is over 400 KB. See
`clips/v0.5.0.mjs` for the first ones.

## Smoke test

```bash
npm run preview:smoke
```

Builds fresh demo repositories and clicks through the main parts of the app in Chromium:
opening a repository, selecting and searching commits, checking out a branch (and
stashing changes in the way), undo, fetching, tabs, Git LFS locks, the big-file warning,
pull request badges, cloning without Git LFS files and downloading them, worktrees,
keyboard menus, GitHub sign-in (faked) and diagnostics. Add `-- --screenshots <folder>` to keep a screenshot of each
step. On the main screens, in both themes, it also checks with axe-core that what's shown meets WCAG 2.1's level A
and AA criteria that can be checked automatically: names for controls, a structure screen readers can follow, and
text that contrasts enough with what's behind it. It needs Playwright with Chromium, and axe-core:

```bash
npm install --no-save playwright axe-core && npx playwright install chromium
```

`-- --browser webkit` runs it in WebKit instead, Safari's engine, which draws the Mac app's window
(`npx playwright install webkit` first); the checks run it that way on a Mac. On a Mac, the page is told
it's on Linux: Tributary's menus are in the Mac's own menu bar there, which a page in a browser hasn't got,
and the steps open them from the window's.

## Scripting the fakes

A test can set `window.__PREVIEW__` before the page loads (Playwright's `addInitScript`):
`pick` is what the file picker returns, `pullRequests` replaces GitHub's answer,
`update` offers an update, and `github` (like `{ account: null }`) stands in for the GitHub
sign-in, so git's real credential helper isn't touched. Afterwards, `opened` and `notified` list the links opened and
the notifications sent.

## Safety

The preview server only listens on 127.0.0.1, only answers requests addressed to
localhost, and only takes commands from its own page. Other websites open in the same
browser can't send it any.
