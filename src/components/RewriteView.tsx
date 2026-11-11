import { useEffect, useState } from "react";
import { branchVersions, rangeDiff, type BranchVersion, type CommitPair, type RangeDiff } from "../api";
import { relativeTime } from "../lib/format";
import { changeLineKind, describeRewrite, rewrittenVersions, summarizePairs } from "../lib/rewrites";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, RebaseIcon } from "./Icons";
import { Loader } from "./Loader";

interface Props {
  repoPath: string;
  /** The branch, like "fix/door" or "origin/fix/door". */
  branch: string;
  /** The branch it's on top of, like "origin/main" (found from its remote when null). */
  base: string | null;
  onClose: () => void;
}

const STATUS: Record<CommitPair["status"], string> = { same: "Same", changed: "Changed", added: "New", removed: "Dropped" };

/**
 * What changed when a branch was rewritten (rebased, amended or force-pushed): each commit of
 * the version before matched with its new version (git range-diff), so only real changes
 * show, not the commits it was moved onto. Earlier rewrites can be chosen too.
 */
export function RewriteView({ repoPath, branch, base, onClose }: Props) {
  const [versions, setVersions] = useState<BranchVersion[] | null>(null);
  const [old, setOld] = useState<string | null>(null);
  const [diff, setDiff] = useState<RangeDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let current = true;
    setVersions(null);
    branchVersions(repoPath, branch)
      .then((found) => {
        if (!current) return;
        setVersions(found);
        setOld(rewrittenVersions(found)[0]?.id ?? null);
      })
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, branch]);

  const latest = versions?.[0]?.id ?? null;
  useEffect(() => {
    setDiff(null);
    setOpen(new Set());
    if (!old || !latest) return;
    let current = true;
    rangeDiff(repoPath, old, latest, base, branch)
      .then((found) => {
        if (!current) return;
        setDiff(found);
        // The changed commits start open.
        setOpen(new Set(found.pairs.flatMap((pair, index) => (pair.status === "changed" ? [index] : []))));
      })
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, old, latest, base, branch]);

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

  // Each earlier version, with the rewrite that replaced it.
  const choices = (versions ?? []).flatMap((version, index) => {
    const before = versions?.[index + 1];
    return version.rewritten && before ? [{ before, rewrite: version }] : [];
  });
  const toggle = (index: number) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section className="diff-view request-view rewrite-view" aria-label={`What changed in ${branch}`}>
      <header className="diff-header">
        <div className="diff-title" title={branch}>
          <RebaseIcon size={14} />
          <span className="request-title">What changed in {branch}</span>
        </div>
        {choices.length > 0 && (
          <select className="text-input rewrite-choice" value={old ?? ""} onChange={(event) => setOld(event.target.value)} aria-label="Compared with">
            {choices.map(({ before, rewrite }) => (
              <option key={rewrite.id + rewrite.at} value={before.id}>
                Since before it was {describeRewrite(rewrite.how).toLowerCase()} {relativeTime(rewrite.at)}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="diff-body request-body-scroll">
        {error ? (
          <div className="diff-message">
            <strong>Couldn't compare its versions</strong>
            <span>{error}</span>
          </div>
        ) : !versions ? (
          <Loader size={88} title="Reading what changed" />
        ) : choices.length === 0 ? (
          <div className="diff-message">
            <strong>{branch} hasn't been rewritten</strong>
            <span>
              Not since this copy of the repository has known it: it's only moved forward. When it's rebased or force-pushed, what changed
              shows here.
            </span>
          </div>
        ) : !diff ? (
          <div className="diff-message muted">Comparing…</div>
        ) : (
          <div className="request-content">
            <div className="request-meta">
              <strong>{summarizePairs(diff.pairs)}</strong>
              {diff.base && <span className="muted">compared on top of {diff.base}</span>}
            </div>
            <ol className="rewrite-pairs">
              {diff.pairs.map((pair, index) => {
                const expandable = pair.status === "changed" && pair.changes.length > 0;
                const expanded = expandable && open.has(index);
                return (
                  <li key={index} className={`rewrite-pair ${pair.status}`}>
                    <button className="rewrite-row" onClick={() => expandable && toggle(index)} disabled={!expandable} aria-expanded={expandable ? expanded : undefined}>
                      <span className="rewrite-chevron">{expandable ? expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} /> : null}</span>
                      <span className={`rewrite-status ${pair.status}`}>{STATUS[pair.status]}</span>
                      <span className="rewrite-summary">{pair.summary}</span>
                      <span className="rewrite-ids mono">
                        {pair.old ?? "—"} → {pair.new ?? "—"}
                      </span>
                    </button>
                    {expanded && (
                      <pre className="rewrite-changes mono">
                        {pair.changes.map((line, at) => (
                          <span key={at} className={changeLineKind(line)}>
                            {line}
                            {"\n"}
                          </span>
                        ))}
                        {pair.cut && <span className="muted">…and more</span>}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
