import { useEffect, useMemo, useRef, useState } from "react";
import { searchCommits, searchOverview, type CommitRow } from "../api";
import type { SearchOverview, SearchResult } from "../api/generated";
import { findMatches, findRefMatches, searchPrefix, stepThrough } from "../lib/search";

/**
 * What the search box looks in: everything at once (with the results by kind beside the
 * history), or one kind: messages, authors, branches and tags, commit ids, files' paths, or
 * code.
 */
export type SearchMode = "everything" | "messages" | "authors" | "refs" | "hashes" | "files" | "code";

/** How long typing has to pause before git is asked. */
const DEBOUNCE = 350;

/** What git found for everything at once: the overview, and the code (which comes later). */
export interface EverythingFound {
  overview: SearchOverview | null;
  code: SearchResult | null;
  error: string | null;
}

/**
 * Searching commits: matches are highlighted, and Enter / Shift+Enter move between them.
 * Branches and tags are searched among the loaded commits as you type; the other kinds in
 * every branch's whole history by git, and the loaded commits among them highlighted.
 * Everything searches all of them, and lists what it found by kind (SearchResults).
 */
export function useSearch(commits: CommitRow[] | undefined, select: (id: string) => void, selectedIndex: number | undefined, repoPath: string | null) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("everything");
  const input = useRef<HTMLInputElement>(null);
  /** git's answer for a search of one kind. */
  const [found, setFound] = useState<{ key: string; ids: Set<string>; truncated: boolean; error: string | null } | null>(null);
  /** git's answers for everything at once. */
  const [everything, setEverything] = useState<{ key: string } & EverythingFound>({ key: "", overview: null, code: null, error: null });
  const key = JSON.stringify([repoPath, mode, query.trim()]);
  const remote = mode !== "refs" && query.trim() !== "";
  const current = remote && mode !== "everything" && found?.key === key ? found : null;
  const all = mode === "everything" && everything.key === key ? everything : null;
  /** Jump to the first match when git's answer comes. */
  const jump = useRef(false);

  useEffect(() => {
    if (!remote || !repoPath) return;
    const kind = mode;
    let live = true;
    const timer = window.setTimeout(() => {
      if (kind === "everything") {
        const empty = { overview: null, code: null, error: null };
        const fail = (e: unknown) => live && setEverything((was) => ({ ...(was.key === key ? was : empty), key, error: String(e) }));
        // The overview first; code takes longer, and fills in when it comes.
        searchOverview(repoPath, query)
          .then((overview) => live && setEverything((was) => ({ ...(was.key === key ? was : empty), key, overview })))
          .catch(fail);
        searchCommits(repoPath, "code", query)
          .then((code) => live && setEverything((was) => ({ ...(was.key === key ? was : empty), key, code })))
          .catch(fail);
        return;
      }
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

  /** Every commit found for everything at once, by id. */
  const allIds = useMemo(() => {
    if (!all) return null;
    const overview = all.overview;
    return new Set([...(overview?.messages.ids ?? []), ...(overview?.fileCommits.ids ?? []), ...(overview?.hashes.ids ?? []), ...(all.code?.ids ?? [])]);
  }, [all]);

  const matches = useMemo(() => {
    if (!commits) return [];
    if (mode === "refs") return findRefMatches(commits, query);
    if (mode === "everything") {
      // The loaded commits that match by their summary, author, branches, tags or id, as you
      // type, and the ones git found in their messages, files or code once it answers.
      const quick = new Set(findMatches(commits, query));
      return commits.flatMap((commit, index) => (quick.has(index) || allIds?.has(commit.id) ? [index] : []));
    }
    if (!current) return [];
    return commits.flatMap((commit, index) => (current.ids.has(commit.id) ? [index] : []));
  }, [commits, query, mode, current, allIds]);
  // Nothing is dimmed while git is still looking for one kind.
  const waiting = remote && mode !== "everything" && !current;
  const matchIds = useMemo(
    () => (query.trim() && commits && !waiting ? new Set(matches.map((index) => commits[index].id)) : null),
    [matches, query, commits, waiting],
  );

  useEffect(() => {
    if (!current || !jump.current || !commits) return;
    jump.current = false;
    if (matches[0] !== undefined) select(commits[matches[0]].id);
  }, [current, matches, commits, select]);

  /**
   * Search for `text`, jumping to the first match as you type (or when git answers). A
   * prefix like `author:` or `tag:` searches that kind.
   */
  const search = (text: string) => {
    const prefix = searchPrefix(text);
    let next = mode;
    if (prefix) {
      next = prefix.mode;
      setMode(next);
      text = prefix.rest;
    }
    setQuery(text);
    if (next !== "refs" && next !== "everything") {
      jump.current = true;
      return;
    }
    const first = commits ? (next === "refs" ? findRefMatches(commits, text) : findMatches(commits, text))[0] : undefined;
    if (commits && first !== undefined) select(commits[first].id);
  };

  const changeMode = (next: SearchMode) => {
    setMode(next);
    jump.current = next !== "refs" && next !== "everything";
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

  /** Commits git found for the search that aren't among the loaded ones. */
  const loaded = useMemo(() => new Set(commits?.map((commit) => commit.id)), [commits]);
  const foundIds = mode === "everything" ? allIds : (current?.ids ?? null);
  const notLoaded = foundIds ? [...foundIds].filter((id) => !loaded.has(id)).length : 0;

  return {
    query,
    mode,
    input,
    matches,
    matchIds,
    search,
    setMode: changeMode,
    /** Search `text` in one kind: Show all, an author or a file from Everything's results. */
    searchKind: (kind: SearchMode, text: string) => {
      changeMode(kind);
      setQuery(text);
    },
    step,
    focus,
    clear: () => setQuery(""),
    /** What Everything found, by kind (null when it isn't searching everything). */
    everything: mode === "everything" && query.trim() ? { query: query.trim(), found: all, searching: !all?.overview || !all.code } : null,
    /** "3 of 12", for the search field, and how a search of git is going. */
    position: {
      query,
      mode,
      total: matches.length,
      current: selectedIndex !== undefined ? matches.indexOf(selectedIndex) + 1 : 0,
      /** git hasn't answered yet (for everything, the loaded commits that match count meanwhile). */
      searching: remote && (mode === "everything" ? !all?.overview && matches.length === 0 : !current),
      /** Commits git found that aren't among the loaded ones. */
      notLoaded,
      truncated: current?.truncated ?? false,
      error: current?.error ?? all?.error ?? null,
    },
  };
}
export type Search = ReturnType<typeof useSearch>;
