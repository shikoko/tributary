import { useEffect, useState, type KeyboardEvent } from "react";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  LANE_PALETTE_LABELS,
  LANE_PALETTES,
  lanePalette,
  MAX_CUSTOM_LANES,
  normalizeAppearance,
  parseHex,
  toHex,
  type Appearance,
  type LaneChoice,
  type LanePaletteName,
  type Theme,
  type ThemeChoice,
} from "../lib/appearance";
import { CheckIcon } from "./Icons";
import type { SettingRow } from "./SettingsDialog";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Same as the system" },
];

/** Arrow keys move between a radio group's buttons, as in any radio group. */
function arrowKeys(event: KeyboardEvent<HTMLElement>) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = buttons[(index + step + buttons.length) % buttons.length];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}

/** Dark, light or the system's, each with a small picture of the window in it. */
function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (value: ThemeChoice) => void }) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme" onKeyDown={arrowKeys}>
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          role="radio"
          aria-checked={value === theme.value}
          tabIndex={value === theme.value ? 0 : -1}
          className={`theme-choice${value === theme.value ? " chosen" : ""}`}
          onClick={() => onChange(theme.value)}
        >
          <span className={`theme-sample ${theme.value}`} aria-hidden>
            <span className="theme-sample-sidebar" />
            <span className="theme-sample-rows">
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="theme-choice-label">{theme.value === "system" ? "System" : theme.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A colour typed as `#rrggbb` (or `rrggbb`, or `#rgb`): applied once it's a whole colour. */
function HexField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (text: string) => {
    const rgb = parseHex(text);
    if (rgb) onChange(toHex(rgb));
    else setDraft(value);
  };
  return (
    <input
      className="hex-field mono"
      value={draft}
      spellCheck={false}
      maxLength={7}
      aria-label={label}
      onChange={(event) => {
        setDraft(event.target.value);
        // Applied as soon as it's six digits, without waiting for Enter.
        if (/^#?[0-9a-f]{6}$/i.test(event.target.value.trim())) commit(event.target.value);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(draft);
        if (event.key === "Escape" && draft !== value) {
          event.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/** The accent colours, and any colour you like (from the picker, or typed). */
function AccentPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const custom = !ACCENTS.some((accent) => accent.color === value);
  return (
    <div className="accent-row">
      <div className="accent-picker" role="radiogroup" aria-label="Accent colour" onKeyDown={arrowKeys}>
        {ACCENTS.map((accent) => {
          const chosen = accent.color === value;
          return (
            <button
              key={accent.color}
              role="radio"
              aria-checked={chosen}
              aria-label={accent.name}
              title={accent.name}
              tabIndex={chosen || (custom && accent === ACCENTS[0]) ? 0 : -1}
              className={`accent-swatch${chosen ? " chosen" : ""}`}
              style={{ background: `linear-gradient(135deg, ${accent.color}, ${accent.end})` }}
              onClick={() => onChange(accent.color)}
            >
              {chosen && <CheckIcon size={12} />}
            </button>
          );
        })}
        <label className={`accent-swatch accent-custom${custom ? " chosen" : ""}`} title="Pick any colour" style={custom ? { background: value } : undefined}>
          <input type="color" value={value} aria-label="Pick any accent colour" onChange={(event) => onChange(event.target.value)} />
          {custom ? <CheckIcon size={12} /> : <span aria-hidden>+</span>}
        </label>
      </div>
      <HexField value={value} onChange={onChange} label="Accent colour, as a hex code" />
    </div>
  );
}

/** A row of the lane colours, for each choice, and yours. */
function LanePicker({ value, custom, theme, onChange }: { value: LaneChoice; custom: string[]; theme: Theme; onChange: (value: LaneChoice) => void }) {
  const choices: LaneChoice[] = [...(Object.keys(LANE_PALETTES) as LanePaletteName[]), "custom"];
  return (
    <div className="lane-picker" role="radiogroup" aria-label="Graph colours" onKeyDown={arrowKeys}>
      {choices.map((name) => {
        const colors = name === "custom" ? custom : LANE_PALETTES[name][theme];
        return (
          <button
            key={name}
            role="radio"
            aria-checked={value === name}
            tabIndex={value === name ? 0 : -1}
            className={`lane-choice${value === name ? " chosen" : ""}`}
            onClick={() => onChange(name)}
          >
            <span className="lane-sample" aria-hidden>
              {colors.length > 0 ? colors.slice(0, 8).map((color, index) => <span key={`${color}-${index}`} style={{ background: color }} />) : <span className="lane-sample-empty">+</span>}
            </span>
            <span>{name === "custom" ? "Your own" : LANE_PALETTE_LABELS[name]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Your own lane colours: click one to change it, × to take it out, + to add one. */
function LaneEditor({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  const set = (index: number, color: string) => onChange(colors.map((each, i) => (i === index ? color : each)));
  return (
    <div className="lane-editor">
      {colors.map((color, index) => (
        <span key={index} className="lane-editor-swatch">
          <label style={{ background: color }} title={`Lane ${index + 1}: ${color}. Click to change it.`}>
            <input type="color" value={color} aria-label={`Lane ${index + 1} colour`} onChange={(event) => set(index, event.target.value)} />
          </label>
          {colors.length > 2 && (
            <button className="lane-editor-remove" onClick={() => onChange(colors.filter((_, i) => i !== index))} aria-label={`Remove lane ${index + 1}'s colour`} title="Take it out">
              ×
            </button>
          )}
        </span>
      ))}
      {colors.length < MAX_CUSTOM_LANES && (
        <label className="lane-editor-add" title="Add a colour">
          <input
            type="color"
            value="#888888"
            aria-label="Add a lane colour"
            onChange={(event) => onChange([...colors, event.target.value])}
          />
          +
        </label>
      )}
    </div>
  );
}

/** The Appearance section's rows. */
export function appearanceRows(stored: Partial<Appearance>, set: (value: Partial<Appearance>) => void, theme: Theme): SettingRow[] {
  const appearance = normalizeAppearance(stored);
  const change = (patch: Partial<Appearance>) => set({ ...appearance, ...patch });
  const changed = JSON.stringify(appearance) !== JSON.stringify(DEFAULT_APPEARANCE);
  return [
    {
      kind: "custom",
      label: "Theme",
      hint: appearance.theme === "system" ? `Light or dark with your system (${theme} now).` : undefined,
      content: <ThemePicker value={appearance.theme} onChange={(value) => change({ theme: value })} />,
    },
    {
      kind: "custom",
      label: "Accent colour",
      hint: "Buttons, selections, links, focus and the checked-out branch.",
      content: <AccentPicker value={appearance.accent} onChange={(value) => change({ accent: value })} />,
    },
    {
      kind: "custom",
      label: "Graph colours",
      hint: "The branches' lines and labels in the commit list.",
      content: (
        <LanePicker
          value={appearance.lanes}
          custom={appearance.customLanes}
          theme={theme}
          onChange={(value) =>
            change(
              value === "custom" && appearance.customLanes.length < 2
                ? // Start your own from the colours you're looking at.
                  { lanes: "custom", customLanes: [...lanePalette(appearance, theme)] }
                : { lanes: value },
            )
          }
        />
      ),
    },
    ...(appearance.lanes === "custom"
      ? [
          {
            kind: "custom" as const,
            label: "Your graph colours",
            hint: "Click a colour to change it. The branches take them in turn, in light and dark themes alike.",
            content: <LaneEditor colors={appearance.customLanes} onChange={(colors) => change({ customLanes: colors })} />,
          },
        ]
      : []),
    {
      kind: "select",
      label: "Commits on the graph",
      hint: "Merges are small dots either way.",
      value: appearance.nodes,
      options: [
        { value: "authors", label: "Their authors' pictures" },
        { value: "dots", label: "Dots" },
      ],
      set: (value) => change({ nodes: value as Appearance["nodes"] }),
    },
    {
      kind: "select",
      label: "Graph line bends",
      hint: "How the lines turn from one branch's lane to another's.",
      value: appearance.curves,
      options: [
        { value: "mixed", label: "Smooth next door, round further" },
        { value: "round", label: "Round" },
        { value: "smooth", label: "Smooth (like Apple's corners)" },
        { value: "tight", label: "Tight" },
        { value: "sweep", label: "Sweeping" },
      ],
      set: (value) => change({ curves: value as Appearance["curves"] }),
    },
    {
      kind: "select",
      label: "Added and removed lines",
      hint: "Blue and orange are easier to tell apart with red–green colour blindness.",
      value: appearance.diffColors,
      options: [
        { value: "green-red", label: "Green and red" },
        { value: "blue-orange", label: "Blue and orange" },
      ],
      set: (value) => change({ diffColors: value as Appearance["diffColors"] }),
    },
    {
      kind: "custom",
      label: "Start over",
      hint: "Dark, with the azure accent and vivid graph colours.",
      content: (
        <button className="outline-button" onClick={() => set({})} disabled={!changed}>
          <span className="button-label">Reset appearance</span>
        </button>
      ),
    },
  ];
}
