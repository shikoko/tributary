// CI for every commit: each commit's overall state, for a dot in the list.
import { createContext, useEffect, useState } from "react";
import { commitStates, type RepoSnapshot } from "../api";

export type CiState = "success" | "failure" | "pending";

/** Each commit's CI state (those with one), by full id. */
export const CiStatesContext = createContext<Map<string, CiState>>(new Map());

/** The newest commits are asked about: those people look at. */
const NEWEST = 60;
/** While some are running, they're asked about again this often. */
const POLL = 60_000;

/** "Checks passed", for a dot's tooltip. */
export function describeCiState(state: CiState): string {
  return { success: "Checks passed", failure: "Checks failed", pending: "Checks running" }[state];
}

/** The CI states of the repository's newest commits, when it's on GitHub or GitLab. */
export function useCiStates(snapshot: RepoSnapshot | null): Map<string, CiState> {
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
    // The signature stands for the ids; `round` asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, onSite, signature, round]);
  // Running checks: ask again in a while.
  const running = [...states.values()].includes("pending");
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setRound((n) => n + 1), POLL);
    return () => window.clearTimeout(timer);
  }, [running, round]);
  return states;
}
