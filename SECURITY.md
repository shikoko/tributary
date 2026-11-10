# Security

## Reporting a problem

Please don't report security problems in a public issue. Report them privately instead:

1. Open the repository's [**Security** tab](https://github.com/shikoko/tributary/security).
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what someone could do with it.

Only the maintainer sees the report, and the aim is to reply within a week. Once it's fixed, you'll be credited in the release notes and the advisory, unless you'd rather not be.

## Supported versions

Fixes go into the latest release, which Tributary installs by itself. Older versions aren't patched, so please check that a problem still happens in the latest one.

## What counts

Things we'd especially like to hear about:

- **Updates:** anything that could make Tributary install an update that isn't signed with the project's key.
- **Tokens and passwords:** anything that could send them somewhere other than the service they're for, or show them in the activity log, diagnostics or error messages.
- **Repositories you don't trust:** a repository whose contents (its files, configuration, hooks, submodules or Git LFS files) make Tributary run something, read or write files outside it, or send data somewhere, beyond what git itself would do with the same repository.
- **The app's window:** a way for repository content (commit messages, file names, diffs, pictures) to run script in the app.

Git runs a repository's hooks and follows its configuration, and that isn't something Tributary changes. Problems in git or Git LFS themselves belong with those projects.
