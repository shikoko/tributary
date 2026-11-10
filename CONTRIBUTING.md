# Contributing to Tributary

Thanks for helping. Bug reports, ideas and fixes are all welcome.

- [Reporting a bug](#reporting-a-bug)
- [Suggesting an idea](#suggesting-an-idea)
- [Making a change](#making-a-change)
- [Checks to run](#checks-to-run)
- [Style](#style)

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md). If you've found a security problem, please don't open an issue: [SECURITY.md](SECURITY.md) says how to report it privately.

## Reporting a bug

[Open an issue](https://github.com/shikoko/tributary/issues/new/choose) with the bug template. The most useful thing to include is the app's diagnostics: **Help → Copy Diagnostics…** shows the versions of Tributary, git and Git LFS, your system, how the open repository is set up, and the last git commands that failed. Read it before pasting it: passwords and tokens are left out, but it includes the repository's folder and its remote addresses.

## Suggesting an idea

Open an issue with the idea template, and say what you were trying to do, not only the feature you'd like. That often leads to a better answer than the first idea.

For anything big, please open an issue before writing the code, so we can agree on the approach first.

## Making a change

1. Fork the repository and make a branch from **`develop`**. `main` only holds what's been released.
2. Set up the tools and run the app: [docs/development.md](docs/development.md) has the prerequisites, how to run it, and how to try the interface in a browser without building the app.
3. Make your change. Keep each pull request to one thing, so it's easy to review.
4. Run the [checks](#checks-to-run).
5. Open a pull request into **`develop`**, saying what it changes and why, with a screenshot for anything you can see.

The project has no tests or builds that run automatically on pull requests, so please run the checks yourself before you open one.

## Checks to run

From the repository's folder:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

```bash
npx tsc --noEmit -p .
```

```bash
npm test
```

```bash
npm run lint
```

For changes to the interface, also run the smoke test, which clicks through the app in a browser on demo repositories (it needs Playwright, see [tools/preview](tools/preview/README.md)):

```bash
npm run preview:smoke
```

The end-to-end tests drive the real desktop app. They're slower and need a WebDriver; [docs/development.md](docs/development.md#test) explains how to run them.

## Style

- **Words in the app** are plain and friendly: say what happens, in the terms someone who doesn't know git internals would use. Errors say what went wrong and what to do about it.
- **Demo and test data** use made-up people with `@example.com` addresses, never real names or addresses.
- **Code** follows what's already there: Rust is formatted with `cargo fmt` and passes `cargo clippy`; TypeScript passes `npm run lint`. Comments say why, not what.
- **Changes git makes** go through the user's own `git` command, so they behave exactly as on the command line, and they come with Undo wherever that's possible.
- **Nothing is sent anywhere** that the user hasn't set up. If a change talks to a new service, update [PRIVACY.md](PRIVACY.md).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), like the rest of the project.
