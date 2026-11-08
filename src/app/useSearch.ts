import { useMemo, useRef, useState } from "react";
import type { CommitRow } from "../api";
import { findMatches, stepThrough } from "../lib/search";

/** Searching commits: matches are highlighted, and Enter / Shift+Enter move between them. */
export function useSearch(commits: CommitRow[] | undefined, select: (id: string) => void, selectedIndex: number | undefined) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => (commits ? findMatches(commits, query) : []), [commits, query]);
  const matchIds = useMemo(
    () => (query.trim() && commits ? new Set(matches.map((index) => commits[index].id)) : null),
    [matches, query, commits],
  );

  /** Search for `text`, jumping to the first match as you type. */
  const search = (text: string) => {
    setQuery(text);
    const first = commits ? findMatches(commits, text)[0] : undefined;
    if (commits && first !== undefined) select(commits[first].id);
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
    input,
    matches,
    matchIds,
    search,
    step,
    focus,
    clear: () => setQuery(""),
    /** "3 of 12", for the search field. */
    position: { query, total: matches.length, current: selectedIndex !== undefined ? matches.indexOf(selectedIndex) + 1 : 0 },
  };
}
export type Search = ReturnType<typeof useSearch>;
