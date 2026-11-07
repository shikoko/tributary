import { useEffect, useState, type ReactNode } from "react";
import { commitDetails, type CommitDetails, type CommitRow, type FileChange, type Person } from "../api";
import { laneColor, withAlpha } from "../lib/colors";
import { dateInZone, fullDate, plural, shortId, utcOffset } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { Avatar } from "./Avatar";
import { CheckIcon, CloseIcon, CopyIcon } from "./Icons";
import { RefPills } from "./RefPills";

/** Very large commits only list their first files, to keep the panel responsive. */
const MAX_FILES = 1000;

interface Props {
  repoPath: string;
  commit: CommitRow;
  /** Details already loaded this session, by commit id. */
  cache: Map<string, CommitDetails>;
  hasCommit: (id: string) => boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Buttons shown under the commit's details, like "Hard reset main to this commit…". */
  actions: DetailsAction[];
}

export interface DetailsAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

type Loaded = { id: string; details?: CommitDetails; error?: string };

export function CommitDetailsPanel(props: Props) {
  const { repoPath, commit, cache, hasCommit, onSelect, onClose, actions } = props;
  const [loaded, setLoaded] = useState<Loaded>({ id: commit.id, details: cache.get(commit.id) });

  useEffect(() => {
    const cached = cache.get(commit.id);
    if (cached) {
      setLoaded({ id: commit.id, details: cached });
      return;
    }
    setLoaded({ id: commit.id });
    let cancelled = false;
    // A short delay, so holding down an arrow key doesn't load every commit on the way.
    const timer = setTimeout(() => {
      commitDetails(repoPath, commit.id).then(
        (details) => {
          cache.set(commit.id, details);
          if (!cancelled) setLoaded({ id: commit.id, details });
        },
        (error) => {
          if (!cancelled) setLoaded({ id: commit.id, error: String(error) });
        },
      );
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repoPath, commit.id, cache]);

  const current = loaded.id === commit.id ? loaded : { id: commit.id };
  const details = current.details;
  const author: Person = details?.author ?? {
    name: commit.authorName,
    email: commit.authorEmail,
    time: commit.time,
    offset: 0,
  };
  const committer = details?.committer;
  const showCommitter =
    committer &&
    (committer.name !== author.name || committer.email !== author.email || Math.abs(committer.time - author.time) > 60);

  return (
    <aside className="details" aria-label="Commit details">
      <header className="details-header">
        <span className="details-label">{commit.kind === "stash" ? "Stash" : "Commit"}</span>
        <CopyButton text={commit.id} label={shortId(commit.id)} />
        <span className="spacer" />
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close details">
          <CloseIcon />
        </button>
      </header>

      <div className="details-scroll">
        <h2 className="details-summary">{details?.summary ?? commit.summary}</h2>
        {details?.body && <p className="details-body">{details.body}</p>}

        {commit.refs.length > 0 && (
          <div className="details-refs">
            <RefPills refs={commit.refs} color={laneColor(commit.graph.column)} />
          </div>
        )}

        <div className="people">
          <PersonLine role="authored" person={author} exact={Boolean(details)} />
          {showCommitter && <PersonLine role="committed" person={committer} exact />}
        </div>

        <dl className="meta">
          <dt>SHA</dt>
          <dd className="mono selectable full-sha">{commit.id}</dd>
          <dt>{commit.parents.length === 1 ? "Parent" : "Parents"}</dt>
          <dd className="parents">
            {commit.parents.length === 0 && <span className="muted">None (first commit)</span>}
            {commit.parents.map((parent) => (
              <button
                key={parent}
                className="sha-link"
                onClick={() => onSelect(parent)}
                disabled={!hasCommit(parent)}
                title={hasCommit(parent) ? "Go to parent" : "Not loaded"}
              >
                {shortId(parent)}
              </button>
            ))}
          </dd>
        </dl>

        {actions.length > 0 && (
          <div className="details-actions">
            {actions.map((action) => (
              <button
                key={action.label}
                className={action.danger ? "danger-outline-button" : "outline-button"}
                onClick={action.onClick}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}

        <section className="files">
          <h3>
            {details ? plural(details.files.length, "changed file") : "Changed files"}
            {commit.parents.length > 1 && <span className="hint">compared to the first parent</span>}
          </h3>
          {current.error ? (
            <div className="details-error">{current.error}</div>
          ) : !details ? (
            <div className="details-loading">Loading…</div>
          ) : details.files.length === 0 ? (
            <div className="muted">No file changes.</div>
          ) : (
            <ul className="file-list">
              {details.files.slice(0, MAX_FILES).map((file) => (
                <FileLine key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} file={file} />
              ))}
              {details.files.length > MAX_FILES && (
                <li className="muted more-files">and {plural(details.files.length - MAX_FILES, "more file")}</li>
              )}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

function PersonLine({ role, person, exact }: { role: string; person: Person; exact: boolean }) {
  return (
    <div className="person">
      <Avatar name={person.name} email={person.email} size={32} />
      <div className="person-text">
        <div className="person-name">
          <span className="person-full-name" title={person.name}>
            {person.name || "Unknown"}
          </span>
          <span className="person-email" title={person.email}>
            {person.email}
          </span>
        </div>
        <div className="person-when">
          {role} {exact ? `${dateInZone(person.time, person.offset)} (${utcOffset(person.offset)})` : fullDate(person.time)}
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<FileChange["status"], { letter: string; color: string; label: string }> = {
  added: { letter: "A", color: "#36e07c", label: "Added" },
  modified: { letter: "M", color: "#ffad1f", label: "Modified" },
  deleted: { letter: "D", color: "#ff5c6c", label: "Deleted" },
  renamed: { letter: "R", color: "#1fb5ff", label: "Renamed" },
  copied: { letter: "C", color: "#a77bff", label: "Copied" },
  untracked: { letter: "?", color: "#19d7b4", label: "Untracked" },
  conflicted: { letter: "!", color: "#ff5c6c", label: "Conflicted" },
};

interface FileLineProps {
  file: FileChange;
  /** A button shown on hover, like "Stage". */
  action?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
}

export function FileLine({ file, action }: FileLineProps) {
  const status = STATUS[file.status];
  // Untracked folders are listed as "dir/" when everything inside them is new.
  const isFolder = file.path.endsWith("/");
  const path = isFolder ? file.path.slice(0, -1) : file.path;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1) + (isFolder ? "/" : "");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const title = file.oldPath ? `${status.label}: ${file.oldPath} → ${file.path}` : `${status.label}: ${file.path}`;
  return (
    <li className="file" title={title}>
      <span className="file-status" style={{ color: status.color, background: withAlpha(status.color, 0.14) }}>
        {status.letter}
      </span>
      <span className="file-name">{name}</span>
      {dir && <span className="file-dir">{dir}</span>}
      {action && (
        <button
          className="file-action"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.label}
          aria-label={`${action.label} ${file.path}`}
        >
          {action.icon}
        </button>
      )}
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    await copyText(text);
    setCopied(true);
  };

  return (
    <button className="copy-button" onClick={copy} title="Copy the full SHA">
      <span className="mono">{label}</span>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}
