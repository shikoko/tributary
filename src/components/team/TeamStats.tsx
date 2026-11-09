// Team activity's statistics: what kinds of file the team changed, lines of code added and
// removed, the files changed most, when the team works, and pull requests.
import type { CSSProperties } from "react";
import type { FileKind, KindCount, RecentRequest, TeamWork } from "../../api";
import { plural } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { dayLabel, median, perDay, punchCard, roughDuration } from "../../lib/team";
import { Avatar } from "../Avatar";
import { AreaTrend } from "./AreaTrend";
import type { Tip } from "./parts";

export const KIND_NAMES: Record<FileKind, string> = {
  code: "Code",
  art: "Art & assets",
  levels: "Levels",
  audio: "Audio",
  other: "Other",
};

const kindColor = (kind: FileKind) => `var(--kind-${kind})`;

/** One whole split into its kinds: tall with the shares printed inside, or thin. */
export function KindBar({ kinds, tall = false, tip }: { kinds: KindCount[]; tall?: boolean; tip: Tip }) {
  const total = kinds.reduce((sum, entry) => sum + entry.changes, 0);
  if (total === 0) return null;
  return (
    <span className={`team-kinds${tall ? " tall" : ""}`} role="img" aria-label={kinds.map((entry) => `${KIND_NAMES[entry.kind]} ${Math.round((entry.changes / total) * 100)}%`).join(", ")}>
      {kinds.map((entry) => {
        const share = Math.round((entry.changes / total) * 100);
        return (
          <span
            key={entry.kind}
            className={`team-kind kind-${entry.kind}`}
            style={{ flexGrow: entry.changes, background: kindColor(entry.kind) }}
            onMouseEnter={(event) => tip.show(event, <strong>{`${KIND_NAMES[entry.kind]} · ${plural(entry.changes, "file change")} (${share}%)`}</strong>)}
            onMouseLeave={tip.hide}
          >
            {tall && share >= 9 && <span className="team-kind-share">{share}%</span>}
          </span>
        );
      })}
    </span>
  );
}

