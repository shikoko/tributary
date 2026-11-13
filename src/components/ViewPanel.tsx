import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ACCENTS, CURVE_STYLES, DEFAULT_APPEARANCE, LANE_PALETTES, type Appearance, type CurveStyle, type LanePaletteName, type Theme, type ThemeChoice } from "../lib/appearance";
import type { ColumnOptions } from "./CommitList";
import { CheckIcon, GearIcon } from "./Icons";
import { Switch } from "./ui/Switch";

interface Props {
  /**
   * The View button: it opens under it, lined up with it, whether from a click on it or the
   * keyboard (and a click on it closes it).
   */
  anchor: RefObject<HTMLElement | null>;
  theme: Theme;
  appearance: Partial<Appearance>;
  setAppearance: (value: Partial<Appearance>) => void;
  columns: ColumnOptions;
  setColumns: (value: ColumnOptions) => void;
  dense: boolean;
  setDense: (value: boolean) => void;
  daySeparators: boolean;
  setDaySeparators: (value: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  onSettings: () => void;
  onClose: () => void;
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const BENDS: Record<CurveStyle, string> = { mixed: "Mixed", round: "Round", smooth: "Smooth", tight: "Tight", sweep: "Sweep" };

/** One of a few choices, as a row of buttons. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="diff-switch view-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? "selected" : undefined} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          <span className="button-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * How the window looks, from the View button at the end of the column headings, the View
 * menu or the keyboard (⇧⌘O, Ctrl+Shift+O): the things you change most (the theme and
 * accent, how the graph draws, which columns and how tall the rows are), each a click away
 * and seen straight away. The rest is in Settings → Appearance.
 */
export function ViewPanel(props: Props) {
  const { appearance, setAppearance } = props;
  const look = { ...DEFAULT_APPEARANCE, ...appearance };
  const change = (value: Partial<Appearance>) => setAppearance({ ...appearance, ...value });
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  // Under the button, inside the window: from a button in the window's right half, its right edge
  // on the button's; from one in the left half, its left edge on the button's.
  const { onClose, anchor } = props;
  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth ?? 340;
    // Without its button (the commit list isn't showing), there's nothing to open under.
    if (!anchor.current) return onClose();
    const button = anchor.current.getBoundingClientRect();
    const wanted = button.left + button.width / 2 > window.innerWidth / 2 ? button.right - width : button.left;
    const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8));
    setPlace({ left, top: button.bottom + 6 });
  }, [anchor, onClose]);
  // The focus goes into it, and back to where it was when it closes: the View button, or
  // what had it when the shortcut opened it. On a Mac a click doesn't give a button the focus,
  // so after one there's nothing to go back to but the page: then it's the View button too.
  useEffect(() => {
    const active = document.activeElement;
    const before = active instanceof HTMLElement && active !== document.body ? active : anchor.current;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => before?.focus();
  }, [anchor]);
  // A click outside, or Esc, closes it. (A click on its button closes it too, as the button's own.)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchor]);
  const palettes = Object.keys(LANE_PALETTES) as LanePaletteName[];
  const column = (key: "author" | "date" | "sha" | "checks", label: string) => {
    const on = props.columns[key] !== false;
    return (
      <button key={key} className={`view-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => props.setColumns({ ...props.columns, [key]: !on })}>
        {on && <CheckIcon size={11} />}
        <span className="button-label">{label}</span>
      </button>
    );
  };
  return (
    <div ref={panel} className="view-panel" style={place} role="dialog" aria-label="View">
      <section>
        <h3>Look</h3>
        <div className="view-row">
          <span>Theme</span>
          <Segmented label="Theme" value={look.theme} options={THEMES} onChange={(theme) => change({ theme })} />
        </div>
        <div className="view-row">
          <span>Accent</span>
          <div className="view-accents" role="group" aria-label="Accent colour">
            {ACCENTS.slice(0, 8).map((accent) => (
              <button
                key={accent.color}
                className={`view-accent${look.accent === accent.color ? " on" : ""}`}
                aria-pressed={look.accent === accent.color}
                aria-label={accent.name}
                title={accent.name}
                style={{ background: `linear-gradient(135deg, ${accent.color}, ${accent.end})` }}
                onClick={() => change({ accent: accent.color })}
              />
            ))}
          </div>
        </div>
      </section>
      <section>
        <h3>Graph</h3>
        <div className="view-row">
          <span>Commits as</span>
          <Segmented
            label="Commits as"
            value={look.nodes}
            options={[
              { value: "authors", label: "Pictures" },
              { value: "dots", label: "Dots" },
            ]}
            onChange={(nodes) => change({ nodes })}
          />
        </div>
        <div className="view-row">
          <span>Lines bend</span>
          <Segmented label="Lines bend" value={look.curves} options={CURVE_STYLES.slice(0, 3).map((value) => ({ value, label: BENDS[value] }))} onChange={(curves) => change({ curves })} />
        </div>
        <div className="view-row">
          <span>Colours</span>
          <div className="view-palettes" role="group" aria-label="Lane colours">
            {palettes.map((name) => (
              <button key={name} className={`view-palette${look.lanes === name ? " on" : ""}`} aria-pressed={look.lanes === name} title={name} onClick={() => change({ lanes: name })}>
                {LANE_PALETTES[name][props.theme].slice(0, 5).map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section>
        <h3>Commit list</h3>
        <div className="view-row">
          <span>Columns</span>
          <div className="view-chips">
            {column("author", "Author")}
            {column("date", "Date")}
            {column("sha", "SHA")}
            {column("checks", "CI")}
          </div>
        </div>
        <div className="view-row">
          <span>Rows</span>
          <Segmented
            label="Rows"
            value={props.dense ? "compact" : "roomy"}
            options={[
              { value: "roomy", label: "Roomy" },
              { value: "compact", label: "Compact" },
            ]}
            onChange={(rows) => props.setDense(rows === "compact")}
          />
        </div>
        <label className="view-row view-switch">
          <span>Day separators</span>
          <Switch label="Day separators" on={props.daySeparators} onChange={props.setDaySeparators} />
        </label>
        <label className="view-row view-switch">
          <span>Branches sidebar</span>
          <Switch label="Branches sidebar" on={props.sidebarOpen} onChange={props.setSidebarOpen} />
        </label>
      </section>
      <button
        className="view-more"
        onClick={() => {
          props.onClose();
          props.onSettings();
        }}
      >
        <GearIcon size={13} />
        <span className="button-label">More in Settings</span>
      </button>
    </div>
  );
}
