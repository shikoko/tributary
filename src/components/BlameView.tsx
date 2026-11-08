import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { blameFile, type Blame, type BlameCommit } from "../api";
import { compactTime, fullDate, shortId } from "../lib/format";
import { highlightCode, languageFor, MAX_HIGHLIGHT_LINES, pieces } from "../lib/syntax";
import { LineText } from "./diff/DiffLines";
import { Avatar } from "./Avatar";
import { FileKindIcon } from "./FileKindIcon";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, HistoryIcon } from "./Icons";

const ROW = 20;
/** Rows drawn above and below the ones on screen. */
const OVERSCAN = 40;

interface Props {
  repoPath: string;
  /** The file, and the commit to show it at (null: as it is in your working tree). */
  path: string;
  at: string | null;
  onClose: () => void;
  /** Go to a commit in the list (when it's loaded). */
  onSelectCommit: (id: string) => void;
  hasCommit: (id: string) => boolean;
}

/** A version of the file looked at: where, and the line to show first. */
interface Version {
  path: string;
  at: string | null;
  line?: number;
  /** What it's the version before, for the Back button. */
  before?: BlameCommit;
}

/**
 * Who changed each line of a file last, over the commit list: each stretch of lines from
 * the same commit shows its author, when, and the commit's message; newer changes have a
 * brighter bar. Click one to go to its commit, or step back to the version before it to
 * see who changed those lines before; Back and Forward go between the versions seen.
 * Esc closes.
 */
