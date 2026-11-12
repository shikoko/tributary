import { useEffect, useMemo, useState } from "react";
import { recentRequests, teamActivity, teamWork, type BranchActivity, type Lock, type Overlap, type RecentRequest, type TeamActivity, type TeamWork } from "../api";
import { assignSlots, periodDays } from "../lib/team";
import { useThemeColors } from "../app/useAppearance";
import { CloseIcon, UserIcon } from "./Icons";
import { useTip, type TeamData } from "./team/parts";
import { TeamCards } from "./team/TeamCards";
import { Loader } from "./Loader";
import { Button } from "./ui/Button";

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

  // What was changed takes longer to read: it comes after.
  const [work, setWork] = useState<{ key: string; work: TeamWork } | null>(null);
  useEffect(() => {
    let current = true;
    teamWork(repoPath, days)
      .then((found) => current && setWork({ key, work: found }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [key, repoPath, days, version]);
  const [requests, setRequests] = useState<{ path: string; requests: RecentRequest[] } | null>(null);
  useEffect(() => {
    let current = true;
    recentRequests(repoPath)
      .then((found) => current && setRequests({ path: repoPath, requests: found }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath]);
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
  // The overlap may name the local copy ("art/barber-v2" for "origin/art/barber-v2").
  const yoursOn = (branch: BranchActivity) => touching.get(branch.name) ?? touching.get(branch.name.slice(branch.name.indexOf("/") + 1)) ?? [];
  const isYou = (email: string) => Boolean(user?.email && user.email.toLowerCase() === email.toLowerCase());
  const lockOwners = useMemo(() => {
    if (!locks) return null;
    const byOwner = new Map<string, Lock[]>();
    for (const lock of locks) byOwner.set(lock.owner, [...(byOwner.get(lock.owner) ?? []), lock]);
    return [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [locks]);
  // Everyone keeps their colour while the view is open, whichever period is shown.
  const [slots, setSlots] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (team) setSlots((known) => assignSlots(known, team.people.map((person) => person.email)));
  }, [team]);
  // Their colour: the graph colours chosen in Settings, in turn; grey once they run out.
  const { lanes } = useThemeColors();
  const colorOf = (email: string) => {
    const slot = slots.get(email.toLowerCase()) ?? 0;
    return slot > 0 && slot <= lanes.length ? lanes[slot - 1] : "var(--team-other)";
  };
  const { layer, tip, view: tipView } = useTip();
  const now = Date.now();
  const data =
    team &&
    ({
      team,
      work: work?.key === key ? work.work : null,
      requests: requests?.path === repoPath ? requests.requests : null,
      days: periodDays(team.since, now),
      now,
      colorOf,
      isYou,
      yoursOn,
      lockOwners,
      tip,
      onShowBranch,
      onShowPerson: (person) => onShowPerson(person.name, person.email),
    } satisfies TeamData);

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
        <Button kind="icon" onClick={onClose} title="Close (Esc)" aria-label="Close team activity">
          <CloseIcon />
        </Button>
      </header>
      <div className="diff-body team-body" ref={layer} onScroll={tip.hide}>
        {error ? (
          <div className="diff-message">
            <strong>Couldn't read the activity</strong>
            <span>{error}</span>
          </div>
        ) : !data ? (
          <Loader size={88} title="Reading the team's activity" />
        ) : data.team.people.length === 0 ? (
          <div className="diff-message muted">Nobody committed in the last {days} days. Fetch to see your teammates' latest work.</div>
        ) : (
          <TeamCards {...data} />
        )}
        {tipView}
      </div>
    </section>
  );
}
