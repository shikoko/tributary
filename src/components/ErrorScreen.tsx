import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { diagnostics } from "../api";
import { bugReportUrl, type ReportSystem } from "../lib/bugReport";
import { copyText } from "../lib/clipboard";
import { formatDiagnostics } from "../lib/diagnostics";
import { isMac, isWindows } from "../lib/platform";
import { describeProblem, keepProblem } from "../lib/problems";
import { openInBrowser } from "../lib/weblinks";

/** The bug report form's System for this computer. */
export const thisSystem = (): ReportSystem => (isMac ? "macOS" : isWindows ? "Windows" : "Linux (built from source)");

/**
 * Opens a new bug report on GitHub with the error and the diagnostics filled in, to read,
 * change and send there.
 */
async function reportOnGitHub(problem: string) {
  const [headline] = problem.split("\n");
  const info = await diagnostics(null).catch(() => null);
  openInBrowser(
    bugReportUrl({
      title: `The window stopped: ${headline}`,
      what: `An error stopped the window:\n\n\`\`\`\n${problem}\n\`\`\``,
      diagnostics: info ? formatDiagnostics(info, []) : undefined,
      system: thisSystem(),
    }),
  );
}

interface State {
  /** What stopped the interface, as text for the log and for a report. */
  problem: string | null;
  /** The problems log, once it's been written to. */
  log: string | null;
}

/**
 * Catches an error that stops the interface, which would otherwise leave the window
 * empty: it's kept in the problems log and shown, with a way to load the window again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { problem: null, log: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { problem: describeProblem(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const problem = describeProblem(error, info.componentStack);
    this.setState({ problem });
    void keepProblem(`stopped the window: ${problem}`).then((log) => this.setState({ log }));
  }

  render() {
    if (this.state.problem === null) return this.props.children;
    return <ErrorScreen problem={this.state.problem} log={this.state.log} />;
  }
}

/** What's shown instead of the interface when an error stopped it. */
export function ErrorScreen({ problem, log }: { problem: string; log: string | null }) {
  const [copied, setCopied] = useState(false);
  const [headline] = problem.split("\n");
  const copy = async () => {
    await copyText(`Tributary stopped with an error:\n\n${problem}`);
    setCopied(true);
  };
  return (
    <div className="error-screen" role="alert">
      <div className="error-screen-card">
        <h1>Something went wrong</h1>
        <p>An error stopped the window. Your repositories and changes aren't affected: load the window again to carry on.</p>
        <pre className="error-screen-details" tabIndex={0}>
          {headline}
        </pre>
        <p className="error-screen-note">
          {log ? "It's been saved with the problem reports. " : ""}
          Report on GitHub opens a bug report with it filled in, for you to read and send.
        </p>
        <div className="error-screen-buttons">
          {log && (
            <button className="secondary-button" onClick={() => void revealItemInDir(log).catch(() => {})}>
              Show Problem Reports
            </button>
          )}
          <button className="secondary-button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy Details"}
          </button>
          <button className="secondary-button" onClick={() => void reportOnGitHub(problem)} title="A new bug report on GitHub, filled in, to read and send there">
            Report on GitHub
          </button>
          <button className="primary-small-button" onClick={() => window.location.reload()} autoFocus>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
