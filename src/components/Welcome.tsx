import type { RecentRepo } from "../lib/recent";
import { avatarColor } from "../lib/colors";
import { modKey } from "../lib/platform";
import { CloseIcon, FolderIcon, Logo } from "./Icons";

interface Props {
  recent: RecentRepo[];
  /** The path being opened, while it loads. */
  opening: string | null;
  error: string | null;
  onPick: () => void;
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
}

export function Welcome({ recent, opening, error, onPick, onOpen, onForget }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo size={76} />
        <h1>Tributary</h1>
        <p className="tagline">See the history of a git repository as a graph.</p>

        <button className="primary-button" onClick={onPick} disabled={opening !== null}>
          <FolderIcon />
          Open repository…
          <kbd>{modKey}O</kbd>
        </button>

        {opening && <div className="welcome-status">Opening {opening}…</div>}
        {error && <div className="error-banner">{error}</div>}

        {recent.length > 0 && (
          <section className="recent">
            <h2>Recent</h2>
            <ul>
              {recent.map((repo) => (
                <li key={repo.path}>
                  <button className="recent-item" onClick={() => onOpen(repo.path)} disabled={opening !== null}>
                    <span className="recent-dot" style={{ background: avatarColor(repo.path) }} />
                    <span className="recent-name">{repo.name}</span>
                    <span className="recent-path">{repo.path}</span>
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => onForget(repo.path)}
                    title="Remove from recent"
                    aria-label={`Remove ${repo.name} from recent`}
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
