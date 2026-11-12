import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { conflictText, type Action, type ConflictText } from "../../api";
import { conflictsIn, parseConflicts, resolveConflict, resolvedText, type Choice, type Conflict } from "../../lib/conflicts";
import { plural } from "../../lib/format";
import { highlightCode, languageFor, pieces } from "../../lib/syntax";
import { LineText } from "./DiffLines";
import { Loader } from "../Loader";
import { Button } from "../ui/Button";

interface Props {
  repoPath: string;
  path: string;
  /** What the two sides are called, like "main" and "feature/sync". */
  mine: string;
  theirs: string;
  /** Changes when the repository reloads: the file is read again. */
  version: unknown;
  run: (action: Action) => void | Promise<unknown>;
}

/** Unchanged lines shown on each side of a conflict. */
const CONTEXT = 3;

/** Lines of code, coloured by their syntax. */
function Code({ text, language }: { text: string; language: string | null }) {
  const plain = text.replace(/\r/g, "");
  const tokens = useMemo(() => highlightCode(plain, language), [plain, language]);
  return (
    <>
      {plain.split("\n").map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          <LineText parts={pieces(line, tokens?.[index] ?? null, null)} />
        </Fragment>
      ))}
    </>
  );
}

const CHOICES: { choice: Exclude<Choice, { text: string }>; label: string }[] = [
  { choice: "ours", label: "Mine" },
  { choice: "theirs", label: "Theirs" },
  { choice: "ours-then-theirs", label: "Mine, then theirs" },
  { choice: "theirs-then-ours", label: "Theirs, then mine" },
];

const describeChoice = (choice: Choice, mine: string, theirs: string) =>
  typeof choice === "object"
    ? "Edited"
    : choice === "ours"
      ? `Mine (${mine})`
      : choice === "theirs"
        ? `Theirs (${theirs})`
        : choice === "ours-then-theirs"
          ? "Both: mine, then theirs"
          : "Both: theirs, then mine";

/**
 * A conflicted text file, conflict by conflict: mine and theirs side by side, to keep
 * one, both (in either order) or something written here. Saving writes the file and
 * stages it, which marks it resolved.
 */
