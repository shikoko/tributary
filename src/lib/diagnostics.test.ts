import { describe, expect, it } from "vitest";
import type { Diagnostics, LogEntry } from "../api";
import { formatDiagnostics, withoutCredentials } from "./diagnostics";

const info: Diagnostics = {
  version: "0.2.0",
  platform: "macOS 15.1 (aarch64)",
  git: "git version 2.47.0",
  gitPath: "/usr/bin/git",
  gitLfs: null,
  repository: {
    path: "/work/notebook",
    head: "main",
    remotes: ["origin https://github.com/example/notebook.git"],
    shallow: true,
    sparse: false,
    partial: true,
    operation: null,
    lfs: { notInstalled: false, notSetUp: false, pointers: 3, examples: [] },
    error: null,
  },
  problems: { folder: null, recent: [], crashReports: [] },
};

const entry = (extra: Partial<LogEntry>): LogEntry => ({
  id: 1,
  started: Date.UTC(2026, 10, 7, 12),
  durationMs: 10,
  folder: "/work/notebook",
  args: ["fetch"],
  success: true,
  output: "",
  background: false,
  ...extra,
});

describe("withoutCredentials", () => {
  it("leaves passwords and tokens out of addresses", () => {
    expect(withoutCredentials("fatal: https://maya:ghp_x@github.com/a/b.git not found")).toBe("fatal: https://github.com/a/b.git not found");
    expect(withoutCredentials("ssh://git@example.com/a.git")).toBe("ssh://git@example.com/a.git");
    expect(withoutCredentials("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
  });
});

describe("formatDiagnostics", () => {
  it("describes the app, git and the repository", () => {
    const text = formatDiagnostics(info, [], { Zoom: "100%" });
    expect(text).toContain("Tributary 0.2.0");
    expect(text).toContain("Git LFS: not installed");
    expect(text).toContain("Zoom: 100%");
    expect(text).toContain("  Clone: shallow, partial clone");
    expect(text).toContain("  Git LFS: 3 files not downloaded");
  });

  it("includes the last few failures in this repository, without credentials", () => {
    const failures = [
      entry({ args: ["push", "https://maya:secret@example.com/a.git"], success: false, output: "remote: denied\nfatal: no" }),
      entry({ folder: "/elsewhere", success: false, output: "other" }),
      entry({ args: ["status"] }),
    ];
    const text = formatDiagnostics(info, failures);
    expect(text).toContain("git push https://example.com/a.git");
    expect(text).toContain("    remote: denied");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("other");
    expect(text).not.toContain("git status");
  });

  it("includes the problems noted in the window and the saved crash reports", () => {
    expect(formatDiagnostics(info, [])).not.toContain("Problems");
    const problems = {
      folder: "/Users/maya/Library/Logs/io.github.shikoko.tributary",
      recent: ["2026-11-11 11:30:09 UTC Tributary 0.2.0: the window's web content process stopped (WebKit)"],
      crashReports: ["com.apple.WebKit.WebContent-2026-11-11-113009.ips"],
    };
    const text = formatDiagnostics({ ...info, problems }, []);
    expect(text).toContain("Problems noted in the window:\n  2026-11-11 11:30:09 UTC Tributary 0.2.0: the window's");
    expect(text).toContain("Crash reports saved: 1 (to send them, attach the files in /Users/maya/Library/Logs/io.github.shikoko.tributary/crashes)");
    expect(text).toContain("  com.apple.WebKit.WebContent-2026-11-11-113009.ips");
  });
});
