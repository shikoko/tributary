import { Fragment } from "react";
import type { SinceLastHere } from "../app/useSinceLastHere";
import { sinceItems, sinceWhen } from "../lib/sinceHere";
import { ClockIcon, CloseIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  since: SinceLastHere;
  remotes: string[];
  /** Go to a commit: where you left off, a request's merge, a locked file's change. */
  onGo: (id: string) => void;
  onDismiss: () => void;
}

/**
 * What arrived since you were last here, in one line above the list: the new commits and who
 * wrote them, the requests merged, and your locked files someone else changed. Nothing moves
 * until a part of it is clicked.
 */
export function SinceBanner({ since, remotes, onGo, onDismiss }: Props) {
  const items = sinceItems(since.branches, remotes);
  if (items.length === 0) return null;
  return (
    <div className="notice-banner info since-banner" role="status">
      <ClockIcon size={14} />
      <span>
        Since {sinceWhen(since.at)}:{" "}
        {items.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="since-dot"> · </span>}
            <button className="link-button since-link" title={item.title} onClick={() => onGo(item.to)}>
              {item.link}
            </button>
            {item.rest}
          </Fragment>
        ))}
      </span>
      <Button kind="icon" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <CloseIcon size={14} />
      </Button>
    </div>
  );
}
