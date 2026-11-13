## Before releasing

Merging this releases the version that **Ready to release** names. That check stays red until every box below is ticked, and runs again whenever this description is edited. Tick a box only once it's done, and say how on a line under it when that isn't obvious.

### Checked by whoever prepares the release

- [ ] **Version:** the version Ready to release names is the one meant. The biggest label since the last release decides it (see `docs/development.md`).
- [ ] **Notes:** `docs/release-notes/v<version>.md` covers every pull request merged since the last release, in words someone using Tributary follows, and its first line says what the release is about.
- [ ] **Recordings:** each new thing's recording shows it working, and ends the way it starts.
- [ ] **What's New:** seen as this version shows it after updating from the last one, in the light and the dark theme. Every page reads well, the recordings play, and the window keeps its size.
- [ ] **Update notes and release page:** the update window's notes stop before Installing and have no pictures, and the release page links the pictures (`release-notes.mjs` and `latest-json.mjs`, run on the notes).
- [ ] **Latest beta:** develop's latest Build run passed on macOS and Windows, and published its beta.

### Checked on real computers by the maintainer

- [ ] **Windows:** the latest beta (About Tributary → Get beta versions), at the display scales you use, like 100% and 150%. Open a repository, try what's new, and look over what changed for anything out of line.
- [ ] **macOS:** the same, on a Mac.
- [ ] **Desktop end-to-end tests:** `npm run e2e` passes on a computer. They don't run on GitHub.

After the merge, the release build checks what it published by itself: the latest release, its update file's platforms and downloads, and the release page's pictures.
