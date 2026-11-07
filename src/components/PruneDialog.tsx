import { useEffect, useState } from "react";
import { pruneCandidates, runAction, type BranchTip, type PruneCandidate, type PruneInfo } from "../api";
import { compactTime } from "../lib/format";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  /** Fetch first (which prunes deleted remote branches), so "gone" is up to date. */
  fetchFirst: boolean;
  /** Full names of the refs pinned in the sidebar: never offered. */
  pinned: string[];
  /** Protected branch names: never offered. */
  protectedNames: string[];
  onCancel: () => void;
  onDelete: (branches: BranchTip[]) => void;
}

/** The remote a branch tracked, from its upstream, like "origin". */
function remoteOf(candidate: PruneCandidate): string {
  return candidate.remote ?? candidate.upstream?.split("/")[0] ?? "its remote";
}

/**
 * Clean up local branches: those whose remote branch was deleted (usually merged pull
 * requests) and those merged into the main branch. Branches whose commits are all in the
 * main branch are ticked; the others are listed, unticked, with what would be lost.
 */
export function PruneDialog({ repoPath, fetchFirst, pinned, protectedNames, onCancel, onDelete }: Props) {
  const [stage, setStage] = useState<"fetching" | "reading" | "ready">(fetchFirst ? "fetching" : "reading");
  const [info, setInfo] = useState<PruneInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    (async () => {
      if (fetchFirst) {
        try {
          await runAction(repoPath, { kind: "fetch", background: true });
        } catch {
          if (live) setOffline(true);
        }
      }
      if (!live) return;
      setStage("reading");
      try {
        const found = await pruneCandidates(repoPath);
        if (!live) return;
        const candidates = found.candidates.filter(
          (candidate) => !pinned.includes(`refs/heads/${candidate.name}`) && !protectedNames.includes(candidate.name),
        );
        setInfo({ ...found, candidates });
        setChosen(new Set(candidates.filter((candidate) => candidate.merged).map((candidate) => candidate.name)));
      } catch (e) {
        if (live) setError(String(e));
      }
      if (live) setStage("ready");
    })();
    return () => {
      live = false;
    };
    // Runs once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidates = info?.candidates ?? [];
  const base = info?.base ?? "the main branch";
  const toggle = (name: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allChosen = candidates.length > 0 && chosen.size === candidates.length;
  const risky = candidates.filter((candidate) => !candidate.merged);
  const riskyChosen = risky.filter((candidate) => chosen.has(candidate.name));

  const remove = () =>
    onDelete(
      candidates
        .filter((candidate) => chosen.has(candidate.name))
        .map(({ name, id, remote, merge }) => ({ name, id, remote, merge })),
    );

  return (
    <Dialog
      title="Prune branches"
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          {candidates.length > 0 && (
            <button className="link-button dialog-note" onClick={() => setChosen(new Set(allChosen ? [] : candidates.map((c) => c.name)))}>
              {allChosen ? "Select none" : "Select all"}
            </button>
          )}
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" disabled={chosen.size === 0} onClick={remove}>
            {chosen.size === 1 ? "Delete 1 branch" : `Delete ${chosen.size} branches`}
          </button>
        </>
      }
    >
      {stage !== "ready" ? (
        <p className="hint">{stage === "fetching" ? "Fetching, to see which branches are gone from the remote…" : "Looking at your branches…"}</p>
      ) : candidates.length === 0 ? (
        !error && (
          <p className="hint">
            Nothing to prune: no local branches are merged into {base} or gone from their remote. The checked-out branch,
            long-lived ones like main, and protected or pinned branches are never offered.
          </p>
        )
      ) : (
        <>
          <p className="hint">
            Local branches whose remote branch was deleted, or whose commits are all in {base}. Those are ticked; the
            remote branches aren't touched. You can undo this.
          </p>
          {offline && <p className="dialog-note-line">Couldn't reach the remote, so this is as of the last fetch.</p>}
          <ul className="prune-list">
            {candidates.map((candidate) => (
              <li key={candidate.name} className={`prune-row${chosen.has(candidate.name) ? " chosen" : ""}`}>
                <label>
                  <input type="checkbox" checked={chosen.has(candidate.name)} onChange={() => toggle(candidate.name)} />
                  <span className="prune-main">
                    <span className="prune-top">
                      <span className="prune-name">{candidate.name}</span>
                      {candidate.gone && <span className="prune-tag gone">gone from {remoteOf(candidate)}</span>}
                      {candidate.merged ? (
                        <span className="prune-tag merged">merged</span>
                      ) : (
                        <span className="prune-tag unmerged">
                          {candidate.unmerged} {candidate.unmerged === 1 ? "commit" : "commits"} not in {base}
                        </span>
                      )}
                    </span>
                    <span className="prune-summary">{candidate.summary}</span>
                  </span>
                  <span className="prune-when">{compactTime(candidate.time)}</span>
                </label>
              </li>
            ))}
          </ul>
          {risky.length > 0 && (
            <div className="dialog-warning">
              {riskyChosen.length > 0
                ? `${riskyChosen.map((c) => c.name).join(", ")} ${riskyChosen.length === 1 ? "has" : "have"} commits that aren't in ${base}. If ${riskyChosen.length === 1 ? "it was" : "they were"} squash-merged, that's expected; otherwise that work is only in this repository.`
                : `Branches with commits that aren't in ${base} are left unticked. They're often squash-merged pull requests, but check before deleting them.`}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
