# Tributary's Flatpak

The files Flatpak needs to package Tributary, as `io.github.shikoko.tributary` on the GNOME runtime:

- **`io.github.shikoko.tributary.yml`:** the manifest. It's made from the `.deb` the Build workflow's Linux job makes (`input/tributary.deb`).
- **`git`:** hands git to the computer's own.
- **`tributary-flatpak`:** starts Tributary.
- **The desktop entry and the metainfo:** what software centres show.

## Trying it

Every Build run (on `develop`, `main`, or started by hand on a branch) makes `Tributary.flatpak`, in the run's **Artifacts** (as `Tributary-flatpak`). Install it for yourself, and start it:

```bash
flatpak install --user Tributary.flatpak
```

```bash
flatpak run io.github.shikoko.tributary
```

Each Build run also installs it on a fresh Ubuntu (the **Flatpak starts** job), checks that its git is the computer's, and checks that Tributary starts in a virtual display and keeps running. Using it, like opening a repository or committing, is for people on Linux to try.

A Flatpak installed from a file isn't updated. Tributary doesn't offer its own updates in a Flatpak (only the AppImage does), so it's for trying until it's on Flathub.

## The computer's git

Tributary runs git, and opens editors, terminals and diff tools, which a sandbox can't see. Its Flatpak uses the computer's own, so it behaves like the AppImage: git's settings, credentials, SSH keys, hooks and Git LFS are the ones outside the sandbox. That takes two permissions:

- **`--filesystem=host`:** repositories anywhere, at the same paths inside and out, as git runs outside.
- **`--talk-name=org.freedesktop.Flatpak`:** to run those programs on the computer, with `flatpak-spawn --host`:
  - `git` here does it for git;
  - `src-tauri/src/host.rs` does it for editors and terminals, which it looks for in the computer's folders (`/run/host/usr/bin` and the like, in the sandbox).

Tributary's temporary files go in its cache folder (`~/.var/app/io.github.shikoko.tributary/cache/tmp`), not the sandbox's own `/tmp`, so the computer's git can read them: a rebase's to-do, a patch of chosen lines.

Git has to be installed on the computer, as it does for the AppImage.

## On Flathub

Flathub builds its own Flatpak, from a manifest in a repository of its own (`flathub/io.github.shikoko.tributary`). Submitting is done from the maintainer's GitHub account:

1. Fork [flathub/flathub](https://github.com/flathub/flathub), and add a branch from its `new-pr` branch with the manifest. The manifest takes the `.deb` from a release instead of `input/`, as a `type: file` source with the release's `url` and the file's `sha256`. The other files here go beside it.
2. Open a pull request into `new-pr`, and answer the reviewers. They'll ask why it needs `--filesystem=host` and `--talk-name=org.freedesktop.Flatpak`. The reason is above: a git client that uses the computer's git, as IDEs on Flathub do.
3. Once it's accepted, Flathub makes the `flathub/io.github.shikoko.tributary` repository. Each release then needs the manifest's `url` and `sha256` updated there, and a `<release>` added to the metainfo.

`io.github.shikoko` is verified on Flathub through the GitHub account `shikoko`.