export function BlameView({ repoPath, path: startPath, at: startAt, onClose, onSelectCommit, hasCommit }: Props) {
  const [versions, setVersions] = useState<{ list: Version[]; index: number }>({ list: [{ path: startPath, at: startAt }], index: 0 });
  // Another file (or commit) to start from: a new history.
  useEffect(() => setVersions({ list: [{ path: startPath, at: startAt }], index: 0 }), [startPath, startAt]);
  const version = versions.list[versions.index] ?? { path: startPath, at: startAt };
  const { path, at } = version;
  const stepBack = useCallback(
    (commit: BlameCommit, line: number) =>
      commit.previous &&
      setVersions(({ list, index }) => ({
        list: [...list.slice(0, index + 1), { path: commit.previousName ?? path, at: commit.previous, line, before: commit }],
        index: index + 1,
      })),
    [path],
  );
  const go = (step: number) => setVersions(({ list, index }) => ({ list, index: Math.min(list.length - 1, Math.max(0, index + step)) }));
  const [loaded, setLoaded] = useState<{ key: string; blame: Blame | null; error: string | null } | null>(null);
  const key = JSON.stringify([repoPath, path, at]);
  useEffect(() => {
    let current = true;
    blameFile(repoPath, path, at)
      .then((blame) => current && setLoaded({ key, blame, error: null }))
      .catch((e) => current && setLoaded({ key, blame: null, error: String(e) }));
    return () => {
      current = false;
    };
  }, [key, repoPath, path, at]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const blame = loaded?.key === key ? loaded.blame : null;
  const error = loaded?.key === key ? loaded.error : null;
  const slash = path.lastIndexOf("/");
  return (
    <section className="diff-view blame-view" aria-label={`Who changed each line of ${path}`}>
      <header className="diff-header">
        {versions.list.length > 1 && (
          <div className="diff-steps">
            <button className="icon-button" onClick={() => go(-1)} disabled={versions.index === 0} title="Back to the newer version" aria-label="Back">
              <ChevronLeftIcon size={14} />
            </button>
            <button
              className="icon-button"
              onClick={() => go(1)}
              disabled={versions.index === versions.list.length - 1}
              title="Forward to the older version"
              aria-label="Forward"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        )}
        <div className="diff-title" title={path}>
          <FileKindIcon path={path} size={14} className="file-kind diff-kind" />
          <span className="diff-name">{path.slice(slash + 1)}</span>
          {slash > 0 && <span className="diff-dir">{path.slice(0, slash)}</span>}
          <span className="diff-source" title={version.before ? `The version before ${shortId(version.before.id ?? "")}: ${version.before.summary}` : undefined}>
            {version.before ? `Before ${shortId(version.before.id ?? "")}` : at ? `At ${shortId(at)}` : "Your version"}
          </span>
          {blame && <span className="diff-source">{blame.commits.length === 1 ? "1 commit" : `${blame.commits.length} commits`}</span>}
        </div>
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close who changed each line">
          <CloseIcon />
        </button>
      </header>
      <div className="diff-body">
        {error ? (
          <div className="diff-message">
            <strong>Couldn't see who changed it</strong>
            <span>{error}</span>
          </div>
        ) : !blame ? (
          <div className="diff-message muted">Loading…</div>
        ) : blame.lines.length === 0 ? (
          <div className="diff-message muted">The file is empty.</div>
        ) : (
          <BlameLines
            key={key}
            blame={blame}
            language={languageFor(path)}
            onSelectCommit={onSelectCommit}
            hasCommit={hasCommit}
            onStepBack={stepBack}
            firstLine={version.line}
          />
        )}
      </div>
    </section>
  );
}

function BlameLines({
  blame,
  language,
  onSelectCommit,
  hasCommit,
  onStepBack,
  firstLine,
}: {
  blame: Blame;
  language: string | null;
  onSelectCommit: (id: string) => void;
  hasCommit: (id: string) => boolean;
  /** See the version before `commit`, at about `line`. */
  onStepBack: (commit: BlameCommit, line: number) => void;
  /** The line to scroll to first. */
  firstLine?: number;
}) {
  // The whole file coloured at once, so comments and strings over several lines come out right.
  const syntax = useMemo(
    () => (blame.lines.length > MAX_HIGHLIGHT_LINES * 2 ? null : highlightCode(blame.lines.map((line) => line.text).join("\n"), language)),
    [blame, language],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [hovered, setHovered] = useState<number | null>(null);

  // Where each stretch of lines from one commit starts, and how new each commit is (0 to 1).
  const { starts, age } = useMemo(() => {
    const starts = blame.lines.map((line, index) => index === 0 || blame.lines[index - 1].commit !== line.commit);
    const times = blame.commits.map((commit) => (commit.id ? commit.time : Number.POSITIVE_INFINITY));
    const finite = times.filter(Number.isFinite);
    const [oldest, newest] = [Math.min(...finite), Math.max(...finite)];
    const age = times.map((time) => (!Number.isFinite(time) ? 1 : newest === oldest ? 1 : (time - oldest) / (newest - oldest)));
    return { starts, age };
  }, [blame]);

  useLayoutEffect(() => {
    const element = scroller.current?.closest<HTMLElement>(".diff-body");
    if (!element) return;
    // Where the lines were in the newer version, near the top.
    element.scrollTop = firstLine ? Math.max(0, (firstLine - 4) * ROW) : 0;
    const update = () => setView({ top: element.scrollTop, height: element.clientHeight });
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(blame.lines.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  const digits = String(blame.lines.length).length;
  const rows = [];
  for (let index = first; index < last; index++) {
    const line = blame.lines[index];
    const commit = blame.commits[line.commit];
    const start = starts[index];
    // The line after a stretch's first shows its message, when the stretch is longer.
    const second = index > 0 && starts[index - 1] && !start;
    rows.push(
      <div
        key={index}
        className={`blame-row${start ? " start" : ""}${hovered === line.commit ? " hovered" : ""}`}
        style={{ top: index * ROW }}
        onMouseEnter={() => setHovered(line.commit)}
      >
        <BlameGutter
          commit={commit}
          start={start}
          second={second}
          onSelectCommit={onSelectCommit}
          hasCommit={hasCommit}
          onStepBack={() => onStepBack(commit, line.original)}
        />
        <span className="blame-age" style={{ opacity: 0.15 + 0.85 * age[line.commit] }} />
        <span className="blame-number">{index + 1}</span>
        <span className="blame-text">
          <LineText parts={pieces(line.text, syntax?.[index] ?? null, null)} />
        </span>
      </div>,
    );
  }
  return (
    <div
      ref={scroller}
      className="blame-lines"
      style={{ height: blame.lines.length * ROW, ["--number-width" as string]: `${digits + 2}ch` }}
      onMouseLeave={() => setHovered(null)}
      role="table"
      aria-label="Lines and who changed them"
    >
      {rows}
    </div>
  );
}

function BlameGutter({
  commit,
  start,
  second,
  onSelectCommit,
  hasCommit,
  onStepBack,
}: {
  commit: BlameCommit;
  start: boolean;
  second: boolean;
  onSelectCommit: (id: string) => void;
  hasCommit: (id: string) => boolean;
  onStepBack: () => void;
}) {
  const id = commit.id;
  const title = id
    ? `${commit.summary}\n${commit.author} <${commit.email}>, ${fullDate(commit.time)}\n${shortId(id)}${hasCommit(id) ? " — click to go to it" : ""}`
    : "Not committed yet";
  const go = id && hasCommit(id) ? () => onSelectCommit(id) : undefined;
  if (start) {
    return (
      <span className="blame-gutter-cell">
        <button className="blame-gutter" onClick={go} disabled={!go} title={title}>
          {id ? <Avatar name={commit.author} email={commit.email} size={14} /> : <span className="blame-you" />}
          <span className="blame-author">{id ? commit.author : "Not committed yet"}</span>
          {id && <span className="blame-when">{compactTime(commit.time)}</span>}
        </button>
        {commit.previous && (
          <button
            className="blame-back"
            onClick={onStepBack}
            title={`Who changed these lines before ${shortId(commit.id ?? "")}: the version before “${commit.summary}”`}
            aria-label={`Before ${shortId(commit.id ?? "")}`}
          >
            <HistoryIcon size={12} />
          </button>
        )}
      </span>
    );
  }
  if (second && id) {
    return (
      <button className="blame-gutter summary" onClick={go} disabled={!go} title={title}>
        {commit.summary}
      </button>
    );
  }
  return <span className="blame-gutter empty" />;
}
