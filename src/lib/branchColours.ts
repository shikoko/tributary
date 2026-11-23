// The colours of the graph's branches. A branch line is a run of commits down the graph, from
// where a branch starts to where it ends (merged, or where it was branched from), and has one
// colour, the way Settings → Appearance → Graph says:
// - "own": the main branch's line in main's colour, which no other line takes, and every other
//   line a colour of its own from the palette, not the one of a line beside it.
// - "kinds": each line the colour of its kind of branch (features, fixes, releases...), from
//   its branch's name, or from the message of the merge that brought it in once the branch is
//   gone; main's line in main's colour. Lines of a kind side by side can take shades of it.
import type { CommitRow } from "../api";
import {
  BLACK,
  BRANCH_COLOURS,
  lanePalette,
  mix,
  parseHex,
  toHex,
  WHITE,
  type Appearance,
  type BranchColouring,
  type BranchKind,
  type Theme,
} from "./appearance";

/** The colours worked out from the settings, for a theme. */
export interface BranchScheme {
  colouring: BranchColouring;
  /** The main branch's names ("*" stands for anything). */
  mainNames: string[];
  main: string;
  /** "own": the colours the other branches take, without main's (or ones too close to it). */
  palette: string[];
  /** "kinds": each kind's names and its colours (one, or its shades), in order. */
  kinds: { patterns: string[]; colours: string[] }[];
  /** Branches of no kind. */
  other: string[];
}

/** A kind's colour: its own, or the theme's for it. */
export function kindColour(kind: BranchKind, theme: Theme): string {
  return kind.colour ?? BRANCH_COLOURS[theme][kind.preset ?? "other"];
}

export const mainColour = (appearance: Appearance, theme: Theme) => appearance.mainColour ?? BRANCH_COLOURS[theme].main;
export const otherColour = (appearance: Appearance, theme: Theme) => appearance.otherColour ?? BRANCH_COLOURS[theme].other;

/** A colour and two shades of it: lighter, then darker (the other way round in the light theme). */
export function shadesOf(colour: string, theme: Theme): string[] {
  const rgb = parseHex(colour);
  if (!rgb) return [colour];
  const lighter = toHex(mix(rgb, WHITE, 0.4));
  const darker = toHex(mix(rgb, BLACK, 0.3));
  return theme === "dark" ? [colour, lighter, darker] : [colour, darker, lighter];
}

/** How far apart two colours look, roughly: 0 the same, about 765 black from white. */
function distance(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return Infinity;
  // Weighted the way the eye weighs red, green and blue.
  const [dr, dg, db] = [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Close enough to main's colour to be taken for it. */
const NEAR_MAIN = 110;

export function branchScheme(appearance: Appearance, theme: Theme): BranchScheme {
  const main = mainColour(appearance, theme);
  const palette = lanePalette(appearance, theme);
  const apart = palette.filter((colour) => distance(colour, main) > NEAR_MAIN);
  const colours = (colour: string) => (appearance.shades ? shadesOf(colour, theme) : [colour]);
  return {
    colouring: appearance.branchColours,
    mainNames: appearance.mainNames,
    main,
    palette: apart.length >= 2 ? apart : palette.filter((colour) => colour !== main),
    kinds: appearance.kinds.map((kind) => ({ patterns: kind.patterns, colours: colours(kindColour(kind, theme)) })),
    other: colours(otherColour(appearance, theme)),
  };
}

/** Whether a branch's name fits a pattern: "*" stands for anything, and case doesn't matter. */
export function fits(name: string, pattern: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i").test(name);
}

/** The branch a merge brought in, from its message: GitHub's, GitLab's, Bitbucket's or git's own. */
export function mergedBranch(summary: string): string | null {
  const pull = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(summary);
  if (pull) return pull[1];
  const tracking = /^Merge remote-tracking branch '[^/']+\/([^']+)'/.exec(summary);
  if (tracking) return tracking[1];
  const branch = /^Merge branch '([^']+)'/.exec(summary);
  if (branch) return branch[1];
  const bitbucket = /^Merged in (\S+)/.exec(summary);
  return bitbucket ? bitbucket[1] : null;
}

/** A commit's branch name, without its remote: "feature/curtains" for origin/feature/curtains. */
function branchName(commit: CommitRow): string | null {
  const local = commit.refs.find((ref) => ref.kind === "branch");
  if (local) return local.name;
  const remote = commit.refs.find((ref) => ref.kind === "remote" && !ref.name.endsWith("/HEAD"));
  return remote ? remote.name.slice(remote.name.indexOf("/") + 1) : null;
}

/** The main branch's own commits: each main branch's newest (here or on a remote), then first parents. */
function mainCommits(commits: CommitRow[], names: string[]): Set<string> {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const main = new Set<string>();
  for (const commit of commits) {
    const isMain = commit.refs.some((ref) => {
      if (ref.kind !== "branch" && ref.kind !== "remote") return false;
      const short = ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name;
      return names.some((pattern) => fits(short, pattern));
    });
    if (!isMain) continue;
    for (let id: string | undefined = commit.id; id && !main.has(id); id = byId.get(id)?.parents[0]) main.add(id);
  }
  return main;
}

/** Colours for a row's commit and for each of its lines (in the order of `graph.lines`). */
export interface RowColours {
  node: string;
  lines: string[];
}

export interface GraphColours {
  /** Each commit's, in the order of the commits they were worked out for. */
  rows: RowColours[];
  byId: Map<string, RowColours>;
}

export const NO_COLOURS: GraphColours = { rows: [], byId: new Map() };

interface Line {
  main: boolean;
  /** Its branch's name: its newest labelled commit's, or the merge's that brought it in. */
  name: string | null;
  /** Its oldest commit so far, which stays the same as the branch grows. */
  oldest: string | null;
  /** The last row it's in. */
  last: number;
  /** The lines beside it, and the one before it in its column: not its colour. */
  near: Set<Line>;
  /** Uncommitted changes' or a stash's: the colour of the line it leads into. */
  leads: boolean;
  into?: Line;
  colour: string;
}

/** A line's colour isn't the one of a line next to it. */
function link(a: Line | undefined, b: Line | undefined) {
  if (!a || !b || a === b) return;
  a.near.add(b);
  b.near.add(a);
}

/** How close below the line before it a line has to start in a column to be taken for it. */
const FOLLOWS = 3;

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(value);
}

