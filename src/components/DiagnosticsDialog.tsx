import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { activityLog, diagnostics } from "../api";
import { copyText } from "../lib/clipboard";
import { bugReportUrl } from "../lib/bugReport";
import { formatDiagnostics } from "../lib/diagnostics";
import { openInBrowser } from "../lib/weblinks";
import { thisSystem } from "./ErrorScreen";
import { Dialog } from "./Dialog";

interface Props {
  /** The open repository, if any. */
  repoPath: string | null;
  /** More lines to include, like the zoom level. */
  extra?: Record<string, string>;
  onCopied: () => void;
  onClose: () => void;
}

/** Shows what would go into a bug report, so it can be read before it's copied. */
export function DiagnosticsDialog({ repoPath, extra, onCopied, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The folder with the problems log and the saved crash reports, when there are some. */
  const [reports, setReports] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([diagnostics(repoPath), activityLog().catch(() => [])])
      .then(([info, activity]) => {
        if (!live) return;
        setText(formatDiagnostics(info, activity, extra));
        const { folder, recent, crashReports } = info.problems;
        setReports(folder && (recent.length || crashReports.length) ? folder : null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // `extra` is read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  const copy = async () => {
    if (text === null) return;
    await copyText(text);
    onCopied();
  };

  return (
    <Dialog
      title="Diagnostics"
      error={error}
      wide
      onCancel={onClose}
      buttons={
        <>
          <span className="dialog-note">Passwords and tokens in addresses are left out.</span>
          {reports && (
            <button className="secondary-button" onClick={() => void revealItemInDir(reports).catch((e) => setError(String(e)))}>
              Show Problem Reports
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => text !== null && openInBrowser(bugReportUrl({ diagnostics: text, system: thisSystem() }))}
            disabled={text === null}
            title="A new bug report on GitHub, with this filled in, to read and send there"
          >
            Report on GitHub
          </button>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button className="primary-small-button" onClick={copy} disabled={text === null} autoFocus>
            Copy
          </button>
        </>
      }
    >
      <p>To report a problem, copy this into the report. It's everything below, nothing more.</p>
      <pre className="diagnostics-text" tabIndex={0}>
        {text ?? "Gathering…"}
      </pre>
    </Dialog>
  );
}
