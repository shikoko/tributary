import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { repoSize, type Action, type RepoSize } from "../api";
import { useThemeColors } from "../app/useAppearance";
import { textOn } from "../lib/appearance";
import { formatBytes, plural } from "../lib/format";
import { kindOf, squarify } from "../lib/repoSize";
import { Dialog } from "./Dialog";

/** Which lane colours the five kinds of file that take the most get, in order (apart for colour-blind eyes too). */
const KIND_LANES = [0, 1, 2, 4, 3];
const OTHER = "Other";
/** How tall the map is, and its folders' headings. */
const MAP_HEIGHT = 300;
const HEADING = 20;
/** A file's tile is at least this many square pixels, or it goes in with the smaller files. */
const SMALLEST_TILE = 16 * 16;

interface Paint {
  fill: string;
  ink: string;
}

interface FileEntry {
  path: string;
  name: string;
  /** Its top folder, as the folders are counted ("(top folder)" for files at the top). */
  top: string;
  kind: string;
  /** What all its versions among the biggest take on disk. */
  diskBytes: number;
  versions: number;
  current: boolean;
  inLfs: boolean;
}

/**
 * What makes the repository big: everything ever committed stays in its history. A map of
 * it shows each folder as a block as big as what it takes, with its biggest files inside,
 * coloured by kind of file, so the sizes show before any number is read. Kinds of big file
 * can move into Git LFS: from now on, or by rewriting history.
 */
