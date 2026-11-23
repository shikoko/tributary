import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { commitDetails, commitTemplate, type Action, type LargeFile, type NameProblem, type RepoSnapshot } from "../../api";
import { OpenRepositoryContext } from "../../app/OpenRepository";
import { branchIssueKey, branchNameFromSummary, fromTemplate, useIssueTracker, withIssueKey } from "../../lib/issues";
import { describeMeta, type MetaWarning } from "../../lib/unityMeta";
import { plural } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { modKey } from "../../lib/platform";
import { ContextMenu } from "../ContextMenu";
import { BranchIcon, ChevronDownIcon, WarningIcon } from "../Icons";
import { Button } from "../ui/Button";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

/** Sent when a repository's commit message template changes, so the commit box reads it again. */
export const TEMPLATE_CHANGED = "tributary:commit-template";

interface Props {
  snapshot: RepoSnapshot;
  draft: CommitDraft;
  onDraft: (draft: CommitDraft) => void;
  /** How many files are staged. */
  stagedCount: number;
  /** Big staged files outside Git LFS: committing them asks first. */
  largeStaged: LargeFile[];
  /** Staged new files whose names won't work everywhere: committing them asks first too. */
  namesStaged: NameProblem[];
  /** Staged Unity assets whose .meta is wrong or not staged: committing them asks first too. */
  metasStaged: MetaWarning[];
  busy: boolean;
  /** Runs a git action; resolves to true when it worked. */
  run: (action: Action) => Promise<boolean>;
  /** Help writing the message: recent messages and co-authors. */
  messageTools?: ReactNode;
}

/**
 * The commit message (with the summary's length) and the Commit button. During a merge,
 * cherry-pick or revert, or after a squash merge, it starts from the message git
 * prepared; amending starts from the last commit's.
 *
 * The Commit button says which branch the commit goes to, and its menu can send it to a new
 * branch instead: one made from where you are, named from the summary, which your changes
 * move to before they're committed. On a protected branch, it suggests that.
 */
