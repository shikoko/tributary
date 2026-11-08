import { useEffect, useMemo, useState } from "react";
import { teamActivity, type BranchActivity, type Lock, type Overlap, type TeamActivity } from "../api";
import { plural, relativeTime } from "../lib/format";
import { baseName } from "../lib/paths";
import { Avatar } from "./Avatar";
import { BranchIcon, CloseIcon, LockIcon, UserIcon } from "./Icons";

const PERIODS = [7, 14, 30];

interface Props {
  repoPath: string;
  /** Changes when the repository reloads (after a fetch, say): read again. */
  version: unknown;
  /** You, to mark yourself. */
  user: { name: string | null; email: string | null } | null;
  /** Git LFS locks, when the repository uses them. */
  locks: Lock[] | null;
  /** Files you're changing that other branches also changed. */
  overlaps: Overlap[];
  onClose: () => void;
  /** Highlight a branch's history, or someone's commits, in the list. */
  onShowBranch: (branch: BranchActivity) => void;
  onShowPerson: (name: string, email: string) => void;
}

/**
 * What the team has been up to, over the commit list: who committed lately and where, the
 * branches being worked on (how far from the main branch, and whether they touch files
 * you're changing), and who holds which Git LFS locks.
 */
export function TeamView({ repoPath, version, user, locks, overlaps, onClose, onShowBranch, onShowPerson }: Props) {
  const [days, setDays] = useState(7);
  const [loaded, setLoaded] = useState<{ key: string; team: TeamActivity | null; error: string | null } | null>(null);
  const key = JSON.stringify([repoPath, days]);
  useEffect(() => {
    let current = true;
    teamActivity(repoPath, days)
      .then((team) => current && setLoaded({ key, team, error: null }))
      .catch((e) => current && setLoaded({ key, team: null, error: String(e) }));
    return () => {
      current = false;
    };
  }, [key, repoPath, days, version]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const team = loaded?.key === key ? loaded.team : null;
  const error = loaded?.key === key ? loaded.error : null;
  // The branches touching files you're changing, and which files.
  const touching = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const overlap of overlaps) {
      for (const change of overlap.elsewhere) found.set(change.branch, [...(found.get(change.branch) ?? []), overlap.path]);
    }
    return found;
  }, [overlaps]);
  const isYou = (email: string) => Boolean(user?.email && user.email.toLowerCase() === email.toLowerCase());
  const lockOwners = useMemo(() => {
    const byOwner = new Map<string, Lock[]>();
    for (const lock of locks ?? []) byOwner.set(lock.owner, [...(byOwner.get(lock.owner) ?? []), lock]);
    return [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [locks]);

  return (
    <section className="diff-view team-view" aria-label="Team activity">
      <header className="diff-header">
        <div className="diff-title">
          <UserIcon size={14} />
          <span className="team-title">Team activity</span>
        </div>
        <div className="diff-switch" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button key={period} className={days === period ? "selected" : undefined} aria-pressed={days === period} onClick={() => setDays(period)}>
              {period} days
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close team activity">
          <CloseIcon />
        </button>
      </header>
      <div className="diff-body team-body">
        {error ? (
          <div className="diff-message">
            <strong>Couldn't read the activity</strong>
            <span>{error}</span>
          </div>
        ) : !team ? (
          <div className="diff-message muted">Loading…</div>
        ) : team.people.length === 0 ? (
          <div className="diff-message muted">Nobody committed in the last {days} days{team.branches.length === 0 ? "" : "."} Fetch to see your teammates' latest work.</div>
        ) : (
          <>
            <p className="team-summary">
              {plural(team.people.length, "person", "people")} committed in the last {days} days: {plural(team.mainCommits, "commit")} on{" "}
              <span className="mono">{team.main}</span>
              {team.branches.length > 0 && <>, and work on {plural(team.branches.length, "other branch", "other branches")}</>}.
            </p>

            <h3 className="team-heading">People</h3>
            <ul className="team-people">
              {team.people.map((person) => (
                <li key={person.email}>
                  <button className="team-person" onClick={() => onShowPerson(person.name, person.email)} title={`Highlight ${person.name}'s commits`}>
                    <Avatar name={person.name} email={person.email} size={30} />
                    <span className="team-person-text">
                      <span className="team-person-name">
                        {person.name}
                        {isYou(person.email) && <span className="team-you">you</span>}
                      </span>
                      <span className="team-person-facts">
                        {plural(person.commits, "commit")} · {relativeTime(person.latest)}
                      </span>
                      <span className="team-person-branches">
                        {person.branches.slice(0, 3).map((branch) => (
                          <span key={branch} className="team-branch-chip mono">
                            {branch.replace(/^origin\//, "")}
                          </span>
                        ))}
                        {person.branches.length > 3 && <span className="muted">+{person.branches.length - 3}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {team.branches.length > 0 && (
              <>
                <h3 className="team-heading">Branches being worked on</h3>
                <ul className="team-branches">
                  {team.branches.map((branch) => {
                    // The overlap may name the local copy ("art/barber-v2" for "origin/art/barber-v2").
                    const local = branch.name.slice(branch.name.indexOf("/") + 1);
                    const yours = touching.get(branch.name) ?? touching.get(local) ?? [];
                    return (
                      <li key={branch.name}>
                        <button className="team-branch" onClick={() => onShowBranch(branch)} title={`Highlight ${branch.name}'s history`}>
                          <BranchIcon size={13} />
                          <span className="team-branch-name mono">{branch.name}</span>
                          <span className="team-branch-people">
                            {branch.people.slice(0, 4).map((person) => (
                              <Avatar key={person.email} name={person.name} email={person.email} size={18} />
                            ))}
                          </span>
                          <span className="team-branch-facts">
                            {branch.ahead > 0 && <span title={`${plural(branch.ahead, "commit")} that ${team.main} doesn't have`}>↑{branch.ahead}</span>}
                            {branch.behind > 0 && <span title={`${plural(branch.behind, "commit")} on ${team.main} that it doesn't have`}>↓{branch.behind}</span>}
                            <span>{plural(branch.files, "file")}</span>
                          </span>
                          {yours.length > 0 && (
                            <span className="team-overlap" title={`Also changes ${yours.map(baseName).join(", ")}, which you're changing`}>
                              {yours.length === 1 ? "1 of your files" : `${yours.length} of your files`}
                            </span>
                          )}
                          <span className="team-branch-when">{relativeTime(branch.latest)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {lockOwners.length > 0 && (
              <>
                <h3 className="team-heading">Locked files</h3>
                <ul className="team-locks">
                  {lockOwners.map(([owner, held]) => (
                    <li key={owner}>
                      <LockIcon size={13} />
                      <span className="team-lock-owner">{held[0].mine ? `${owner} (you)` : owner}</span>
                      <span className="team-lock-files" title={held.map((lock) => lock.path).join("\n")}>
                        {held
                          .slice(0, 4)
                          .map((lock) => baseName(lock.path))
                          .join(", ")}
                        {held.length > 4 && ` and ${held.length - 4} more`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
