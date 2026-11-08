import { useEffect, useMemo, useRef, useState } from "react";
import { searchCommits, type CommitRow } from "../api";
import { findMatches, stepThrough } from "../lib/search";

/** What the search box looks in: messages (and authors, branches, SHAs), files' paths, or code. */
export type SearchMode = "message" | "files" | "code";

/** How long typing has to pause before git is asked (files and code). */
const DEBOUNCE = 350;

/**
 * Searching commits: matches are highlighted, and Enter / Shift+Enter move between them.
 * Messages are searched among the loaded commits as you type; files and code are searched
 * in every branch's whole history by git, and the loaded commits among them highlighted.
 */
export function useSearch(commits: CommitRow[] | undefined, select: (id: string) => void, selectedIndex: number | undefined, repoPath: string | null) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("message");
  const input = useRef<HTMLInputElement>(null);
  /** git's answer for a file or code search. */
  const [found, setFound] = useState<{ key: string; ids: Set<string>; truncated: boolean; error: string | null } | null>(null);
  const key = JSON.stringify([repoPath, mode, query.trim()]);
  const remote = mode !== "message" && query.trim() !== "";
  const current = remote && found?.key === key ? found : null;
  /** Jump to the first match when git's answer comes. */
  const jump = useRef(false);

  useEffect(() => {
    if (!remote || !repoPath) return;
    const kind = mode;
    let live = true;
    const timer = window.setTimeout(() => {
      searchCommits(repoPath, kind, query)
        .then((result) => live && setFound({ key, ids: new Set(result.ids), truncated: result.truncated, error: null }))
        .catch((e) => live && setFound({ key, ids: new Set(), truncated: false, error: String(e) }));
    }, DEBOUNCE);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `key` covers the query and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, remote]);

  const matches = useMemo(() => {
    if (!commits) return [];
    if (mode === "message") return findMatches(commits, query);
    if (!current) return [];
    return commits.flatMap((commit, index) => (current.ids.has(commit.id) ? [index] : []));
  }, [commits, query, mode, current]);
  // Nothing is dimmed while git is still looking.
  const waiting = remote && !current;
  const matchIds = useMemo(
    () => (query.trim() && commits && !waiting ? new Set(matches.map((index) => commits[index].id)) : null),
    [matches, query, commits, waiting],
  );

  useEffect(() => {
    if (!current || !jump.current || !commits) return;
    jump.current = false;
    if (matches[0] !== undefined) select(commits[matches[0]].id);
  }, [current, matches, commits, select]);

  /** Search for `text`, jumping to the first match as you type (or when git answers). */
  const search = (text: string) => {
    setQuery(text);
    if (mode !== "message") {
      jump.current = true;
      return;
    }
    const first = commits ? findMatches(commits, text)[0] : undefined;
    if (commits && first !== undefined) select(commits[first].id);
  };

  const changeMode = (next: SearchMode) => {
    setMode(next);
    jump.current = next !== "message";
    input.current?.focus();
  };

  const step = (direction: 1 | -1) => {
    const next = stepThrough(matches, selectedIndex ?? -1, direction);
    if (commits && next !== undefined) select(commits[next].id);
  };

  const focus = () => {
    input.current?.focus();
    input.current?.select();
  };

  return {
    query,
    mode,
    input,
    matches,
    matchIds,
    search,
    setMode: changeMode,
    step,
    focus,
    clear: () => setQuery(""),
    /** "3 of 12", for the search field, and how a file or code search is going. */
    position: {
      query,
      mode,
      total: matches.length,
      current: selectedIndex !== undefined ? matches.indexOf(selectedIndex) + 1 : 0,
      /** git hasn't answered yet. */
      searching: remote && !current,
      /** Commits git found that aren't among the loaded ones. */
      notLoaded: current ? current.ids.size - matches.length : 0,
      truncated: current?.truncated ?? false,
      error: current?.error ?? null,
    },
  };
}
export type Search = ReturnType<typeof useSearch>;
