import { useEffect, useMemo, useState } from "react";
import { compareCommits, findCommit, type Comparison, type RequestDetails } from "../api";

/** A pull request's files, read here from its two commits, and how to open their changes. */
export interface RequestFiles {
  /** Changes with the pull request's commits: diffs from one aren't shown for another. */
  key: string | null;
  /** The files it changes since it split from the branch it goes into, once read. */
  comparison: Comparison | null;
  error: string | null;
  /** The site didn't say which commits it's between. */
  unknown: boolean;
  /** Its commits aren't in this repository yet: fetching them brings them. */
  missing: boolean;
}

/**
 * The files a pull request changes, as its site lists them: what its branch changed since
 * it split from the one it goes into. Read here, from its two commits (`details`' base and
 * head), once both are in the repository. Whether they are is asked of git, not of the
 * history on screen: a fork's commits are on no branch here. While they aren't, it's asked
 * again each time `reloaded` changes, as it does after a fetch.
 */
export function useRequestFiles(repoPath: string, details: RequestDetails | null, reloaded: unknown): RequestFiles {
  const baseSha = details?.baseSha ?? null;
  const headSha = details?.headSha ?? null;
  const sides = baseSha && headSha ? JSON.stringify([repoPath, baseSha, headSha]) : null;
  // Whether both commits are here, for `sides`.
  const [found, setFound] = useState<{ sides: string; here: boolean } | null>(null);
  const here = found && found.sides === sides ? found.here : null;
  useEffect(() => {
    if (!sides || !baseSha || !headSha || here) return;
    let current = true;
    Promise.all([findCommit(repoPath, baseSha), findCommit(repoPath, headSha)])
      .then(([base, head]) => current && setFound({ sides, here: Boolean(base && head) }))
      .catch(() => current && setFound({ sides, here: false }));
    return () => {
      current = false;
    };
    // `sides` covers the repository and the two commits; once they're here, they stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides, here, reloaded]);

  const key = here ? sides : null;
  const [loaded, setLoaded] = useState<{ key: string; comparison: Comparison | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!key || !baseSha || !headSha) return;
    let current = true;
    compareCommits(repoPath, baseSha, headSha, true)
      .then((comparison) => current && setLoaded({ key, comparison, error: null }))
      .catch((e) => current && setLoaded({ key, comparison: null, error: String(e) }));
    return () => {
      current = false;
    };
    // `key` covers the repository and the two commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown = loaded && loaded.key === key ? loaded : null;
  const missing = here === false;
  return useMemo(
    () => ({ key, comparison: shown?.comparison ?? null, error: shown?.error ?? null, unknown: Boolean(details && (!baseSha || !headSha)), missing }),
    [key, shown, details, baseSha, headSha, missing],
  );
}