export function CommitBox({ snapshot, draft, onDraft, stagedCount, largeStaged, namesStaged, metasStaged, busy, run, messageTools }: Props) {
  const [confirmLarge, setConfirmLarge] = useState(false);
  const worries = largeStaged.length + namesStaged.length + metasStaged.length;
  useEffect(() => {
    if (worries === 0) setConfirmLarge(false);
  }, [worries]);
  const [committing, setCommitting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  // Where the commit goes: the branch you're on, or (with a name) a new branch made from here.
  const branch = snapshot.headBranch;
  const protectedHead = useContext(OpenRepositoryContext)?.protectedHead ?? null;
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; above: number } | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // Not while amending (that changes the last commit, where it is), nor during a merge,
  // cherry-pick or revert, nor before the first commit, with nothing to branch from.
  const canBranch = !draft.amend && !snapshot.operation && snapshot.headCommit !== null;
  useEffect(() => {
    if (!canBranch) setNewBranch(null);
  }, [canBranch]);
  const toNewBranch = () => {
    setNewBranch(branchNameFromSummary(draft.summary));
    requestAnimationFrame(() => nameInput.current?.select());
  };
  const target = newBranch === null ? null : newBranch.trim();

  // During a merge, cherry-pick or revert, or after a squash merge, start from the message git prepared.
  const prepared = snapshot.operation?.message ?? snapshot.squashMessage ?? null;
  useEffect(() => {
    if (!prepared || draft.summary || draft.description) return;
    const [summary, ...rest] = prepared.split("\n");
    onDraft({ summary, description: rest.join("\n").trim(), amend: false });
    // Only when git prepares a message: what's typed after that is yours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  // On a branch for a Jira or Linear issue, the summary starts with its key (unless that's turned off).
  const { tracker } = useIssueTracker();
  const issueKey = branchIssueKey(snapshot.headBranch, tracker);
  const [withKey, setWithKey] = useState(true);
  useEffect(() => setWithKey(true), [issueKey]);

  // New messages start from git's commit.template, when there is one: once each time the
  // message is empty (after a commit, say), not again when you've cleared it yourself.
  const [template, setTemplate] = useState<{ summary: string; description: string } | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      commitTemplate(snapshot.path)
        .then((found) => live && setTemplate(found.text ? fromTemplate(found.text) : null))
        .catch(() => live && setTemplate(null));
    read();
    window.addEventListener(TEMPLATE_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(TEMPLATE_CHANGED, read);
    };
  }, [snapshot.path]);
  const filled = useRef(false);
  useEffect(() => {
    const empty = !draft.summary && !draft.description;
    if (!template || filled.current || prepared || draft.amend || !empty) return;
    filled.current = true;
    onDraft({ summary: template.summary, description: template.description, amend: false });
  }, [template, prepared, draft, onDraft]);
  // Committing just the template, unchanged, isn't what anyone means (git won't either).
  const untouched = template !== null && draft.summary === template.summary && draft.description === template.description;

  // Amending starts from the last commit's message.
  useEffect(() => {
    if (!draft.amend || draft.summary || !snapshot.headCommit) return;
    let cancelled = false;
    commitDetails(snapshot.path, snapshot.headCommit).then(
      (details) => {
        if (cancelled) return;
        setLastMessage(details.summary);
        onDraft({ ...draft, summary: details.summary, description: details.body });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // Only when amending is turned on or off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amend]);

  const canCommit =
    !busy &&
    !committing &&
    draft.summary.trim() !== "" &&
    !untouched &&
    (stagedCount > 0 || draft.amend) &&
    !snapshot.bare &&
    target !== "";
  const summary = withKey && !draft.amend ? withIssueKey(draft.summary.trim(), issueKey) : draft.summary.trim();
  const commit = async (anyway = false) => {
    if (!canCommit) return;
    // Big files committed outside Git LFS stay in every clone forever, and names that don't
    // work on Windows or macOS break teammates' checkouts: ask first.
    if (worries > 0 && !anyway) {
      setConfirmLarge(true);
      return;
    }
    setConfirmLarge(false);
    setCommitting(true);
    // To a new branch: made where you are, and switched to, taking your changes with you.
    if (target !== null && snapshot.headCommit) {
      const made = await run({ kind: "createBranch", name: target, id: snapshot.headCommit, checkout: true });
      if (!made) {
        setCommitting(false);
        return;
      }
      setNewBranch(null);
    }
    const message = draft.description.trim() ? `${summary}\n\n${draft.description.trim()}` : summary;
    const done = await run({ kind: "commit", message, amend: draft.amend });
    setCommitting(false);
    if (done) {
      // The next message starts from the template again.
      filled.current = false;
      onDraft({ summary: "", description: "", amend: false });
    }
  };
  const toggleAmend = (amend: boolean) => {
    // Turning amend off again clears the message it filled in.
    if (!amend && draft.summary === lastMessage) onDraft({ summary: "", description: "", amend });
    else onDraft({ ...draft, amend });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="commit-box" data-tour="commit-box">
      {messageTools}
      <div className="summary-field">
        {issueKey && !draft.amend && !draft.summary.toUpperCase().includes(issueKey) && (
          <button
            type="button"
            className={`summary-key${withKey ? " on" : ""}`}
            onClick={() => setWithKey(!withKey)}
            aria-pressed={withKey}
            title={withKey ? `The summary starts with ${issueKey}: (this branch's issue). Click to leave it out` : `Start the summary with ${issueKey}:`}
          >
            {issueKey}
          </button>
        )}
        <input
          className="text-input"
          value={draft.summary}
          onChange={(event) => onDraft({ ...draft, summary: event.target.value })}
          onKeyDown={onKeyDown}
          placeholder="Commit summary"
          aria-label="Commit summary"
          spellCheck
        />
        {draft.summary.length > 0 && (
          <span
            className={`summary-count${draft.summary.length > 72 ? " over" : draft.summary.length > 50 ? " long" : ""}`}
            title="Summaries up to 50 characters (72 at most) show in full in most places"
          >
            {draft.summary.length}
          </span>
        )}
      </div>
      <textarea
        className="text-input"
        value={draft.description}
        onChange={(event) => onDraft({ ...draft, description: event.target.value })}
        onKeyDown={onKeyDown}
        placeholder="Description (optional)"
        aria-label="Commit description"
        rows={3}
        spellCheck
      />
      {confirmLarge && (
        <div className="commit-warning" role="alert">
          <span>
            {largeStaged.length > 0 && (
              <>
                {largeStaged.length === 1 ? `${baseName(largeStaged[0].path)} is` : `${largeStaged.length} staged files are`} big
                and not in Git LFS.{" "}
              </>
            )}
            {namesStaged.length > 0 && (
              <>
                {namesStaged.length === 1 ? `${baseName(namesStaged[0].path)}'s name` : `${namesStaged.length} staged files' names`}{" "}
                won't work on everyone's computer.{" "}
              </>
            )}
            {metasStaged.length > 0 && (
              <>
                {metasStaged.length === 1 ? `${baseName(metasStaged[0].path)} ${describeMeta(metasStaged[0])}.` : `${metasStaged.length} staged Unity files have .meta problems.`}
              </>
            )}
          </span>
          <Button kind="link" onClick={() => setConfirmLarge(false)}>
            Cancel
          </Button>
          <button className="danger-outline-button small" onClick={() => commit(true)}>
            Commit anyway
          </button>
        </div>
      )}
      {newBranch !== null && (
        <div className="commit-new-branch">
          <span className="commit-new-branch-title">
            <BranchIcon size={13} />
            {branch ? `Commit to a new branch from ${branch}` : "Commit to a new branch from here"}
          </span>
          <div className="commit-new-branch-row">
            <input
              ref={nameInput}
              className="text-input"
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setNewBranch(null);
                } else onKeyDown(event);
              }}
              placeholder="Branch name"
              aria-label="New branch's name"
              spellCheck={false}
            />
            <Button kind="link" onClick={() => setNewBranch(null)}>
              Cancel
            </Button>
          </div>
          <span className="commit-new-branch-hint">
            {draft.summary.trim() ? "Named from your summary. " : ""}
            Your changes move to it{branch ? `, and ${branch} stays as it is` : ""}.
          </span>
        </div>
      )}
      {protectedHead && protectedHead === branch && newBranch === null && canBranch && (
        <div className="commit-protected">
          <WarningIcon size={12} />
          <span>{branch} is protected.</span>
          <Button kind="link" onClick={toNewBranch}>
            Commit to a new branch
          </Button>
        </div>
      )}
      <div className="commit-row-controls">
        <label className="checkbox" title="Replace the last commit with these changes and this message">
          <input
            type="checkbox"
            checked={draft.amend}
            disabled={!snapshot.headCommit}
            onChange={(event) => toggleAmend(event.target.checked)}
          />
          Amend last commit
        </label>
        <div className="commit-split">
          <Button
            kind="primary"
            className="commit-button"
            onClick={() => commit()}
            disabled={!canCommit}
            title={
              stagedCount === 0 && !draft.amend
                ? "Stage the files you want to commit first"
                : untouched
                  ? "Fill in the template first"
                  : target === ""
                    ? "Name the new branch first"
                    : `Commit${summary !== draft.summary.trim() ? ` as "${summary}"` : ""}${
                        target !== null ? ` to a new branch, ${target}` : branch && !draft.amend ? ` to ${branch}` : ""
                      } (${modKey}Enter)`
            }
          >
            <CommitLabel
              key={`${target ?? branch}-${draft.amend}-${committing}`}
              start={
                committing
                  ? "Committing…"
                  : draft.amend
                    ? "Amend commit"
                    : `Commit ${stagedCount > 0 ? plural(stagedCount, "file") : ""}`.trim()
              }
              branch={committing || draft.amend ? null : target !== null ? target || "a new branch" : branch}
            />
          </Button>
          <Button
            ref={menuButton}
            kind="primary"
            className="commit-more"
            onClick={() => {
              const box = menuButton.current?.getBoundingClientRect();
              if (box) setMenu({ x: box.right - 260, y: box.bottom + 2, above: box.top - 2 });
            }}
            disabled={busy || committing || snapshot.bare}
            title="Where to commit"
            aria-label="Where to commit"
            aria-haspopup="menu"
          >
            <ChevronDownIcon size={14} />
          </Button>
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          above={menu.above}
          onClose={() => setMenu(null)}
          items={[
            {
              label: branch ? `Commit to ${branch}` : "Commit here, without a branch",
              detail: branch ? "The branch you're on" : undefined,
              checked: newBranch === null,
              onSelect: () => setNewBranch(null),
            },
            {
              label: "Commit to a new branch…",
              detail: branch ? `Your changes move to it; ${branch} stays as it is` : "Your changes move to it",
              checked: newBranch !== null,
              disabled: !canBranch,
              onSelect: toNewBranch,
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * The Commit button's words, with the branch the commit goes to. When there isn't room for
 * all of its name, the folders go first, as on the history's labels: "…/welcome-tour", not
 * "feature/welc…". The button's tooltip has the whole name.
 */
function CommitLabel({ start, branch }: { start: string; branch: string | null }) {
  const element = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(false);
  const [measured, setMeasured] = useState(0);
  // Shown in full, does it fit? Checked before it's painted.
  useLayoutEffect(() => {
    const span = element.current;
    if (span && !short && span.scrollWidth > span.clientWidth + 1) setShort(true);
  }, [short, measured]);
  // The panel resized: try the whole name again.
  useEffect(() => {
    const box = element.current?.closest(".commit-box");
    if (!box) return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      setShort(false);
      setMeasured((count) => count + 1);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const slash = branch?.lastIndexOf("/") ?? -1;
  return (
    <span ref={element} className="button-label">
      {start}
      {branch && (
        <>
          {" to "}
          <span className="commit-branch">
            {short && slash > 0 && slash < branch.length - 1 ? (
              <>
                <span className="commit-branch-folder">…/</span>
                {branch.slice(slash + 1)}
              </>
            ) : (
              branch
            )}
          </span>
        </>
      )}
    </span>
  );
}
