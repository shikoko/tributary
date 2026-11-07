import { useCallback, useEffect, useState } from "react";
import { gitHubStatus, type GitHubStatus } from "../api";

/**
 * Who's signed in to GitHub, asked for once `active` (the Settings window is open), and
 * again after `recheck`. Null until known.
 */
export function useGitHubStatus(active: boolean) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    gitHubStatus()
      .then((found) => {
        if (!live) return;
        setStatus(found);
        setError(null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [active, checks]);
  const recheck = useCallback(() => setChecks((count) => count + 1), []);
  return { status, error, recheck };
}
