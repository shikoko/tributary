import { useEffect, useMemo, useRef, useState } from "react";
import { linesLabel, linesOf } from "../../lib/lineSelection";
import { languageFor } from "../../lib/syntax";
import { fileDiff, type Action, type FileDiff, type LineMode } from "../../api";
import type { DiffTarget } from "../../lib/diffTargets";
import { toolLabel, useDiffTools } from "../../lib/diffTools";
import { useStoredState } from "../../lib/settings";
import { describeActor, useActorNames } from "../../lib/actorNames";
import { BlameIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, ExternalLinkIcon, SplitIcon } from "../Icons";
import { DiffBinary } from "./DiffBinary";
import { DiffMedia } from "./DiffMedia";
import { describeOwners, useCodeOwners } from "../../lib/codeOwners";
import { FileKindIcon } from "../FileKindIcon";
import { ConflictEditor } from "./ConflictEditor";
import { DiffLines, type LinePicking } from "./DiffLines";
import { DiffSubmodule } from "./DiffSubmodule";
import { Loader } from "../Loader";
import { Button } from "../ui/Button";

interface Props {
  repoPath: string;
  /** The files to step through, and the one shown. */
  targets: DiffTarget[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** For opening the diff or merge tool, and staging lines. Resolves once it's done. */
  run: (action: Action) => void | Promise<unknown>;
  /** Changes when the repository reloads: your changes are read again. */
  version: unknown;
  /** No diff (or merge) tool is set up: choose one, in Settings. */
  onChooseTool: () => void;
  /** What the two sides of a conflict are called, like "main" and "feature/sync". */
  sides: { mine: string; theirs: string };
  /** Show who changed each line of the file instead. */
  onBlame: (target: DiffTarget) => void;
}

/** The narrowest the changes can be to show side by side. */
const SPLIT_MIN_WIDTH = 640;

/**
 * A file's changes over the commit list: text line by line, images side by side, other
 * files by their size. Esc closes, [ and ] go to the previous and next file.
 */
export function DiffView({ repoPath, targets, index, onIndex, onClose, run, version, onChooseTool, sides, onBlame }: Props) {
  const target = targets[index];
  const [ignoreWhitespace, setIgnoreWhitespace] = useStoredState("diff.ignoreWhitespace", false);
  const [split, setSplit] = useStoredState("diff.sideBySide", false);
  // Side by side needs room for two columns of code: narrower, the changes show in one.
  const body = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setRoomy(element.clientWidth >= SPLIT_MIN_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [loaded, setLoaded] = useState<{ key: string; diff: FileDiff | null; error: string | null } | null>(null);
  /** Your own changes, which change as you work (rather than a commit's, or between two). */
  const live = target.source.kind === "staged" || target.source.kind === "unstaged";
  // An Unreal actor saved in its own file: named as it is in the editor.
  const source = target.source;
  const actorAt = source.kind === "commit" ? source.id : source.kind === "range" ? source.to : null;
  const actorFiles = useMemo(() => [target.file], [target.file]);
  const actor = useActorNames(repoPath, actorAt, source.kind === "range" ? source.from : null, actorFiles).get(target.file.path);
  const key = JSON.stringify([target.source, target.file.path, target.file.oldPath, ignoreWhitespace]);
  // Lines chosen to stage, unstage or discard (lib/lineSelection.ts).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedCount = useRef(0);
  selectedCount.current = selected.size;

  useEffect(() => {
    let current = true;
    fileDiff(repoPath, target.source, target.file.path, target.file.oldPath ?? undefined, ignoreWhitespace)
      .then((diff) => current && setLoaded({ key, diff, error: null }))
      .catch((e) => current && setLoaded({ key, diff: null, error: String(e) }));
    return () => {
      current = false;
    };
    // Your own changes are read again whenever the repository reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, repoPath, live ? version : null]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in a text field (the whitespace checkbox doesn't count).
      const typing = (event.target as HTMLElement | null)?.closest?.('textarea, select, [contenteditable], input:not([type="checkbox"])');
      // Menus and dialogs over this one close first.
      const above = document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"]');
      if (typing || above || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "[" ? -1 : event.key === "]" ? 1 : 0;
      // Esc lets go of chosen lines first.
      if (event.key === "Escape" && selectedCount.current > 0) setSelected(new Set());
      else if (event.key === "Escape") onClose();
      else if (step && targets[index + step]) onIndex(index + step);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Before the app's own shortcuts, so Esc closes this first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, targets, onIndex, onClose]);

  const diff = loaded?.key === key ? loaded.diff : null;
  const error = loaded?.key === key ? loaded.error : null;

  // A new diff (after staging, say) starts with no lines chosen.
  const [applying, setApplying] = useState(false);
  useEffect(() => setSelected(new Set()), [diff]);
  const side = target.source.kind === "staged" || target.source.kind === "unstaged" ? target.source.kind : null;
  /** Why lines can't be chosen here, if they can't. */
  const notPickable = !side
    ? null
    : target.file.status === "untracked"
      ? "Stage the new file first, then choose its lines"
      : target.file.status === "conflicted"
        ? "Resolve the conflict first"
        : target.file.oldPath
          ? "Renamed files are staged whole"
          : diff?.lfs
            ? "Files stored with Git LFS are staged whole"
            : ignoreWhitespace
              ? "Turn off Ignore whitespace to choose lines"
              : null;
  const apply = async (mode: LineMode, keys: Iterable<string>) => {
    setApplying(true);
    try {
      await run({ kind: "applyLines", file: target.file.path, mode, ...linesOf(keys) });
    } finally {
      setApplying(false);
    }
  };
  const picking: LinePicking | undefined =
    side && !notPickable ? { side, selected, onSelect: setSelected, onApply: (mode, keys) => void apply(mode, keys), busy: applying } : undefined;
  const path = target.file.path;
  const slash = path.lastIndexOf("/");
  const conflicted = target.file.status === "conflicted";
  // 3D models stored as text (OBJ, glTF) can show either way: in 3D, or line by line.
  const [asText, setAsText] = useStoredState("diff.modelsAsText", false);
  const both = Boolean(diff?.media && diff.hunks.length > 0);
  const showMedia = Boolean(diff?.media && !(both && asText));
  const tools = useDiffTools(repoPath);
  const owners = useCodeOwners(repoPath, path);
  const tool = tools ? (conflicted ? tools.merge : tools.diff) : null;
  /** Open the file in the diff (or merge) tool, or choose one first. */
  const openInTool = () =>
    tools && !tool ? onChooseTool() : run(conflicted ? { kind: "openInMergeTool", path } : { kind: "openInDiffTool", source: target.source, path });
  const toolButton = tools && !tool ? `Choose a ${conflicted ? "merge" : "diff"} tool…` : `Open in ${toolLabel(tool, conflicted ? "merge" : "diff")}`;
  /** Shown as something other than lines: whitespace and diff tools don't apply. */
  const whole = Boolean(diff && (diff.binary || diff.tooLarge || diff.submodule || showMedia));
  return (
    <section className="diff-view" aria-label={`Changes to ${path}`}>
      <header className="diff-header">
        <div className="diff-steps">
          <Button kind="icon" onClick={() => onIndex(index - 1)} disabled={index === 0} title="Previous file ([)" aria-label="Previous file">
            <ChevronUpIcon size={14} />
          </Button>
          <Button
            kind="icon"
            onClick={() => onIndex(index + 1)}
            disabled={index === targets.length - 1}
            title="Next file (])"
            aria-label="Next file"
          >
            <ChevronDownIcon size={14} />
          </Button>
          <span className="diff-count">
            {index + 1} of {targets.length}
          </span>
        </div>
        <div className="diff-title" title={`${target.file.oldPath ? `${target.file.oldPath} → ${path}` : path}${actor ? `\n${describeActor(actor)}` : ""}`}>
          <FileKindIcon path={path} size={14} className="file-kind diff-kind" />
          <span className="diff-name">{actor?.label ?? actor?.class ?? path.slice(slash + 1)}</span>
          {diff && !whole && !conflicted && (
            <span className="diff-stats">
              <span className="added">+{diff.additions}</span> <span className="removed">−{diff.deletions}</span>
            </span>
          )}
          {actor?.level ? <span className="diff-dir">{actor.level}</span> : slash > 0 && <span className="diff-dir">{path.slice(0, slash)}</span>}
          <span className="diff-source"><span className="chip-text">{target.label}</span></span>
          {owners.length > 0 && (
            <span className="diff-source diff-owners" title={`Its owners, by CODEOWNERS: ${owners.join(", ")}`}>
              Owned by {describeOwners(owners)}
            </span>
          )}
          {diff?.lfs && !diff.binary && !diff.tooLarge && (
            <span className="diff-source" title="Stored with Git LFS: these are the files' real contents">
              Git LFS
            </span>
          )}
        </div>
        {both && (
          <div className="diff-switch" role="group" aria-label="Show as">
            <button className={showMedia ? "selected" : undefined} onClick={() => setAsText(false)} aria-pressed={showMedia}>
              <span className="button-label">3D</span>
            </button>
            <button className={!showMedia ? "selected" : undefined} onClick={() => setAsText(true)} aria-pressed={!showMedia}>
              <span className="button-label">Text</span>
            </button>
          </div>
        )}
        {!whole && !conflicted && (
          <label className="checkbox diff-option">
            <input type="checkbox" checked={ignoreWhitespace} onChange={(event) => setIgnoreWhitespace(event.target.checked)} />
            Ignore whitespace
          </label>
        )}
        {(conflicted || (target.file.status !== "untracked" && !diff?.submodule)) && (
          <Button
            kind="outline" className="tool-button"
            onClick={openInTool}
            title={`${toolButton}: ${
              tools && !tool
                ? "no tool is set up in git yet, choose one in Settings"
                : conflicted
                  ? "resolve it in the merge tool set up in git (merge.tool)"
                  : "compare it in the diff tool set up in git (diff.tool)"
            }`}
            aria-label={toolButton}
          >
            <ExternalLinkIcon size={13} />
            <span className="button-label">{toolButton}</span>
          </Button>
        )}
        {!whole && !conflicted && (
          <Button
            kind="icon" className={split ? "active" : undefined}
            onClick={() => setSplit(!split)}
            aria-pressed={split}
            title={
              split && !roomy
                ? "Side by side (shown in one column until there's more room)"
                : split
                  ? "Show the changes in one column"
                  : "Show before and after side by side"
            }
            aria-label="Side by side"
          >
            <SplitIcon size={15} />
          </Button>
        )}
        {!whole && !conflicted && target.file.status !== "deleted" && target.file.status !== "untracked" && (
          <Button kind="icon" onClick={() => onBlame(target)} title="Who changed each line" aria-label="Who changed each line">
            <BlameIcon size={15} />
          </Button>
        )}
        <Button kind="icon" onClick={onClose} title="Close (Esc)" aria-label="Close the changes">
          <CloseIcon />
        </Button>
      </header>
      {/* It scrolls: from the keyboard too, once it has focus. */}
      <div className="diff-body" ref={body} tabIndex={0}>
        {conflicted && live ? (
          <ConflictEditor repoPath={repoPath} path={path} mine={sides.mine} theirs={sides.theirs} version={version} run={run} />
        ) : error ? (
          <div className="diff-message">
            <strong>Couldn't read the changes</strong>
            <span>{error}</span>
          </div>
        ) : !diff ? (
          <Loader size={88} title="Reading the changes" />
        ) : diff.submodule ? (
          <DiffSubmodule change={diff.submodule} />
        ) : diff.media && showMedia ? (
          <DiffMedia diff={diff} media={diff.media} />
        ) : diff.binary || diff.tooLarge ? (
          <DiffBinary diff={diff} tool={toolButton} onOpen={openInTool} />
        ) : diff.hunks.length === 0 ? (
          <div className="diff-message muted">{ignoreWhitespace ? "Only whitespace changed." : "No changes to show (only the file's name or mode changed)."}</div>
        ) : (
          <DiffLines hunks={diff.hunks} picking={picking} language={languageFor(path)} split={split && roomy} />
        )}
      </div>
        {picking && selected.size > 0 && (
          <div className="line-bar" role="toolbar" aria-label="Chosen lines">
            <span>{linesLabel(selected.size)} chosen</span>
            {picking.side === "unstaged" ? (
              <>
                <Button kind="outline" disabled={applying} onClick={() => void apply("discard", selected)} title="Undo them in the file (you can put them back)">
                  <span className="button-label">Discard</span>
                </Button>
                <Button kind="primary" disabled={applying} onClick={() => void apply("stage", selected)}>
                  Stage {linesLabel(selected.size)}
                </Button>
              </>
            ) : (
              <Button kind="primary" disabled={applying} onClick={() => void apply("unstage", selected)}>
                Unstage {linesLabel(selected.size)}
              </Button>
            )}
            <Button kind="icon" onClick={() => setSelected(new Set())} title="Let go of them (Esc)" aria-label="Let go of the chosen lines">
              <CloseIcon size={13} />
            </Button>
          </div>
        )}
    </section>
  );
}
