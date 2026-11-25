import { useEffect, useState } from "react";
import { branchesToPush, type BranchToPush, type BranchesToPush } from "../api";
import { compactTime, plural } from "../lib/format";
import { Dialog } from "./Dialog";
import { BranchIcon } from "./Icons";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  repoPath: string;
  onCancel: () => void;
  /** `names`: branches here; `remembered`: the remote's own, remembered from its last fetch. */
  onPush: (names: string[], remote: string, remembered: string[]) => void;
}

/** "main", "main and dev", or "main, dev and docs". */
const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Ticked to start with: those on the remote already (only ahead of their branch there), and
 * those that push to it but that it doesn't have. One never pushed isn't, as pushing shares it
 * with everyone; nor one only remembered from the remote, unless the remote has none of those
 * (it's new, or emptied, as when a repository moves).
 */
const ticked = (branch: BranchToPush, found: BranchesToPush) =>
  branch.reason === "ahead" || branch.reason === "missing" || (branch.reason === "remembered" && found.fresh);

/** Each branch's key in the choice: a remembered one's apart, as it can share a name. */
const keyOf = (branch: BranchToPush) => `${branch.reason === "remembered" ? "remembered" : "here"}:${branch.name}`;

/**
 * The branches with commits the remote doesn't have, asked of the remote itself, to push
 * several at once: those here, then those only remembered from the remote's last fetch that
 * it no longer has. One behind its branch there isn't offered: the push would be refused
 * until it's pulled.
 */
export function PushBranchesDialog({ repoPath, onCancel, onPush }: Props) {
  const [found, setFound] = useState<BranchesToPush | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    branchesToPush(repoPath, null)
      .then((result) => {
        if (!live) return;
        setFound(result);
        setChosen(new Set(result.branches.filter((branch) => ticked(branch, result)).map(keyOf)));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [repoPath]);

  const branches = found?.branches ?? [];
  const here = branches.filter((branch) => branch.reason !== "remembered");
  const remembered = branches.filter((branch) => branch.reason === "remembered");
  const remote = found?.remote ?? "the remote";
  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allChosen = branches.length > 0 && chosen.size === branches.length;
  // In the order they're listed: the newest first.
  const push = () =>
    found &&
    onPush(
      here.filter((branch) => chosen.has(keyOf(branch))).map((branch) => branch.name),
      found.remote,
      remembered.filter((branch) => chosen.has(keyOf(branch))).map((branch) => branch.name),
    );
  const behind = found?.behind ?? [];

  const chip = (branch: BranchToPush) => {
    switch (branch.reason) {
      case "ahead":
        return (
          <Chip className="prune-tag merged" title={`${plural(branch.ahead, "commit")} that ${branch.onRemote} doesn't have`}>
            {`↑${branch.ahead} to push`}
          </Chip>
        );
      case "missing":
        return (
          <Chip className="prune-tag merged" title={`${branch.name} pushes to ${remote}, which doesn't have its branch: pushing puts it there`}>
            {`not on ${remote}`}
          </Chip>
        );
      case "new":
        return (
          <Chip className="prune-tag idle" title={`Pushing makes ${remote}/${branch.name}, which it then pulls from and pushes to`}>
            never pushed
          </Chip>
        );
      case "remembered":
        return (
          <Chip className="prune-tag idle" title={`${remote} had it at the last fetch, and doesn't now: pushing puts it back as it was`}>
            {branch.ahead > 0 ? `${plural(branch.ahead, "commit")} only here` : `not on ${remote} now`}
          </Chip>
        );
    }
  };
  const rows = (list: BranchToPush[]) => (
    <ul className="prune-list push-branches-list">
      {list.map((branch) => (
        <li key={keyOf(branch)} className={`prune-row${chosen.has(keyOf(branch)) ? " chosen" : ""}`}>
          <label>
            <input type="checkbox" checked={chosen.has(keyOf(branch))} onChange={() => toggle(keyOf(branch))} />
            <span className="prune-main">
              <span className="prune-top">
                <span className="ref-pill">
                  <BranchIcon size={12} />
                  <span className="ref-name">{branch.name}</span>
                </span>
                {chip(branch)}
              </span>
              <span className="prune-summary">{branch.summary}</span>
            </span>
            <span className="prune-when">{compactTime(branch.time)}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog
      title={found ? `Push branches to ${remote}` : "Push branches"}
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          {branches.length > 1 && (
            <Button kind="link" className="dialog-note" onClick={() => setChosen(new Set(allChosen ? [] : branches.map(keyOf)))}>
              {allChosen ? "Select none" : "Select all"}
            </Button>
          )}
          <Button kind="secondary" onClick={onCancel}>
            {branches.length === 0 ? "Close" : "Cancel"}
          </Button>
          {branches.length > 0 && (
            <Button kind="primary" disabled={chosen.size === 0} onClick={push}>
              {chosen.size === 1 ? "Push 1 branch" : `Push ${chosen.size} branches`}
            </Button>
          )}
        </>
      }
    >
      {!found ? (
        !error && <p className="hint">Asking {remote} what it has…</p>
      ) : (
        <>
          {found.checked ? (
            <p className="push-checked">
              <span className="push-checked-dot" aria-hidden />
              {branches.length === 0 ? `Checked with ${found.address} just now: every branch here is on it as it is here.` : `Checked with ${found.address} just now.`}
            </p>
          ) : (
            <p className="hint warning">
              {`${remote} couldn't be reached (${(found.problem ?? "").split("\n")[0]}), so this is as of the last fetch.`}
              {branches.length === 0 && ` Every branch here was on it then.`}
            </p>
          )}
          {here.length > 0 && (
            <>
              <p className="hint">
                Branches with commits {remote} doesn't have. Those it has, or that push to it, are ticked; one you've never pushed isn't, as pushing shares it
                with everyone who fetches.
              </p>
              {rows(here)}
            </>
          )}
          {remembered.length > 0 && (
            <>
              <h3 className="push-section">{`Only remembered from ${remote} · no branch here`}</h3>
              <p className="hint">
                {found.fresh
                  ? `${remote} has none of the branches it had at the last fetch: it's new, or it was emptied. Pushing these puts them there as they were.`
                  : `${remote} had these at the last fetch and doesn't now: deleted there, perhaps. Pushing one puts it back.`}
              </p>
              {rows(remembered)}
            </>
          )}
        </>
      )}
      {behind.length > 0 && (
        <p className="dialog-note-line">
          {listed(behind)} {behind.length === 1 ? "is" : "are"} behind {remote}, so {behind.length === 1 ? "it isn't" : "they aren't"} offered: pull first, or
          the push would be refused.
        </p>
      )}
    </Dialog>
  );
}
