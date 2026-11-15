import { useEffect, useRef, useState } from "react";
import { pruneCandidates, runAction, type BranchTip, type PruneCandidate, type PruneInfo } from "../api";
import { compactTime, idleFor } from "../lib/format";
import { useStoredState } from "../lib/settings";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

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

/** How long without a commit makes a branch old, to choose from: off, or months. */
const IDLE_MONTHS = [0, 3, 6, 12];

/**
 * Clean up local branches: those whose remote branch was deleted (usually merged pull
 * requests), those merged into the main branch, and if you ask, old ones nobody has committed
 * to for months. Branches whose commits are all in the main branch are ticked; the others are
 * listed, unticked, with what would be lost.
 */
export function PruneDialog({ repoPath, fetchFirst, pinned, protectedNames, onCancel, onDelete }: Props) {
  const [stage, setStage] = useState<"fetching" | "reading" | "ready">(fetchFirst ? "fetching" : "reading");
  const [info, setInfo] = useState<PruneInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /** Old branches are offered too: those with no commits for this many months (0: not offered). */
  const [idleMonths, setIdleMonths] = useStoredState("prune.idleMonths", 0);
  /** The branches listed so far: a branch listed again keeps its tick, or lack of one. */
  const listed = useRef(new Set<string>());
  /** The latest reading, so an older one finishing late is ignored. */
  const reading = useRef(0);

  const read = async (months: number) => {
    const turn = ++reading.current;
    try {
      const found = await pruneCandidates(repoPath, months > 0 ? Math.round(months * 30.44) : null);
      if (turn !== reading.current) return;
      const candidates = found.candidates.filter(
        (candidate) => !pinned.includes(`refs/heads/${candidate.name}`) && !protectedNames.includes(candidate.name),
      );
      setInfo({ ...found, candidates });
      // Merged ones ticked the first time they're listed; ticks kept as they were after that.
      setChosen(
        (current) => new Set(candidates.filter((candidate) => (listed.current.has(candidate.name) ? current.has(candidate.name) : candidate.merged)).map((candidate) => candidate.name)),
      );
      for (const candidate of candidates) listed.current.add(candidate.name);
      setError(null);
    } catch (e) {
      if (turn === reading.current) setError(String(e));
    }
  };

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
      await read(idleMonths);
      if (live) setStage("ready");
    })();
    return () => {
      live = false;
    };
    // Runs once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseIdle = (months: number) => {
    setIdleMonths(months);
    void read(months);
  };
  const idleChoice = (
    <label className="prune-idle">
      Also old branches, with no commits in
      <select className="settings-select" value={idleMonths} onChange={(event) => chooseIdle(Number(event.target.value))}>
        {IDLE_MONTHS.map((months) => (
          <option key={months} value={months}>
            {months === 0 ? "(not offered)" : months === 12 ? "a year" : `${months} months`}
          </option>
        ))}
      </select>
    </label>
  );

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
            <Button kind="link" className="dialog-note" onClick={() => setChosen(new Set(allChosen ? [] : candidates.map((c) => c.name)))}>
              {allChosen ? "Select none" : "Select all"}
            </Button>
          )}
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="danger" disabled={chosen.size === 0} onClick={remove}>
            {chosen.size === 1 ? "Delete 1 branch" : `Delete ${chosen.size} branches`}
          </Button>
        </>
      }
    >
      {stage !== "ready" ? (
        <p className="hint">{stage === "fetching" ? "Fetching, to see which branches are gone from the remote…" : "Looking at your branches…"}</p>
      ) : candidates.length === 0 ? (
        !error && (
          <>
            <p className="hint">
              Nothing to prune: no local branches are merged into {base}, gone from their remote
              {idleMonths > 0 ? " or without commits for that long" : ""}. The checked-out branch, long-lived ones like main, and
              protected or pinned branches are never offered.
            </p>
            {idleChoice}
          </>
        )
      ) : (
        <>
          <p className="hint">
            Local branches whose remote branch was deleted, or whose commits are all in {base}
            {idleMonths > 0 ? ", and old ones nobody has committed to lately" : ""}. Those all in {base} are ticked; the remote
            branches aren't touched. You can undo this.
          </p>
          {idleChoice}
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
                      {candidate.idle && <span className="prune-tag idle">no commits for {idleFor(candidate.time)}</span>}
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
                : risky.some((candidate) => candidate.idle)
                  ? `Branches with commits that aren't in ${base} are left unticked. Some are squash-merged pull requests, but an old one may hold work that's nowhere else: check before deleting them.`
                  : `Branches with commits that aren't in ${base} are left unticked. They're often squash-merged pull requests, but check before deleting them.`}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
