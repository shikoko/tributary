import { forgetRepo, pinRepo } from "../lib/recent";
import { isMac } from "../lib/platform";
import { Welcome } from "../components/Welcome";
import type { Accounts, Forge } from "./useAccounts";
import type { Repository } from "./useRepository";
import { useRecentSummaries } from "./useRecentSummaries";

interface Props {
  repo: Repository;
  /** The tab bar is showing (it isn't on macOS before anything was opened). */
  tabBar: boolean;
  onClone: () => void;
  accounts: Accounts;
  onSignIn: (forge: Forge) => void;
}

/** The start screen: open, clone or create a repository, or pick a recent one. */
export function StartView({ repo, tabBar, onClone, accounts, onSignIn }: Props) {
  const { recent, setRecent, busy, error } = repo;
  const summaries = useRecentSummaries(recent, true);
  return (
    <>
      {!tabBar && isMac && <div className="window-drag-strip" data-tauri-drag-region />}
      <Welcome
        recent={recent}
        summaries={summaries}
        opening={busy?.kind === "open" ? busy.path : null}
        error={error?.message ?? null}
        onPick={repo.pick}
        onClone={onClone}
        onCreate={repo.create}
        onOpen={(path) => repo.load(path, "open")}
        onForget={(path) => setRecent(forgetRepo(path))}
        onPin={(path, pinned) => setRecent(pinRepo(path, pinned))}
        accounts={accounts}
        onSignIn={onSignIn}
      />
    </>
  );
}

