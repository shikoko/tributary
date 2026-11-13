import type { CommitRow, Identity } from "../api";
import { coAuthorCandidates, recentMessages, type Person } from "../lib/commitMessage";
import type { MenuItem } from "./ContextMenu";
import { HistoryIcon, UserIcon } from "./Icons";

interface Props {
  commits: CommitRow[];
  you: Identity | null;
  onUseMessage: (commit: CommitRow) => void;
  onAddCoAuthor: (person: Person) => void;
  openMenu: (anchor: HTMLElement, items: MenuItem[], width: number) => void;
}

/** Above the commit message: start from a recent message of yours, or credit a co-author. */
export function MessageTools({ commits, you, onUseMessage, onAddCoAuthor, openMenu }: Props) {
  const recent = recentMessages(commits, you);
  const people = coAuthorCandidates(commits, you);
  return (
    <div className="message-tools">
      <button
        className="message-tool"
        disabled={recent.length === 0}
        onClick={(event) =>
          openMenu(
            event.currentTarget,
            recent.map((commit) => ({ label: commit.summary, icon: <HistoryIcon />, onSelect: () => onUseMessage(commit) })),
            360,
          )
        }
        title="Start from one of your recent commit messages"
      >
        <HistoryIcon size={12} />
        <span className="button-label">Recent messages</span>
      </button>
      <button
        className="message-tool"
        disabled={people.length === 0}
        onClick={(event) =>
          openMenu(
            event.currentTarget,
            people.map((person) => ({ label: `${person.name} <${person.email}>`, icon: <UserIcon />, onSelect: () => onAddCoAuthor(person) })),
            360,
          )
        }
        title="Credit someone who worked on this with you"
      >
        <UserIcon size={12} />
        <span className="button-label">Add co-author</span>
      </button>
    </div>
  );
}
