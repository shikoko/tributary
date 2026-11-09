// Team activity as cards: the period's commits up top with a graph of each day, a card for
// each person with their own graph in their colour, and a card for each branch.
import { plural, relativeTime } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { change, dayLabel, labelledDays, perDay, previousPerDay, rhythm, seriesColor, withoutRemote } from "../../lib/team";
import { Avatar } from "../Avatar";
import { BranchIcon, LockIcon } from "../Icons";
import { AreaTrend } from "./AreaTrend";
import { DayTip, Divergence, Overlap, RingedAvatar, YouTag, type TeamData } from "./parts";
import { HotspotsCard, KindBar, KindsCard, LinesCard, PunchCard, RequestsCard } from "./TeamStats";

export function TeamCards({ team, work, requests, days, now, slotOf, isYou, yoursOn, lockOwners, tip, onShowBranch, onShowPerson }: TeamData) {
  const today = days[days.length - 1];
  const people = team.people.map((person) => ({ person, slot: slotOf(person.email), daily: perDay(person.times, days) }));
  const totals = days.map((_, index) => people.reduce((sum, entry) => sum + entry.daily[index], 0));
  const total = team.people.reduce((sum, person) => sum + person.commits, 0);
  const busiestDay = totals.reduce((best, count, index) => (count > totals[best] ? index : best), 0);
  // Everyone's graph has the same scale, so they compare.
  const busiestPerson = Math.max(1, ...people.flatMap((entry) => entry.daily));
  const scale = Math.max(1, ...team.branches.flatMap((branch) => [branch.ahead, branch.behind]));
  const labelled = labelledDays(days.length);
  const at = (index: number) => `${(index / Math.max(1, days.length - 1)) * 100}%`;
  // The period before, as long, to compare with.
  const before = previousPerDay(team.previous, days);
  const changed = change(total, team.previous.length);
  const allTimes = team.people.flatMap((person) => person.times);
  const nameOf = (email: string) => team.people.find((person) => person.email.toLowerCase() === email)?.name ?? email;
  const workOf = (email: string) => work?.people.find((entry) => entry.email === email.toLowerCase());

  return (
    <div className="team-cards">
      <section className="team-hero">
        <div className="team-hero-summary">
          <div className="team-hero-figure">
            <span className="team-hero-number">{total.toLocaleString()}</span>
            <span className="team-hero-text">
              <span>
                commits in the last {team.days} days
                {changed !== null && (
                  <span className={`team-change ${changed > 0 ? "up" : changed < 0 ? "down" : ""}`} title={`${plural(team.previous.length, "commit")} in the ${team.days} days before`}>
                    {changed > 0 ? "+" : changed < 0 ? "−" : ""}
                    {Math.abs(changed)}% vs the {team.days} days before
                  </span>
                )}
              </span>
              <span className="muted">
                {team.mainCommits.toLocaleString()} on <span className="mono">{team.main}</span>
                {team.branches.length > 0 && `, ${(total - team.mainCommits).toLocaleString()} on ${plural(team.branches.length, "branch", "branches")}`}
              </span>
            </span>
          </div>
          <div className="team-hero-people">
            {people.slice(0, 8).map(({ person, slot }) => (
              <RingedAvatar key={person.email} person={person} slot={slot} size={30} />
            ))}
            {people.length > 8 && <span className="team-hero-more">+{people.length - 8}</span>}
          </div>
        </div>
        <div className="team-hero-chart">
          <div className="team-hero-chart-head">
            <span>Commits per day</span>
            {totals[busiestDay] > 0 && (
              <span className="muted">
                Busiest: {dayLabel(days[busiestDay], today)}, {plural(totals[busiestDay], "commit")}
              </span>
            )}
          </div>
          <AreaTrend
            values={totals}
            ghost={before}
            top={Math.max(1, ...totals, ...before)}
            color="var(--accent)"
            height={112}
            label={`Commits per day over the last ${team.days} days`}
            tip={tip}
            describe={(index) => (
              <>
                <DayTip label={dayLabel(days[index], today)} entries={people.map((entry) => ({ ...entry, count: entry.daily[index] }))} />
                <span className="team-tip-row muted">
                  <span className="team-ghost-key" />
                  the period before<span className="team-tip-value">{before[index]}</span>
                </span>
              </>
            )}
          />
          <div className="team-area-axis" aria-hidden="true">
            {days.map((day, index) =>
              labelled(index) ? (
                <span key={day} className={day === today ? "today" : undefined} style={{ left: at(index) }}>
                  {dayLabel(day, today)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </section>

      {(work || (requests && requests.length > 0)) && (
        <div className="team-panels">
          {work && work.kinds.length > 0 && <KindsCard work={work} tip={tip} />}
          {work && <LinesCard work={work} days={days} today={today} tip={tip} />}
          {work && work.hotspots.length > 0 && <HotspotsCard work={work} nameOf={nameOf} slotOf={slotOf} tip={tip} />}
          <PunchCard times={allTimes} tip={tip} />
          {requests && requests.length > 0 && <RequestsCard requests={requests} since={team.since} />}
        </div>
      )}

      <h3 className="team-section-title">People</h3>
      <ul className="team-card-grid">
        {people.map(({ person, slot, daily }) => (
          <li key={person.email}>
            <button className="team-person-card" onClick={() => onShowPerson(person)} title={`Highlight ${person.name}'s commits`}>
              <span className="team-person-card-head">
                <RingedAvatar person={person} slot={slot} size={36} />
                <span className="team-person-card-name">
                  <span>
                    {person.name}
                    {isYou(person.email) && <YouTag />}
                  </span>
                  <span className="muted">last {relativeTime(person.latest, now / 1000)}</span>
                </span>
                <span className="team-person-card-count">
                  {person.commits.toLocaleString()}
                  <span className="muted">{person.commits === 1 ? "commit" : "commits"}</span>
                </span>
              </span>
              <AreaTrend
                values={daily}
                top={busiestPerson}
                color={seriesColor(slot)}
                height={52}
                label={`${person.name}'s commits per day`}
                tip={tip}
                describe={(index) => <strong>{`${dayLabel(days[index], today)} · ${plural(daily[index], "commit")}`}</strong>}
              />
              <span className="team-rhythm">
                <span>
                  Active on <strong>{rhythm(daily).active}</strong> {rhythm(daily).active === 1 ? "day" : "days"}
                </span>
                <span>
                  <strong>{rhythm(daily).streak}</strong> in a row at most
                </span>
                {workOf(person.email) && (workOf(person.email)?.added ?? 0) + (workOf(person.email)?.removed ?? 0) > 0 && (
                  <span>
                    <span className="added">+{workOf(person.email)?.added.toLocaleString()}</span> <span className="removed">−{workOf(person.email)?.removed.toLocaleString()}</span>
                  </span>
                )}
              </span>
              {workOf(person.email) && <KindBar kinds={workOf(person.email)?.kinds ?? []} tip={tip} />}
              <span className="team-chips">
                {person.branches.slice(0, 3).map((branch) => (
                  <span key={branch} className="team-branch-chip mono">
                    {withoutRemote(branch)}
                  </span>
                ))}
                {person.branches.length > 3 && <span className="muted">+{person.branches.length - 3}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {team.branches.length > 0 && (
        <>
          <h3 className="team-section-title">Branches in progress</h3>
          <ul className="team-card-grid">
            {team.branches.map((branch) => (
              <li key={branch.name}>
                <button className="team-branch-card" onClick={() => onShowBranch(branch)} title={`Highlight ${branch.name}'s history`}>
                  <span className="team-branch-card-head">
                    <BranchIcon size={14} />
                    <span className="team-branch-card-name mono">{withoutRemote(branch.name)}</span>
                    <span className="muted">{relativeTime(branch.latest, now / 1000)}</span>
                  </span>
                  <Divergence branch={branch} main={team.main} scale={scale} labels />
                  <span className="team-branch-card-foot">
                    <span className="team-avatars">
                      {branch.people.slice(0, 4).map((person) => (
                        <Avatar key={person.email} name={person.name} email={person.email} size={20} color={seriesColor(slotOf(person.email))} />
                      ))}
                    </span>
                    <span className="muted">
                      {plural(branch.times.length, "commit")} · {plural(branch.files, "file")}
                    </span>
                    <Overlap files={yoursOn(branch)} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {lockOwners && lockOwners.length > 0 && (
        <>
          <h3 className="team-section-title">Locked files</h3>
          <ul className="team-card-grid">
            {lockOwners.map(([owner, held]) => (
              <li key={owner} className="team-lock-card">
                <span className="team-lock-card-head">
                  <LockIcon size={14} />
                  {held[0].mine ? `${owner} (you)` : owner}
                  <span className="muted">{plural(held.length, "file")}</span>
                </span>
                <span className="team-lock-card-files mono" title={held.map((lock) => lock.path).join("\n")}>
                  {held
                    .slice(0, 5)
                    .map((lock) => baseName(lock.path))
                    .join("\n")}
                  {held.length > 5 && `\nand ${held.length - 5} more`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
