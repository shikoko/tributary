import { useEffect, useState } from "react";
import { tagsToPush, type TagsToPush } from "../api";
import { compactTime } from "../lib/format";
import { Dialog } from "./Dialog";
import { TagIcon } from "./Icons";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

interface Props {
  repoPath: string;
  onCancel: () => void;
  onPush: (names: string[], remote: string) => void;
}

/**
 * The tags here that the remote doesn't have yet, to choose which to push. Those on commits
 * the remote has (usually releases) are ticked; one on a commit only here (an experiment,
 * say, or a project's old tags in a copy of it) isn't, as a pushed tag is hard to take back.
 */
export function PushTagsDialog({ repoPath, onCancel, onPush }: Props) {
  const [found, setFound] = useState<TagsToPush | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    tagsToPush(repoPath, null)
      .then((result) => {
        if (!live) return;
        setFound(result);
        setChosen(new Set(result.tags.filter((tag) => tag.onRemote).map((tag) => tag.name)));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [repoPath]);

  const tags = found?.tags ?? [];
  const remote = found?.remote ?? "the remote";
  const toggle = (name: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allChosen = tags.length > 0 && chosen.size === tags.length;
  // In the order they're listed: newest first.
  const push = () => found && onPush(tags.filter((tag) => chosen.has(tag.name)).map((tag) => tag.name), found.remote);

  return (
    <Dialog
      title={found ? `Push tags to ${remote}` : "Push tags"}
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          {tags.length > 1 && (
            <Button kind="link" className="dialog-note" onClick={() => setChosen(new Set(allChosen ? [] : tags.map((tag) => tag.name)))}>
              {allChosen ? "Select none" : "Select all"}
            </Button>
          )}
          <Button kind="secondary" onClick={onCancel}>
            {tags.length === 0 ? "Close" : "Cancel"}
          </Button>
          {tags.length > 0 && (
            <Button kind="primary" disabled={chosen.size === 0} onClick={push}>
              {chosen.size === 1 ? "Push 1 tag" : `Push ${chosen.size} tags`}
            </Button>
          )}
        </>
      }
    >
      {!found ? (
        !error && <p className="hint">Asking the remote which tags it has…</p>
      ) : tags.length === 0 ? (
        <p className="hint">Every tag here is on {remote} already.</p>
      ) : (
        <>
          <p className="hint">
            Tags here that {remote} doesn't have yet. Those on commits {remote} already has, usually releases, are ticked. Once pushed, a
            tag is hard to take back: everyone who fetches gets it.
          </p>
          <ul className="prune-list push-tags-list">
            {tags.map((tag) => (
              <li key={tag.name} className={`prune-row${chosen.has(tag.name) ? " chosen" : ""}`}>
                <label>
                  <input type="checkbox" checked={chosen.has(tag.name)} onChange={() => toggle(tag.name)} />
                  <span className="prune-main">
                    <span className="prune-top">
                      <span className="ref-pill tag">
                        <TagIcon size={12} />
                        <span className="ref-name">{tag.name}</span>
                      </span>
                      {tag.onRemote ? (
                        <Chip className="prune-tag merged">{`on ${tag.onRemote}`}</Chip>
                      ) : (
                        <Chip className="prune-tag idle">{`commit not on ${remote} yet`}</Chip>
                      )}
                    </span>
                    <span className="prune-summary">{tag.summary}</span>
                  </span>
                  <span className="prune-when">{compactTime(tag.time)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {found && found.different.length > 0 && (
        <p className="dialog-note-line">
          {found.different.length === 1 ? `${found.different[0]} is` : `${found.different.join(", ")} are`} on {remote} too, but on another
          commit there, so {found.different.length === 1 ? "it isn't" : "they aren't"} offered: pushing would be refused.
        </p>
      )}
    </Dialog>
  );
}
