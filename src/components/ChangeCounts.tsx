import type { ChangeCounts as Counts } from "../lib/changes";

/** Small coloured counts of added, modified, deleted and conflicted files. */
export function ChangeCounts({ counts }: { counts: Counts }) {
  const chips = [
    { key: "conflicted", value: counts.conflicted, sign: "!", label: "conflicted" },
    { key: "added", value: counts.added, sign: "+", label: "added or untracked" },
    { key: "modified", value: counts.modified, sign: "~", label: "modified" },
    { key: "deleted", value: counts.deleted, sign: "−", label: "deleted" },
  ].filter((chip) => chip.value > 0);

  return (
    <span className="change-counts">
      {chips.map((chip) => (
        <span key={chip.key} className={`change-count ${chip.key}`} title={`${chip.value} ${chip.label}`}>
          {chip.sign}
          {chip.value}
        </span>
      ))}
    </span>
  );
}