export function RepoSizeDialog({
  repoPath,
  canChange,
  branch,
  onClose,
  run,
}: {
  repoPath: string;
  canChange: boolean;
  /** The checked-out branch. */
  branch: string | null;
  onClose: () => void;
  run: (action: Action) => void;
}) {
  const [size, setSize] = useState<RepoSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [everything, setEverything] = useState(false);
  const { lanes } = useThemeColors();
  useEffect(() => {
    let current = true;
    repoSize(repoPath)
      .then((found) => current && setSize(found))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath]);

  // The kinds of big file that aren't in Git LFS: the ones worth moving.
  const offered = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const file of size?.biggest ?? []) {
      if (file.inLfs || file.bytes < 100_000) continue;
      const kind = kindOf(file.path);
      kinds.set(kind, (kinds.get(kind) ?? 0) + file.diskBytes);
    }
    return [...kinds.entries()].sort((a, b) => b[1] - a[1]);
  }, [size]);
  const patterns = [...chosen];
  // Each file once, with what its versions among the biggest take on disk.
  const files = useMemo(() => {
    const byPath = new Map<string, FileEntry>();
    for (const file of size?.biggest ?? []) {
      const known = byPath.get(file.path);
      if (known) {
        known.versions++;
        known.diskBytes += file.diskBytes;
        known.current ||= file.current;
      } else {
        const slash = file.path.indexOf("/");
        byPath.set(file.path, {
          path: file.path,
          name: file.path.slice(file.path.lastIndexOf("/") + 1),
          top: slash > 0 ? file.path.slice(0, slash) : "(top folder)",
          kind: kindOf(file.path),
          diskBytes: file.diskBytes,
          versions: 1,
          current: file.current,
          inLfs: file.inLfs,
        });
      }
    }
    return [...byPath.values()];
  }, [size]);

  // The five kinds that take the most each get a colour; the rest are "Other", in grey.
  const paints = useMemo(() => {
    const named = new Map<string, Paint>();
    (size?.kinds ?? []).slice(0, KIND_LANES.length).forEach((group, index) => {
      const fill = lanes[KIND_LANES[index] % lanes.length];
      named.set(group.name, { fill, ink: textOn(fill) });
    });
    return named;
  }, [size, lanes]);
  const paintOf = (kind: string): Paint => paints.get(kind) ?? { fill: "var(--bg-active)", ink: "var(--text-secondary)" };
  const legend = [...paints.keys(), ...((size?.kinds.length ?? 0) > KIND_LANES.length ? [OTHER] : [])];
  // Whether some folder has more than the files the map shows (the hatched part of it). The
  // map leaves out files too small to see, so this is close, not exact.
  const hasRest = (size?.folders ?? []).some(
    (folder) => folder.diskBytes > files.filter((file) => file.top === folder.name).reduce((sum, file) => sum + file.diskBytes, 0) * 1.02,
  );

  const tip = useTip();
  const toggle = (kind: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <Dialog
      title="What makes this repository big"
      className="big-window"
      closable
      error={error}
      onCancel={onClose}
      buttons={
        <>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <span className="spacer" />
          {offered.length > 0 && (
            <>
              <button
                className="outline-button"
                disabled={!canChange || patterns.length === 0}
                title="New versions go into Git LFS; what's in the history stays"
                onClick={() => {
                  onClose();
                  run({ kind: "trackWithLfs", patterns, paths: [] });
                }}
              >
                <span className="button-label">Into Git LFS from now on</span>
              </button>
              <button
                className={everything ? "danger-outline-button" : "primary-small-button"}
                disabled={!canChange || patterns.length === 0 || !branch}
                onClick={() => {
                  onClose();
                  run({ kind: "migrateToLfs", patterns, everything });
                }}
              >
                {everything ? "Rewrite every branch" : `Rewrite ${branch ?? "the branch"}'s new commits`}
              </button>
            </>
          )}
        </>
      }
    >
      {!size ? (
        !error && <p className="muted">Looking through the whole history… (a big repository takes a while)</p>
      ) : (
        <div className="big" onMouseLeave={tip.hide}>
          <p className="big-intro">
            The history takes <strong>{formatBytes(size.historyBytes)}</strong> on disk, in {plural(size.versions, "file version")}. Everyone who
            clones the repository downloads all of it, deleted files included (Git LFS files aside).
          </p>
          <SizeMap size={size} files={files} paintOf={paintOf} tip={tip} />
          <ul className="big-legend" aria-label="Kinds of file">
            {legend.map((kind) => (
              <li key={kind}>
                <span className="big-swatch" style={{ background: paintOf(kind).fill }} />
                <span className={kind === OTHER ? undefined : "mono"}>{kind}</span>
              </li>
            ))}
            {hasRest && (
              <li>
                <span className="big-swatch rest" />
                <span>Smaller files</span>
              </li>
            )}
          </ul>
          <ul className="big-folders" aria-label="Folders">
            {size.folders.map((folder) => (
              <li key={folder.name} title={plural(folder.versions, "version")}>
                <span className="mono">{folder.name}</span>
                <span>{formatBytes(folder.diskBytes)}</span>
              </li>
            ))}
          </ul>
          {offered.length > 0 && (
            <section className="big-card big-lfs">
              <header>
                <h3>Move into Git LFS</h3>
                <span className="muted">Kinds of big file that aren't in Git LFS yet</span>
              </header>
              <div className="big-chips">
                {offered.map(([kind, bytes]) => (
                  <button key={kind} className={`big-chip${chosen.has(kind) ? " on" : ""}`} aria-pressed={chosen.has(kind)} onClick={() => toggle(kind)}>
                    <span className="big-swatch" style={{ background: paintOf(kind).fill }} />
                    <span className="mono">{kind}</span>
                    <span className="big-chip-amount">{formatBytes(bytes)}</span>
                  </button>
                ))}
              </div>
              <p className="dialog-note-line">
                <strong>From now on</strong> keeps the history as it is. <strong>Rewriting</strong> takes them out of the history too: the commits
                get new ids (backed up first, for Restore Branch).
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={everything} onChange={(event) => setEverything(event.target.checked)} />
                Every branch's whole history, not only {branch ?? "this branch"}'s commits that aren't pushed yet. Every branch then needs
                force-pushing, and everyone else has to clone again.
              </label>
            </section>
          )}
          {tip.node}
        </div>
      )}
    </Dialog>
  );
}

