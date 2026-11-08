import type { KeyboardEvent } from "react";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  LANE_PALETTE_LABELS,
  LANE_PALETTES,
  normalizeAppearance,
  type Appearance,
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

/** The accent colours, and any colour you like. */
function AccentPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const custom = !ACCENTS.some((accent) => accent.color === value);
  return (
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
      <label className={`accent-swatch accent-custom${custom ? " chosen" : ""}`} title="Any colour" style={custom ? { background: value } : undefined}>
        <input
          type="color"
          value={value}
          aria-label="Any colour"
          onChange={(event) => onChange(event.target.value)}
        />
        {custom ? <CheckIcon size={12} /> : <span aria-hidden>+</span>}
      </label>
    </div>
  );
}

/** A row of the lane colours, for each choice. */
function LanePicker({ value, theme, onChange }: { value: LanePaletteName; theme: Theme; onChange: (value: LanePaletteName) => void }) {
  return (
    <div className="lane-picker" role="radiogroup" aria-label="Graph colours" onKeyDown={arrowKeys}>
      {(Object.keys(LANE_PALETTES) as LanePaletteName[]).map((name) => (
        <button
          key={name}
          role="radio"
          aria-checked={value === name}
          tabIndex={value === name ? 0 : -1}
          className={`lane-choice${value === name ? " chosen" : ""}`}
          onClick={() => onChange(name)}
        >
          <span className="lane-sample" aria-hidden>
            {LANE_PALETTES[name][theme].slice(0, 8).map((color) => (
              <span key={color} style={{ background: color }} />
            ))}
          </span>
          <span>{LANE_PALETTE_LABELS[name]}</span>
        </button>
      ))}
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
      content: <LanePicker value={appearance.lanes} theme={theme} onChange={(value) => change({ lanes: value })} />,
    },
    {
      kind: "select",
      label: "Graph line bends",
      hint: "How the lines turn from one branch's lane to another's.",
      value: appearance.curves,
      options: [
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
