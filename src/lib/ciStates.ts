// CI for every commit: each commit's overall state, for a dot in the list.
import { createContext, useEffect, useState } from "react";
import { commitStates, type RepoSnapshot } from "../api";

export type CiState = "success" | "failure" | "pending" | "cancelled";

/** Each commit's CI state (those with one), by full id. */
export const CiStatesContext = createContext<Map<string, CiState>>(new Map());

/** The newest commits are asked about: those people look at. */
const NEWEST = 60;
/** While some are running, they're asked about again this often. */
const POLL = 60_000;
/** While some have failed (and none are running), this often: failed checks are the ones
 *  people run again, on the site or with Re-run failed. */
const FAILED_POLL = 120_000;

/**
 * How long until the commits' states are asked about again, in ms: soon while some are
 * running, a little later while some have failed, and not at all once all have passed.
 */
export function askAgainIn(states: Iterable<CiState>): number | null {
  const known = new Set(states);
  return known.has("pending") ? POLL : known.has("failure") ? FAILED_POLL : null;
}

/** "Checks passed", for a dot's tooltip. */
export function describeCiState(state: CiState): string {
  return { success: "Checks passed", failure: "Checks failed", pending: "Checks running", cancelled: "Checks cancelled" }[state];
}

/**
 * The CI states of the repository's newest commits, when it's on GitHub or GitLab.
 * `nudge` changes when something else learns their checks changed (the pull requests'
 * badges, which are checked every minute): they're asked about again then, so a branch's
 * badge and its commit's dot don't disagree.
 */
export function useCiStates(snapshot: RepoSnapshot | null, nudge = ""): Map<string, CiState> {
  const [states, setStates] = useState<Map<string, CiState>>(new Map());
  const [round, setRound] = useState(0);
  const path = snapshot?.path ?? null;
  const onSite = Boolean(snapshot?.webRemotes.some((remote) => remote.host === "github" || remote.host === "gitlab"));
  const ids = (snapshot?.commits ?? [])
    .filter((commit) => commit.kind !== "stash" && commit.kind !== "worktree")
    .slice(0, NEWEST)
    .map((commit) => commit.id);
  const signature = ids.join(",");
  useEffect(() => {
    if (!path || !onSite || ids.length === 0) {
      setStates(new Map());
      return;
    }
    let current = true;
    commitStates(path, ids)
      .then((found) => current && setStates(new Map(Object.entries(found))))
      .catch(() => current && setStates(new Map()));
    return () => {
      current = false;
    };
    // The signature stands for the ids; `round` and `nudge` ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, onSite, signature, round, nudge]);
  // Running checks, or failed ones (which may be run again): ask again in a while.
  const wait = askAgainIn(states.values());
  useEffect(() => {
    if (wait === null) return;
    const timer = window.setTimeout(() => setRound((n) => n + 1), wait);
    return () => window.clearTimeout(timer);
  }, [wait, round]);
  return states;
}
