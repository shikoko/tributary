import { forgetRepo, pinRepo } from "../lib/recent";
import { isMac } from "../lib/platform";
import { Welcome } from "../components/Welcome";
import type { Repository } from "./useRepository";

interface Props {
  repo: Repository;
  /** The tab bar is showing (it isn't on macOS before anything was opened). */
  tabBar: boolean;
  onClone: () => void;
}

/** The start screen: open, clone or create a repository, or pick a recent one. */
export function StartView({ repo, tabBar, onClone }: Props) {
  const { recent, setRecent, busy, error } = repo;
  return (
    <>
      {!tabBar && isMac && <div className="window-drag-strip" data-tauri-drag-region />}
      <Welcome
        recent={recent}
        opening={busy?.kind === "open" ? busy.path : null}
        error={error?.message ?? null}
        onPick={repo.pick}
        onClone={onClone}
        onCreate={repo.create}
        onOpen={(path) => repo.load(path, "open")}
        onForget={(path) => setRecent(forgetRepo(path))}
        onPin={(path, pinned) => setRecent(pinRepo(path, pinned))}
      />
    </>
  );
}