export function KindsCard({ work, tip }: { work: TeamWork; tip: Tip }) {
  return (
    <section className="team-panel">
      <header className="team-panel-head">
        <h3>What kind of work</h3>
        <span className="muted">{plural(work.kinds.reduce((sum, entry) => sum + entry.changes, 0), "file change")}</span>
      </header>
      <KindBar kinds={work.kinds} tall tip={tip} />
      <ul className="team-kind-legend">
        {work.kinds.map((entry) => (
          <li key={entry.kind}>
            <span className="team-swatch" style={{ background: kindColor(entry.kind) }} />
            {KIND_NAMES[entry.kind]}
            <span className="muted">{entry.changes.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lines of code added (growing up) and removed (growing down), day by day. */
export function LinesCard({ work, days, today, tip }: { work: TeamWork; days: number[]; today: number; tip: Tip }) {
  const added = perDayWeighted(work.commits, days, (commit) => commit.added);
  const removed = perDayWeighted(work.commits, days, (commit) => commit.removed);
  const top = Math.max(1, ...added, ...removed);
  const totalAdded = added.reduce((a, b) => a + b, 0);
  const totalRemoved = removed.reduce((a, b) => a + b, 0);
  const describe = (index: number) => (
    <>
      <strong>{dayLabel(days[index], today)}</strong>
      <span className="team-tip-row">
        <span className="team-swatch" style={{ background: "var(--added)" }} />
        added<span className="team-tip-value">{added[index].toLocaleString()}</span>
      </span>
      <span className="team-tip-row">
        <span className="team-swatch" style={{ background: "var(--removed)" }} />
        removed<span className="team-tip-value">{removed[index].toLocaleString()}</span>
      </span>
    </>
  );
  return (
    <section className="team-panel">
      <header className="team-panel-head">
        <h3>Lines of code</h3>
        <span className="team-lines-totals">
          <span className="added">+{totalAdded.toLocaleString()}</span>
          <span className="removed">−{totalRemoved.toLocaleString()}</span>
        </span>
      </header>
      <div className="team-mirror">
        <AreaTrend values={added} top={top} color="var(--added)" height={56} label="Lines of code added per day" tip={tip} describe={describe} />
        <span className="team-mirror-axis" />
        <AreaTrend values={removed} top={top} color="var(--removed)" height={56} label="Lines of code removed per day" tip={tip} describe={describe} flipped />
      </div>
    </section>
  );
}

function perDayWeighted(commits: TeamWork["commits"], days: number[], weight: (commit: TeamWork["commits"][number]) => number): number[] {
  const totals = days.map(() => 0);
  for (const commit of commits) {
    const index = perDay([commit.time], days).indexOf(1);
    if (index >= 0) totals[index] += weight(commit);
  }
  return totals;
}

/** The files changed most, with who changed them; those that can't be merged stand out. */
export function HotspotsCard({ work, nameOf, colorOf, tip }: { work: TeamWork; nameOf: (email: string) => string; colorOf: (email: string) => string; tip: Tip }) {
  const most = Math.max(1, ...work.hotspots.map((spot) => spot.changes));
  return (
    <section className="team-panel">
      <header className="team-panel-head">
        <h3>Hotspots</h3>
        <span className="muted">changed most</span>
      </header>
      <ul className="team-hotspots">
        {work.hotspots.slice(0, 8).map((spot) => {
          const folder = spot.path.includes("/") ? spot.path.slice(0, spot.path.lastIndexOf("/")) : "";
          const risky = spot.unmergeable && spot.people.length > 1;
          return (
            <li key={spot.path} title={spot.path}>
              <span className="team-swatch" style={{ background: kindColor(spot.kind) }} />
              <span className="team-hotspot-name">
                <span className="team-hotspot-file">
                  <span className="mono">{baseName(spot.path)}</span>
                  {risky && (
                    <span className="team-hotspot-risk" title="Several people changed it and it can't be merged: one version will win">
                      can't merge
                    </span>
                  )}
                </span>
                <span className="muted">{folder || "top folder"}</span>
              </span>
              <span className="team-avatars">
                {spot.people.slice(0, 3).map((email) => (
                  <span key={email} onMouseEnter={(event) => tip.show(event, <strong>{nameOf(email)}</strong>)} onMouseLeave={tip.hide}>
                    <Avatar name={nameOf(email)} email={email} size={18} color={colorOf(email)} />
                  </span>
                ))}
              </span>
              <span className="team-hotspot-bar">
                <span style={{ width: `${(spot.changes / most) * 100}%` }} />
              </span>
              <span className="team-hotspot-count">{spot.changes}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When the team commits: weekdays by hours of the day, a dot sized by how many. */
export function PunchCard({ times, tip }: { times: number[]; tip: Tip }) {
  const grid = punchCard(times);
  const most = Math.max(1, ...grid.flat());
  const hour = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
  return (
    <section className="team-panel">
      <header className="team-panel-head">
        <h3>When the team works</h3>
        <span className="muted">your local time</span>
      </header>
      <div className="team-punch" role="img" aria-label="Commits by weekday and hour of the day">
        {grid.map((row, weekday) => (
          <div key={weekday} className="team-punch-row">
            <span className="team-punch-day">{WEEKDAYS[weekday]}</span>
            {row.map((count, h) => (
              <span
                key={h}
                className="team-punch-cell"
                onMouseEnter={(event) => tip.show(event, <strong>{`${WEEKDAYS[weekday]}, ${hour(h)}–${hour((h + 1) % 24)} · ${plural(count, "commit")}`}</strong>)}
                onMouseLeave={tip.hide}
              >
                {count > 0 && <span className="team-punch-dot" style={{ "--size": `${4 + Math.sqrt(count / most) * 12}px`, opacity: 0.45 + (count / most) * 0.55 } as CSSProperties} />}
              </span>
            ))}
          </div>
        ))}
        <div className="team-punch-row team-punch-hours" aria-hidden="true">
          <span className="team-punch-day" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="team-punch-cell">
              {h % 6 === 0 ? hour(h) : ""}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Pull requests opened and merged in the period, how long merging took, and by whom. */
export function RequestsCard({ requests, since }: { requests: RecentRequest[]; since: number }) {
  const at = (time: string | null) => (time ? Date.parse(time) / 1000 : null);
  const opened = requests.filter((request) => (at(request.created) ?? 0) >= since);
  const merged = requests.filter((request) => (at(request.merged) ?? 0) >= since);
  const waits = merged.map((request) => (at(request.merged) ?? 0) - (at(request.created) ?? 0)).filter((wait) => wait >= 0);
  const typical = median(waits);
  const stillOpen = requests.filter((request) => !request.closed && !request.merged).length;
  const byAuthor = new Map<string, number>();
  for (const request of merged) byAuthor.set(request.author, (byAuthor.get(request.author) ?? 0) + 1);
  const authors = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const mostMerged = Math.max(1, ...authors.map(([, count]) => count));
  return (
    <section className="team-panel team-requests">
      <header className="team-panel-head">
        <h3>Pull requests</h3>
        <span className="muted">{plural(stillOpen, "open now", "open now")}</span>
      </header>
      <div className="team-figures">
        <div>
          <span className="team-figure">{opened.length}</span>
          <span className="muted">opened</span>
        </div>
        <div>
          <span className="team-figure">{merged.length}</span>
          <span className="muted">merged</span>
        </div>
        <div>
          <span className="team-figure">{typical === null ? "–" : roughDuration(typical)}</span>
          <span className="muted">typically, from opened to merged</span>
        </div>
      </div>
      {authors.length > 0 && (
        <ul className="team-request-authors">
          {authors.map(([author, count]) => (
            <li key={author}>
              <Avatar name={author} email="" size={18} />
              <span className="team-request-author">{author}</span>
              <span className="team-hotspot-bar">
                <span style={{ width: `${(count / mostMerged) * 100}%` }} />
              </span>
              <span className="team-hotspot-count">{count} merged</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
