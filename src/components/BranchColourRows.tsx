// Settings → Appearance → Graph: how the branches are coloured. Two pictures to choose
// between (each its own colour, or by kind of branch), which show your colours as you change
// them, and under them the colours for the way chosen.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { BLACK, LANE_PALETTES, MAX_KINDS, mix, parseHex, toHex, type Appearance, type BranchColouring, type BranchKind, type Theme } from "../lib/appearance";
import { branchScheme, fits, kindColour, mainColour, otherColour } from "../lib/branchColours";
import { CloseIcon, PlusIcon } from "./Icons";
import { NameList } from "./SettingsDialog";
import { Button } from "./ui/Button";

/** The picture's history: main down the left, branches merged into it, one still open. */
const SAMPLE = [
  { name: "docs-tweaks", column: 1, row: 1, from: 0, to: 2 },
  { name: "hotfix/save-crash", column: 1, row: 3, from: 2, to: 4 },
  { name: "feature/dice-game", column: 2, row: 5, from: null, to: 9 },
  { name: "release/1.2", column: 1, row: 6, from: 4, to: 7 },
  { name: "feature/curtains", column: 1, row: 8, from: 7, to: 9 },
];
const MAIN_ROWS = [0, 2, 4, 7, 9];
const ROWS = 10;
const ROW = 17;

/** The picture's branches' colours, the way `colouring` would colour them. */
function sampleColours(appearance: Appearance, theme: Theme, colouring: BranchColouring): string[] {
  const scheme = branchScheme(appearance, theme);
  if (colouring === "own") return SAMPLE.map((_, index) => scheme.palette[index % scheme.palette.length] ?? scheme.other[0]);
  // A kind's branches take its shades in turn.
  const turns = new Map<string[], number>();
  return SAMPLE.map(({ name }) => {
    const colours = scheme.kinds.find((kind) => kind.patterns.some((pattern) => fits(name, pattern)))?.colours ?? scheme.other;
    const turn = turns.get(colours) ?? 0;
    turns.set(colours, turn + 1);
    return colours[turn % colours.length];
  });
}

/** A little history drawn the graph's way, with its branches' names in their colours. */
function BranchSample({ main, colours, theme }: { main: string; colours: string[]; theme: Theme }) {
  const x = (column: number) => 10 + column * 16;
  const y = (row: number) => 10 + row * ROW;
  const bend = (fromX: number, fromY: number, toX: number, toY: number) =>
    `M ${fromX} ${fromY} C ${fromX} ${fromY + ROW * 0.55}, ${toX} ${toY - ROW * 0.55}, ${toX} ${toY}`;
  // Names a little darker in the light theme, to read on it.
  const ink = (colour: string) => {
    const rgb = parseHex(colour);
    return theme === "light" && rgb ? toHex(mix(rgb, BLACK, 0.3)) : colour;
  };
  const label = (row: number, colour: string, text: string) => (
    <g key={text}>
      <rect x={x(3)} y={y(row) - 8} width={text.length * 6.7 + 12} height={16} rx={4} fill={colour} fillOpacity={0.16} />
      <text x={x(3) + 6} y={y(row) + 4} fill={ink(colour)} className="branch-sample-label">
        {text}
      </text>
    </g>
  );
  const height = y(ROWS - 1) + 10;
  return (
    <svg className="branch-sample" width={220} height={height} viewBox={`0 0 220 ${height}`} aria-hidden>
      <path d={`M ${x(0)} ${y(0)} L ${x(0)} ${y(ROWS - 1)}`} stroke={main} strokeWidth={2} fill="none" />
      {SAMPLE.map((branch, index) => {
        const top = branch.from === null ? y(branch.row) : y(branch.from + 1);
        const bottom = y(branch.to - 1);
        return (
          <g key={branch.name} stroke={colours[index]} strokeWidth={2} fill="none">
            {branch.from !== null && <path d={bend(x(0), y(branch.from), x(branch.column), top)} />}
            <path d={`M ${x(branch.column)} ${top} L ${x(branch.column)} ${bottom}`} />
            <path d={bend(x(branch.column), bottom, x(0), y(branch.to))} />
          </g>
        );
      })}
      {MAIN_ROWS.map((row) => (
        <circle key={row} cx={x(0)} cy={y(row)} r={row === 0 ? 5 : 3.5} fill={main} />
      ))}
      {SAMPLE.map((branch, index) => (
        <circle key={branch.name} cx={x(branch.column)} cy={y(branch.row)} r={5} fill={colours[index]} />
      ))}
      {label(0, main, "main")}
      {SAMPLE.map((branch, index) => label(branch.row, colours[index], branch.name))}
    </svg>
  );
}

const WAYS: { value: BranchColouring; title: string; text: string }[] = [
  { value: "own", title: "Each its own colour", text: "Main in its colour; every other branch one of its own." },
  { value: "kinds", title: "By kind of branch", text: "Features, fixes, releases: each kind in its colour." },
];

