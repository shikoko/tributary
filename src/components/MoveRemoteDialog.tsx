import { useState } from "react";
import type { MoveCheck, RememberedChoice } from "../api";
import { plural } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";

interface Props {
  remote: string;
  /** Its address now, and what the new one has (see moveCheck). */
  from: string;
  check: MoveCheck;
  busy: boolean;
  onCancel: () => void;
  onMove: (then: RememberedChoice) => void;
}

/** "a", "a and b", or "a, b and c". */
const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The names, or, many, the first few and how many more. */
const some = (names: string[]) => (names.length <= 4 ? listed(names) : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

/** The branches here that go too, and the tags: "main, feature/export and the tags". */
const withTags = (names: string[]) =>
  listed([...(names.length <= 4 ? names : [...names.slice(0, 3), `${names.length - 3} more branches`]), "the tags"]);

/**
 * A remote's address is changing, and the new address doesn't have some of the branches
 * remembered from the old one, with no branch here: the next fetch would forget them, even
 * those whose commits are all on other branches (a main inside develop is still main). Copy
 * them to the new address (the repository moves over whole), keep them as branches here, or
 * let them go.
 */
export function MoveRemoteDialog({ remote, from, check, busy, onCancel, onMove }: Props) {
  const names = check.missing.map((branch) => branch.name);
  const one = names.length === 1;
  // Those with work found nowhere else here: letting them go loses it.
  const own = check.missing.filter((branch) => branch.commits > 0).map((branch) => branch.name);
  const lost = own.length === 0 ? null : own.length === names.length ? (one ? "Its work isn't anywhere else." : "Their work isn't anywhere else.") : `The work on ${some(own)} isn't anywhere else.`;
  const [then, setThen] = useState<RememberedChoice>(check.reached ? "copy" : "keep");
  const copied = names.length + check.local.length;
  const go: Record<RememberedChoice, string> = {
    copy: `Move and copy ${plural(copied, "branch", "branches")}`,
    keep: `Move and keep ${plural(names.length, "branch", "branches")}`,
    forget: one ? "Move and let it go" : "Move and let them go",
  };
  const choice = (value: RememberedChoice, label: string, hint: string) => (
    <label className={`merge-method${then === value ? " selected" : ""}`}>
      <input type="radio" name="move-remote" checked={then === value} onChange={() => setThen(value)} />
      <span className="merge-method-label">{label}</span>
      <span className="merge-method-hint">{hint}</span>
    </label>
  );
  return (
    <Dialog
      title={`Move ${remote} to a new address?`}
      wide
      busy={busy}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button kind={then === "forget" && lost ? "danger" : "primary"} onClick={() => onMove(then)} disabled={busy}>
            {go[then]}
          </Button>
        </>
      }
    >
      <div className="move-from">
        <span>From</span>
        <span className="mono move-old">{from}</span>
        <span>To</span>
        <span className="mono">{check.address}</span>
      </div>
      {!check.reached && (
        <p className="hint warning">
          {`The new address couldn't be reached (${(check.problem ?? "").split("\n")[0]}), so what it has isn't known: these are the branches it would lose if it has none of them.`}
        </p>
      )}
      <p>
        {check.reached ? "The new address doesn't have " : "That's "}
        <strong>{some(names)}</strong>
        {`. ${one ? "It's" : "They're"} only remembered from the old one, with no branch here, so the next fetch would forget ${one ? "it" : "them"}`}
        {own.length === 0
          ? `: ${one ? "its" : "their"} commits are on other branches here too, but not ${one ? "the branch itself" : "the branches themselves"}.`
          : own.length < names.length
            ? `. ${some(own)} ${own.length === 1 ? "has" : "have"} work found nowhere else here.`
            : "."}
      </p>
      <div className="merge-methods" role="radiogroup" aria-label={`What to do with the branches ${remote} remembers`}>
        {choice(
          "copy",
          one ? "Copy it to the new address" : "Copy them to the new address",
          `Pushes ${one ? "it" : "them"}, with ${withTags(check.local)}, to ${check.address}: the repository moves over whole.`,
        )}
        {choice("keep", one ? "Keep it here as a branch" : "Keep them here as branches", `Makes ${some(names)} ${one ? "a branch" : "branches"} here, to push when you choose.`)}
        {choice(
          "forget",
          one ? "Let it go" : "Let them go",
          `Nothing is copied: ${one ? "it's" : "they're"} forgotten now, kept in Restore for 30 days. ${lost ?? (one ? "Its commits stay on your other branches." : "Their commits stay on your other branches.")}`,
        )}
      </div>
      <p className="hint">When the new address has them already (the same repository, at a new link), this isn't asked.</p>
    </Dialog>
  );
}
