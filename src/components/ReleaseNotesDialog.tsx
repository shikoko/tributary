import { useEffect, useState } from "react";
import { publishRelease, releaseNotes, type ReleaseNotes } from "../api";
import { copyText } from "../lib/clipboard";
import { plural } from "../lib/format";
import { issueKeys, issueUrl, useIssueTracker } from "../lib/issues";
import { releaseMarkdown } from "../lib/releaseNotes";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

/**
 * Release notes for a tag: the changes since an earlier tag (pull requests by title, and
 * commits made on the main line), the issues they mention and who made them, as Markdown
 * to edit, copy, or publish as a release on GitHub or GitLab.
 */
export function ReleaseNotesDialog({
  repoPath,
  tag,
  site,
  onClose,
  notify,
  openUrl,
}: {
  repoPath: string;
  tag: string;
  /** "GitHub" or "GitLab" when the repository is on one (to publish there), or null. */
  site: string | null;
  onClose: () => void;
  notify: (text: string) => void;
  openUrl: (url: string) => void;
}) {
  const { tracker, remote } = useIssueTracker();
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [from, setFrom] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);
    releaseNotes(repoPath, tag, from)
      .then((found) => {
        if (!current) return;
        setNotes(found);
        // Issue keys like FEAST-12 (pull request numbers are already there).
        const own = tracker && (tracker.kind === "jira" || tracker.kind === "linear") ? tracker : null;
        const keys = own ? [...new Set(found.items.flatMap((item) => issueKeys(`${item.title}\n${item.body}`, own)))] : [];
        setText(releaseMarkdown(found, keys.map((key) => ({ key, url: own ? issueUrl(key, own, remote) : null }))));
      })
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, tag, from, tracker, remote]);

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const url = await publishRelease(repoPath, tag, tag, text);
      setPublished(url || null);
      notify(`Published ${tag} on ${site}`);
    } catch (e) {
      setError(String(e));
    }
    setPublishing(false);
  };

  return (
    <Dialog
      title={`Release notes for ${tag}`}
      error={error}
      busy={publishing}
      wide
      onCancel={onClose}
      buttons={
        <>
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
          <span className="spacer" />
          <Button
            kind="outline"
            disabled={!notes}
            onClick={() => {
              void copyText(text);
              notify("Copied the release notes");
            }}
          >
            <span className="button-label">Copy as Markdown</span>
          </Button>
          {site &&
            (published ? (
              <Button kind="primary" onClick={() => openUrl(published)} data-url={published}>
                Open on {site}
              </Button>
            ) : (
              <Button kind="primary" disabled={!notes || publishing} onClick={() => void publish()} title={`Publish ${tag} as a release on ${site} (push the tag first)`}>
                {publishing ? "Publishing…" : `Publish on ${site}`}
              </Button>
            ))}
        </>
      }
    >
      {!notes ? (
        !error && <p className="muted">Reading the history…</p>
      ) : (
        <div className="dialog-form">
          <div className="release-range">
            <span>Since</span>
            <select
              className="text-input mono"
              value={from === undefined ? (notes.from ?? "") : (from ?? "")}
              onChange={(event) => setFrom(event.target.value || null)}
              aria-label="Since"
            >
              {notes.earlier.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="">the first commit</option>
            </select>
            <span className="muted">
              {plural(notes.items.length, "change")} from {plural(notes.commits, "commit")}
            </span>
          </div>
          <textarea className="text-input mono release-text" rows={14} value={text} onChange={(event) => setText(event.target.value)} spellCheck />
        </div>
      )}
    </Dialog>
  );
}
