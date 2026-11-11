import type { Diagnostics, LogEntry } from "../api";

/** `https://user:token@host/path` → `https://host/path`, wherever it appears in `text`. */
export function withoutCredentials(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, (match, scheme: string) =>
    scheme.toLowerCase() === "ssh://" ? match : scheme,
  );
}

/** How many failed git commands to include. */
const FAILURES = 5;

/**
 * The text to paste into a bug report: versions, the platform, how the open repository
 * is set up, and the last few git commands that failed there.
 */
export function formatDiagnostics(info: Diagnostics, activity: LogEntry[], extra: Record<string, string> = {}): string {
  const lines = [
    `Tributary ${info.version}`,
    `Platform: ${info.platform}`,
    `Git: ${info.git}${info.gitPath ? ` (${info.gitPath})` : ""}`,
    `Git LFS: ${info.gitLfs ?? "not installed"}`,
    ...Object.entries(extra).map(([key, value]) => `${key}: ${value}`),
  ];
  const repo = info.repository;
  if (repo) {
    lines.push("", `Repository: ${repo.path}`);
    if (repo.error) lines.push(`  Couldn't be read: ${repo.error}`);
    else {
      lines.push(`  HEAD: ${repo.head}`);
      for (const remote of repo.remotes) lines.push(`  Remote: ${remote}`);
      const setup = [repo.shallow && "shallow", repo.sparse && "sparse checkout", repo.partial && "partial clone"].filter(Boolean);
      if (setup.length) lines.push(`  Clone: ${setup.join(", ")}`);
      if (repo.operation) lines.push(`  In progress: ${repo.operation}`);
      if (repo.lfs) {
        const lfs = repo.lfs;
        const state = lfs.notInstalled
          ? "used, but not installed"
          : lfs.notSetUp
            ? "installed, but not set up"
            : lfs.pointers > 0
              ? `${lfs.pointers} file${lfs.pointers === 1 ? "" : "s"} not downloaded`
              : "fine";
        lines.push(`  Git LFS: ${state}`);
      }
    }
  }
  const problems = info.problems;
  if (problems.recent.length) {
    lines.push("", "Problems noted in the window:");
    for (const line of problems.recent) lines.push(`  ${line}`);
  }
  if (problems.crashReports.length) {
    const count = problems.crashReports.length;
    lines.push("", `Crash reports saved: ${count} (to send them, attach the files in ${problems.folder}/crashes)`);
    for (const name of problems.crashReports) lines.push(`  ${name}`);
  }
  const failures = activity.filter((entry) => !entry.success && (!repo || entry.folder === repo.path)).slice(-FAILURES);
  if (failures.length) {
    lines.push("", "Recent failed git commands:");
    for (const entry of failures) {
      lines.push(`  ${new Date(entry.started).toISOString()}  git ${entry.args.join(" ")}`);
      const output = entry.output.trim().split("\n").slice(0, 6);
      for (const line of output) lines.push(`    ${line}`);
    }
  }
  return withoutCredentials(lines.join("\n"));
}
