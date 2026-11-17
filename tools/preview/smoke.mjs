// Clicks through the main parts of Tributary in a real browser, on freshly built demo
// repositories, with the app's own Rust code answering: open a repository, select and
// search commits, check out a branch (with uncommitted changes in the way), undo it,
// fetch, open a second tab, and look at Git LFS locks and big files.
//
//   npm run preview:build && npm run preview:smoke [-- --browser webkit] [--screenshots <folder>]
//
// It runs in Chromium, or with --browser webkit in WebKit, Safari's engine, which the Mac
// app's window uses. Needs Playwright with that browser, and axe-core (`npm install --no-save
// playwright axe-core` and `npx playwright install chromium`, or webkit, if they aren't
// installed already).
//
// The steps are in smoke/steps, a file for each area of the app. Each file runs in a browser
// of its own on fresh demo repositories, several at once, and one that fails is run once more
// to tell a flaky step from a broken one (smoke/run.mjs). `-- --only history,tabs` runs some
// of them, and `-- --workers 1` one at a time.

import "./smoke/run.mjs";