/** The two ways, as pictures of a history coloured each way, to choose between. */
export function BranchWays({ appearance, theme, onChange }: { appearance: Appearance; theme: Theme; onChange: (value: BranchColouring) => void }) {
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = WAYS.findIndex((way) => way.value === appearance.branchColours);
    const next = WAYS[(at + step + WAYS.length) % WAYS.length];
    onChange(next.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[WAYS.indexOf(next)]?.focus();
  };
  return (
    <div className="branch-ways" role="radiogroup" aria-label="Branch colours" onKeyDown={keys}>
      {WAYS.map((way) => {
        const chosen = appearance.branchColours === way.value;
        return (
          <button key={way.value} role="radio" aria-checked={chosen} tabIndex={chosen ? 0 : -1} className={`lane-choice branch-way${chosen ? " chosen" : ""}`} onClick={() => onChange(way.value)}>
            <span className="branch-way-words">
              <span className="branch-way-title">{way.title}</span>
              <span className="settings-hint">{way.text}</span>
            </span>
            <BranchSample main={mainColour(appearance, theme)} colours={sampleColours(appearance, theme, way.value)} theme={theme} />
          </button>
        );
      })}
    </div>
  );
}

/** A colour to click and change. */
export function ColourSwatch({ colour, label, onChange }: { colour: string; label: string; onChange: (colour: string) => void }) {
  return (
    <label className="colour-swatch" style={{ background: colour }} title={`${label}: ${colour}. Click to change it.`}>
      <input type="color" value={colour} aria-label={label} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** A colour for a new kind: one of the vivid ones nothing has yet. */
function freeColour(appearance: Appearance, theme: Theme): string {
  const used = new Set([mainColour(appearance, theme), otherColour(appearance, theme), ...appearance.kinds.map((kind) => kindColour(kind, theme))]);
  const vivid = LANE_PALETTES.vivid[theme];
  return vivid.find((colour) => !used.has(colour)) ?? vivid[appearance.kinds.length % vivid.length];
}

/**
 * The kinds of branches, one to a line: its colour, its name and the branch names it takes.
 * Main comes first and everything else last, and neither can be taken out.
 */
export function KindsTable({ appearance, theme, change }: { appearance: Appearance; theme: Theme; change: (patch: Partial<Appearance>) => void }) {
  const { kinds } = appearance;
  const setKind = (index: number, patch: Partial<BranchKind>) => change({ kinds: kinds.map((kind, i) => (i === index ? { ...kind, ...patch } : kind)) });
  // A kind just added: its name field takes the focus.
  const added = useRef<number | null>(null);
  const table = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (added.current === null) return;
    table.current?.querySelectorAll<HTMLInputElement>(".kinds-name-input")[added.current]?.focus();
    added.current = null;
  }, [kinds.length]);
  return (
    <div className="kinds-table" ref={table}>
      <div className="kinds-row">
        <ColourSwatch colour={mainColour(appearance, theme)} label="Main's colour" onChange={(mainColour) => change({ mainColour })} />
        <span className="kinds-fixed">Main</span>
        <NameList names={appearance.mainNames} onChange={(mainNames) => change({ mainNames })} placeholder="Add a name" />
        <span />
      </div>
      {kinds.map((kind, index) => (
        <div className="kinds-row" key={index}>
          <ColourSwatch colour={kindColour(kind, theme)} label={`${kind.name || "This kind"}'s colour`} onChange={(colour) => setKind(index, { colour })} />
          <input
            className="kinds-name-input"
            value={kind.name}
            placeholder="Name it"
            aria-label="The kind's name"
            spellCheck={false}
            onChange={(event) => setKind(index, { name: event.target.value })}
          />
          <NameList names={kind.patterns} onChange={(patterns) => setKind(index, { patterns })} placeholder="Add a name" />
          <button
            className="kinds-remove"
            aria-label={`Take out ${kind.name || "this kind"}`}
            title="Take it out"
            onClick={() => change({ kinds: kinds.filter((_, i) => i !== index) })}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      ))}
      <div className="kinds-row">
        <ColourSwatch colour={otherColour(appearance, theme)} label="Everything else's colour" onChange={(otherColour) => change({ otherColour })} />
        <span className="kinds-fixed">Everything else</span>
        <span className="kinds-else">Any other branch</span>
        <span />
      </div>
      <div className="kinds-add">
        <Button
          kind="outline"
          size="small"
          disabled={kinds.length >= MAX_KINDS}
          onClick={() => {
            added.current = kinds.length;
            change({ kinds: [...kinds, { name: "", patterns: [], colour: freeColour(appearance, theme) }] });
          }}
        >
          <PlusIcon size={12} />
          <span className="button-label">Add a kind</span>
        </Button>
      </div>
    </div>
  );
}

/** A heading for a block of its own across the whole width, like a row's label and hint. */
export function BlockHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="settings-label branch-heading">
      <span>{label}</span>
      <span className="settings-hint">{hint}</span>
    </div>
  );
}