export function ConflictEditor({ repoPath, path, mine, theirs, version, run }: Props) {
  const [loaded, setLoaded] = useState<{ path: string; file: ConflictText } | { path: string; error: string } | null>(null);
  const [choices, setChoices] = useState<(Choice | undefined)[]>([]);
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** The text the choices were made for. */
  const chosenFor = useRef<{ path: string; text: string | null } | null>(null);

  useEffect(() => {
    let current = true;
    conflictText(repoPath, path)
      .then((file) => {
        if (!current) return;
        // The same text again (another reload): keep the choices made so far.
        const same = chosenFor.current?.path === path && chosenFor.current.text === file.text;
        chosenFor.current = { path, text: file.text };
        if (!same) {
          setChoices([]);
          setEditing(null);
          setLoaded({ path, file });
        }
      })
      .catch((e) => current && setLoaded({ path, error: String(e) }));
    return () => {
      current = false;
    };
  }, [repoPath, path, version]);

  const file = loaded?.path === path && "file" in loaded ? loaded.file : null;
  const language = languageFor(path);
  const segments = useMemo(() => (file?.text != null ? parseConflicts(file.text) : null), [file]);
  const conflicts = useMemo(() => (segments ? conflictsIn(segments) : []), [segments]);
  const done = conflicts.filter((_, index) => choices[index] !== undefined).length;
  const result = segments && done === conflicts.length ? resolvedText(segments, choices) : null;

  const choose = (index: number, choice: Choice | undefined) =>
    setChoices((current) => {
      const next = [...current];
      next[index] = choice;
      return next;
    });
  const chooseAll = (choice: Choice) => setChoices(conflicts.map(() => choice));
  const save = async () => {
    if (result === null) return;
    setSaving(true);
    try {
      await run({ kind: "resolveWithText", file: path, text: result });
    } finally {
      setSaving(false);
    }
  };

  if (loaded?.path === path && "error" in loaded) {
    return (
      <div className="diff-message">
        <strong>Couldn't read the file</strong>
        <span>{loaded.error}</span>
      </div>
    );
  }
  if (!file) return <Loader size={88} title="Reading the conflict" />;
  if (file.text === null) {
    return (
      <div className="diff-message">
        <strong>This conflict can't be resolved here</strong>
        <span>{file.reason}</span>
        <span className="muted">Keep mine or take theirs from the file's buttons in the list, or open it in the merge tool.</span>
      </div>
    );
  }
  if (!segments) {
    return (
      <div className="diff-message">
        <strong>The conflict markers don't add up</strong>
        <span className="muted">Fix the file in an editor or the merge tool, then stage it to mark it resolved.</span>
      </div>
    );
  }
  if (conflicts.length === 0) {
    return (
      <div className="diff-message">
        <strong>No conflicts left in this file</strong>
        <span className="muted">It looks resolved: stage it to mark it resolved.</span>
        <Button kind="primary" onClick={() => void run({ kind: "stage", paths: [path] })}>
          Mark as resolved
        </Button>
      </div>
    );
  }

  let conflictIndex = 0;
  return (
    <div className="conflict-editor">
      <div className="conflict-bar">
        <span className="conflict-progress">
          <strong>
            {done} of {plural(conflicts.length, "conflict")}
          </strong>{" "}
          resolved
        </span>
        <Button kind="link" onClick={() => chooseAll("ours")} title={`Keep ${mine}'s side of every conflict`}>
          All mine
        </Button>
        <Button kind="link" onClick={() => chooseAll("theirs")} title={`Take ${theirs}'s side of every conflict`}>
          All theirs
        </Button>
        <span className="spacer" />
        <Button
          kind="primary"
          disabled={result === null || saving}
          onClick={() => void save()}
          title={result === null ? "Choose a side for every conflict first" : "Save the file and stage it"}
        >
          {saving ? "Saving…" : "Save and mark resolved"}
        </Button>
      </div>
      <div className="conflict-segments">
        {segments.map((segment, segmentIndex) => {
          if (segment.kind === "text") {
            return <CleanText key={segmentIndex} text={segment.text} first={segmentIndex === 0} last={segmentIndex === segments.length - 1} language={language} />;
          }
          const index = conflictIndex++;
          return (
            <ConflictCard
              key={segmentIndex}
              conflict={segment}
              number={index + 1}
              count={conflicts.length}
              mine={mine}
              theirs={theirs}
              choice={choices[index]}
              onChoose={(choice) => choose(index, choice)}
              editing={editing?.index === index ? editing.draft : null}
              onEdit={(draft) => setEditing(draft === null ? null : { index, draft })}
              language={language}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Lines that merged cleanly: a few next to each conflict, the rest folded. */
function CleanText({ text, first, last, language }: { text: string; first: boolean; last: boolean; language: string | null }) {
  const [open, setOpen] = useState(false);
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const head = first ? 0 : CONTEXT;
  const tail = last ? 0 : CONTEXT;
  if (open || lines.length <= head + tail + 1)
    return (
      <pre className="conflict-clean">
        <Code text={lines.join("\n")} language={language} />
      </pre>
    );
  const hidden = lines.length - head - tail;
  return (
    <div className="conflict-clean-group">
      {head > 0 && (
        <pre className="conflict-clean">
          <Code text={lines.slice(0, head).join("\n")} language={language} />
        </pre>
      )}
      <button className="conflict-fold" onClick={() => setOpen(true)}>
        ⋯ {plural(hidden, "unchanged line")}
      </button>
      {tail > 0 && (
        <pre className="conflict-clean">
          <Code text={lines.slice(lines.length - tail).join("\n")} language={language} />
        </pre>
      )}
    </div>
  );
}

interface CardProps {
  conflict: Conflict;
  number: number;
  count: number;
  mine: string;
  theirs: string;
  choice: Choice | undefined;
  onChoose: (choice: Choice | undefined) => void;
  /** The text being written for it, while editing. */
  editing: string | null;
  onEdit: (draft: string | null) => void;
  language: string | null;
}

function ConflictCard({ conflict, number, count, mine, theirs, choice, onChoose, editing, onEdit, language }: CardProps) {
  const [showBase, setShowBase] = useState(false);
  const sideText = (text: string) =>
    text === "" ? <span className="conflict-empty">Nothing (these lines were removed)</span> : <Code text={text.replace(/\r?\n$/, "")} language={language} />;
  return (
    <section className={`conflict-card${choice !== undefined ? " resolved" : ""}`} aria-label={`Conflict ${number} of ${count}`}>
      <header className="conflict-card-header">
        <span className="conflict-number">
          Conflict {number} of {count}
        </span>
        {choice !== undefined && editing === null && <span className="conflict-chosen">{describeChoice(choice, mine, theirs)}</span>}
        <span className="spacer" />
        <div className="conflict-choices" role="group" aria-label="Keep">
          {CHOICES.map((entry) => (
            <button
              key={entry.choice}
              className={choice === entry.choice ? "selected" : undefined}
              aria-pressed={choice === entry.choice}
              onClick={() => {
                onEdit(null);
                onChoose(choice === entry.choice ? undefined : entry.choice);
              }}
            >
              {entry.label}
            </button>
          ))}
          <button
            className={typeof choice === "object" || editing !== null ? "selected" : undefined}
            aria-pressed={typeof choice === "object"}
            onClick={() => onEdit(choice !== undefined ? resolveConflict(conflict, choice) : resolveConflict(conflict, "ours-then-theirs"))}
            title="Write it yourself, starting from the current choice (or both sides)"
          >
            Edit…
          </button>
        </div>
      </header>
      {editing !== null ? (
        <div className="conflict-edit">
          <textarea
            className="conflict-textarea"
            value={editing}
            spellCheck={false}
            autoFocus
            rows={Math.min(20, Math.max(4, editing.split("\n").length + 1))}
            onChange={(event) => onEdit(event.target.value)}
            aria-label={`Conflict ${number}, as it should be`}
          />
          <div className="conflict-edit-actions">
            <Button kind="outline" onClick={() => onEdit(null)}>
              <span className="button-label">Cancel</span>
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                onChoose({ text: editing });
                onEdit(null);
              }}
            >
              Use this
            </Button>
          </div>
        </div>
      ) : choice !== undefined ? (
        <pre className="conflict-result">{sideText(resolveConflict(conflict, choice))}</pre>
      ) : (
        <div className="conflict-sides">
          <div className="conflict-side mine">
            <div className="conflict-side-label">
              Mine <span>{mine}</span>
            </div>
            <pre>{sideText(conflict.ours)}</pre>
          </div>
          <div className="conflict-side theirs">
            <div className="conflict-side-label">
              Theirs <span>{theirs}</span>
            </div>
            <pre>{sideText(conflict.theirs)}</pre>
          </div>
        </div>
      )}
      {conflict.base !== null && editing === null && choice === undefined && (
        <div className="conflict-base">
          <Button kind="link" onClick={() => setShowBase(!showBase)} aria-expanded={showBase}>
            {showBase ? "Hide" : "Show"} what it was before either change
          </Button>
          {showBase && <pre>{sideText(conflict.base)}</pre>}
        </div>
      )}
    </section>
  );
}