/** Every folder as a block as big as what it takes, its biggest files inside, the rest hatched. */
function SizeMap({ size, files, paintOf, tip }: { size: RepoSize; files: FileEntry[]; paintOf: (kind: string) => Paint; tip: Tip }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const folders = squarify(size.folders, (group) => group.diskBytes, { x: 0, y: 0, w: width, h: MAP_HEIGHT });
  const described = size.folders.map((folder) => `${folder.name} ${formatBytes(folder.diskBytes)}`).join(", ");
  return (
    <div ref={frame} className="big-map" style={{ height: MAP_HEIGHT }} role="img" aria-label={`What each folder takes: ${described}`}>
      {width > 0 &&
        folders.map(({ item: folder, x, y, w, h }) => {
          // A folder too small to see isn't drawn, and one too small for its files is a plain
          // block: both are in the list under the map.
          if (w < 6 || h < 6) return null;
          if (w < 40 || h < 40)
            return (
              <div
                key={folder.name}
                className="big-map-folder small"
                style={{ left: x, top: y, width: w, height: h }}
                {...tip.on(`${folder.name}: ${formatBytes(folder.diskBytes)}`)}
              />
            );
          const headed = h > 44 && w > 70;
          const area = { x: 0, y: 0, w: w - 8, h: h - 6 - (headed ? HEADING : 2) };
          // Files that would be too small to see go in with the folder's smaller files.
          const inside = files.filter((file) => file.top === folder.name && (file.diskBytes / folder.diskBytes) * area.w * area.h >= SMALLEST_TILE);
          const rest = Math.max(0, folder.diskBytes - inside.reduce((sum, file) => sum + file.diskBytes, 0));
          const tiles = squarify(
            [...inside.map((file) => ({ file, bytes: file.diskBytes })), ...(rest > 0 ? [{ file: null, bytes: rest }] : [])],
            (entry) => entry.bytes,
            area,
          );
          return (
            <div
              key={folder.name}
              className="big-map-folder"
              style={{ left: x, top: y, width: w, height: h }}
              {...tip.on(`${folder.name}: ${formatBytes(folder.diskBytes)}`)}
            >
              {headed && (
                <div className="big-map-head">
                  <span className="mono">{folder.name}</span>
                  <span>{formatBytes(folder.diskBytes)}</span>
                </div>
              )}
              <div className="big-map-inside" style={{ top: headed ? HEADING : 2 }}>
                {tiles.map(({ item, x, y, w, h }) => {
                  const paint = item.file ? paintOf(item.file.kind) : null;
                  const label = w >= 70 && h >= 34;
                  return (
                    <div
                      key={item.file?.path ?? "rest"}
                      className={`big-map-tile${item.file ? "" : " rest"}${label ? " labelled" : ""}`}
                      style={{ left: x + 1, top: y + 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2), background: paint?.fill, color: paint?.ink }}
                      {...tip.on(item.file ? describe(item.file) : `${folder.name}: its smaller files, ${formatBytes(item.bytes)}`)}
                    >
                      {label && (
                        <>
                          <span className="big-map-name">{item.file ? item.file.name : "Smaller files"}</span>
                          <span className="big-map-amount">{formatBytes(item.bytes)}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/** "Content/Hero.psd: 2.1 MB on disk, 3 versions, deleted", for a tile's tip. */
function describe(file: FileEntry): string {
  const notes = [
    `${formatBytes(file.diskBytes)} on disk`,
    file.versions > 1 ? plural(file.versions, "version") : null,
    file.current ? null : "deleted",
    file.inLfs ? "in Git LFS now" : null,
  ];
  return `${file.path}: ${notes.filter(Boolean).join(", ")}`;
}

interface Tip {
  on: (text: string) => { onMouseMove: (event: MouseEvent) => void; onMouseLeave: () => void };
  hide: () => void;
  node: ReactNode;
}

/** A small label that follows the pointer over the map (the innermost thing under it). */
function useTip(): Tip {
  const [shown, setShown] = useState<{ text: string; x: number; y: number } | null>(null);
  return {
    on: (text) => ({
      onMouseMove: (event) => {
        event.stopPropagation();
        setShown({ text, x: event.clientX, y: event.clientY });
      },
      onMouseLeave: () => setShown(null),
    }),
    hide: () => setShown(null),
    node: shown && (
      <div className="big-tip" style={{ left: Math.min(shown.x + 12, window.innerWidth - 310), top: shown.y + 16 }}>
        {shown.text}
      </div>
    ),
  };
}
