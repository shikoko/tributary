import { useCallback, useEffect, useState } from "react";
import { gitInstall, lookForGit, type GitInstall } from "../api";

/**
 * Where git is, asked once when the app starts. While it's missing, it's looked for again
 * each time the window comes back (after installing it, say), and on "Check again".
 * `onFound` runs when it turns up.
 */
export function useGitInstall(onFound: () => void) {
  const [install, setInstall] = useState<GitInstall | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    gitInstall()
      .then(setInstall)
      .catch(() => {});
  }, []);
  const missing = install !== null && install.path === null;
  const lookAgain = useCallback(async () => {
    setChecking(true);
    try {
      const found = await lookForGit();
      setInstall(found);
      if (found.path) onFound();
      return found;
    } finally {
      setChecking(false);
    }
  }, [onFound]);
  useEffect(() => {
    if (!missing) return;
    const again = () => void lookAgain().catch(() => {});
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [missing, lookAgain]);
  return { install, missing, checking, lookAgain };
}
export type GitInstallState = ReturnType<typeof useGitInstall>;