/** Each commit's colours, and its lines', the way `scheme` says. */
export function graphColours(commits: CommitRow[], scheme: BranchScheme): GraphColours {
  const main = mainCommits(commits, scheme.mainNames);
  const all: Line[] = [];
  const start = (onMain: boolean, row: number): Line => {
    const line: Line = { main: onMain, name: null, oldest: null, last: row, near: new Set(), leads: false, colour: "" };
    all.push(line);
    return line;
  };
  // Which line is in each column between one row and the next.
  let above = new Map<number, Line>();
  const lastIn = new Map<number, Line>();
  const rows: { node: Line; lines: Line[] }[] = [];

  commits.forEach((commit, row) => {
    const { column, lines } = commit.graph;
    const onMain = main.has(commit.id);
    const incoming = above.get(column);
    // A branch's line goes on into its next commit; main's line starts at main's newest one
    // (a branch on top of it ends there).
    let own = incoming;
    if (!own || own.main !== onMain || own.leads) {
      own = start(onMain, row);
      own.leads = commit.kind !== "commit";
      // Uncommitted changes coming down into this commit are on its line; a line that ended
      // just above in this column isn't its colour.
      const before = incoming ?? lastIn.get(column);
      if (incoming?.leads) incoming.into ??= own;
      else if (before && !before.leads && row - before.last <= FOLLOWS) link(before, own);
    }
    own.oldest = commit.id;
    own.last = row;
    own.name ??= branchName(commit);

    const below = new Map<number, Line>();
    const colours: Line[] = new Array(lines.length);
    // Lines going past first, so a merge's other parent can join one going to it already.
    lines.forEach(([kind, from, to], index) => {
      if (kind !== 0) return;
      const line = above.get(from) ?? start(false, row);
      line.last = row;
      below.set(to, line);
      colours[index] = line;
    });
    // The line down to the first parent: in this column, or the first one down if none is.
    const firstDown = lines.findIndex(([kind, , to]) => kind === 2 && to === column);
    const first = firstDown >= 0 ? firstDown : lines.findIndex(([kind]) => kind === 2);
    lines.forEach(([kind, from, to], index) => {
      if (kind === 1) {
        // Into this commit from above: its own line, or a branch's that ends here.
        const line = (from === column ? incoming : above.get(from)) ?? own;
        line.last = row;
        if (line.leads && line !== own) line.into ??= own;
        colours[index] = line;
      } else if (kind === 2) {
        let line = index === first ? own : below.get(to);
        if (!line) {
          // A merge's other parent: the branch it brought in.
          line = start(false, row);
          line.name = mergedBranch(commit.summary);
        }
        below.set(to, line);
        colours[index] = line;
      }
    });
    rows.push({ node: own, lines: colours });

    // Lines side by side aren't the same colour.
    const here = new Map(below);
    if (!here.has(column)) here.set(column, own);
    for (const [at, line] of here) link(line, here.get(at + 1));
    for (const [at, line] of below) lastIn.set(at, line);
    above = below;
  });

  // Main's lines first, then the others from the oldest, so new branches at the top fit in
  // around the colours already there rather than move them.
  const kindOf = (line: Line) => {
    const name = line.name ?? "";
    return scheme.kinds.find((kind) => kind.patterns.some((pattern) => fits(name, pattern)))?.colours ?? scheme.other;
  };
  for (const line of all) if (line.main) line.colour = scheme.main;
  const others = all.filter((line) => !line.main && !line.leads).sort((a, b) => b.last - a.last);
  for (const line of others) {
    const own = scheme.colouring === "own";
    const choices = own ? (scheme.palette.length > 0 ? scheme.palette : [scheme.other[0]]) : kindOf(line);
    const taken = new Set([...line.near].map((other) => other.colour).filter(Boolean));
    // Each its own: from a place its oldest commit picks; by kind: the kind's own colour first.
    const from = own ? hash(line.oldest ?? String(all.indexOf(line))) % choices.length : 0;
    let pick = from;
    for (let step = 0; step < choices.length && taken.has(choices[pick]); step++) pick = (from + step + 1) % choices.length;
    line.colour = taken.has(choices[pick]) ? choices[from] : choices[pick];
  }

  // Uncommitted changes and stashes: the colour of the branch they're on.
  for (const line of all) if (line.leads) line.colour = line.into?.colour || scheme.main;

  const result = rows.map(({ node, lines }) => ({ node: node.colour, lines: lines.map((line) => line?.colour ?? node.colour) }));
  return { rows: result, byId: new Map(commits.map((commit, index) => [commit.id, result[index]])) };
}
