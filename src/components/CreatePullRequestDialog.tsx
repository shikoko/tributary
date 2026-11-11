import { useEffect, useState } from "react";
import { createPullRequest, newRequestInfo, type NewRequestInfo, type PullRequest } from "../api";
import { plural } from "../lib/format";
import { requestNoun, suggestRequest } from "../lib/pullRequests";
import { Dialog } from "./Dialog";
import { Loader } from "./Loader";
import { MarkdownField } from "./MarkdownField";

interface Props {
  repoPath: string;
  /** The branch's name on the remote, and the local branch (if there is one). */
  branch: string;
  local: string | null;
  /** The local branch is the checked-out one, so it can be pushed from here. */
  checkedOut: boolean;
  /** The site's own page for opening it, when there is one. */
  browserUrl: string | null;
  onCancel: () => void;
  onCreated: (pr: PullRequest) => void;
  openUrl: (url: string) => void;
  /** Push the checked-out branch; resolves to whether it worked. */
  push: () => Promise<boolean>;
  /** Open Settings at the GitHub section, to sign in. */
  signIn: () => void;
}

/** Whether the site can be asked for `owner`'s review: people, and on GitHub teams (not email addresses). */
function canAsk(owner: string, forge: NewRequestInfo["forge"]): boolean {
  return owner.startsWith("@") && (forge === "github" || !owner.includes("/"));
}

/**
 * Open a pull request (or a GitLab merge request) for a branch without leaving the app:
 * its title and description (suggested from its commits), the branch to merge it into,
 * and whether it's a draft. Without a token for the site, it's opened in the browser.
 */
export function CreatePullRequestDialog({ repoPath, branch, local, checkedOut, browserUrl, onCancel, onCreated, openUrl, push, signIn }: Props) {
  const [info, setInfo] = useState<NewRequestInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [draft, setDraft] = useState(false);
  const [pushFirst, setPushFirst] = useState(true);
  // The owners of the files it changes to ask for a review: those the site can ask.
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [running, setRunning] = useState<"push" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    newRequestInfo(repoPath, branch, local)
      .then((found) => {
        if (!current) return;
        setInfo(found);
        const suggested = suggestRequest(branch, found.commits);
        setTitle(suggested.title);
        setBody(suggested.body);
        setBase(found.base ?? found.bases.find((name) => name !== branch) ?? "");
        setReviewers(found.owners.filter((owner) => canAsk(owner, found.forge)));
      })
      .catch((e) => current && setLoadError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, branch, local]);

  const noun = requestNoun(info?.forge);
  const site = info?.forge === "gitlab" ? "GitLab" : "GitHub";
  const unpushed = info ? (info.onRemote ? info.unpushed : Math.max(info.unpushed, 1)) : 0;
  // A branch not on the remote yet can only be opened once it's pushed.
  const mustPush = Boolean(info && !info.onRemote);
  const willPush = Boolean(info && checkedOut && unpushed > 0 && (pushFirst || mustPush));
  const blocked = mustPush && !checkedOut;
  const canCreate = Boolean(info?.signedIn && title.trim() && base && base !== branch && !blocked && running === null);

  const create = async () => {
    if (!canCreate) return;
    setError(null);
    if (willPush) {
      setRunning("push");
      if (!(await push())) {
        setRunning(null);
        setError(`Couldn't push ${local}: see the message in the window.`);
        return;
      }
    }
    setRunning("create");
    try {
      onCreated(await createPullRequest(repoPath, { branch, base, title: title.trim(), body, draft, reviewers }));
    } catch (e) {
      setError(String(e));
      setRunning(null);
    }
  };

  const browserButton = browserUrl && (
    <button className="secondary-button" onClick={() => openUrl(browserUrl)} disabled={running !== null}>
      Open on {site} instead
    </button>
  );

  if (loadError) {
    return (
      <Dialog
        title="New pull request"
        error={loadError}
        onCancel={onCancel}
        buttons={
          <>
            <button className="secondary-button" onClick={onCancel}>
              Close
            </button>
            {browserUrl && (
              <button className="primary-small-button" onClick={() => openUrl(browserUrl)}>
                Open in the browser
              </button>
            )}
          </>
        }
      >
        <p>Couldn't get ready to open it here.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`New ${noun}`}
      error={error}
      busy={running !== null}
      wide
      className="request-dialog"
      onCancel={onCancel}
      buttons={
        <>
          {browserButton}
          <span className="spacer" />
          <button className="secondary-button" onClick={onCancel} disabled={running !== null}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={() => void create()} disabled={!canCreate}>
            {running === "push" ? `Pushing ${local}…` : running === "create" ? "Opening…" : `${willPush ? "Push and open" : "Open"} ${noun}`}
          </button>
        </>
      }
    >
      {!info ? (
        <Loader size={56} title="Reading its commits" />
      ) : (
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="request-branches">
            <span className="request-branch mono" title={`${info.remote}/${branch}`}>
              {branch}
            </span>
            <span className="request-into">into</span>
            <select className="text-input mono request-base" value={base} onChange={(event) => setBase(event.target.value)} aria-label="The branch to merge it into">
              {info.bases
                .filter((name) => name !== branch)
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
            {info.commits.length > 0 && <span className="request-commits">{plural(info.commits.length, "commit")}</span>}
          </div>
          <label className="field">
            <span>Title</span>
            <input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus spellCheck />
          </label>
          <label className="field">
            <span>Description</span>
            <MarkdownField
              className="request-body"
              rows={8}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What it changes and why, how to try it…"
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
            Draft: not ready for review yet
          </label>
          {info.owners.length > 0 && (
            <div className="request-owners" role="group" aria-label="Ask for reviews">
              <span className="request-owners-label">Ask the owners of the files it changes to review (CODEOWNERS):</span>
              <div className="request-owner-list">
                {info.owners.slice(0, 12).map((owner) => {
                  const askable = canAsk(owner, info.forge);
                  return (
                    <label
                      key={owner}
                      className="checkbox"
                      title={askable ? undefined : info.forge === "gitlab" && owner.includes("/") ? "GitLab can't ask a group" : "Only people with an account can be asked"}
                    >
                      <input
                        type="checkbox"
                        disabled={!askable}
                        checked={reviewers.includes(owner)}
                        onChange={(event) => setReviewers((now) => (event.target.checked ? [...now, owner] : now.filter((name) => name !== owner)))}
                      />
                      <span className="mono">{owner}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {checkedOut && unpushed > 0 && (
            <label className="checkbox">
              <input type="checkbox" checked={pushFirst || mustPush} disabled={mustPush} onChange={(event) => setPushFirst(event.target.checked)} />
              {mustPush ? `Push ${local} to ${info.remote} first (it isn't there yet)` : `Push ${local}'s ${plural(unpushed, "new commit")} first`}
            </label>
          )}
          {!checkedOut && local && unpushed > 0 && (
            <p className="dialog-note-line">
              {mustPush
                ? `${local} isn't on ${info.remote} yet: check it out and push it first.`
                : `${plural(unpushed, "commit")} of ${local} aren't pushed yet, so they won't be part of it until you push them.`}
            </p>
          )}
          {!info.signedIn && (
            <p className="dialog-note-line request-sign-in">
              {info.forge === "github" ? (
                <>
                  To open it from here, sign in to GitHub.{" "}
                  <button type="button" className="link-button" onClick={signIn}>
                    Sign in…
                  </button>
                </>
              ) : (
                "Git has no token for this GitLab server yet (pushing or fetching once signs in): open it on GitLab instead."
              )}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
