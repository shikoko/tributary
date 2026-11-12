import { useState, type ReactNode } from "react";
import { stepFocus } from "../lib/inputMode";
import { Dialog } from "./Dialog";
import { CloseIcon } from "./Icons";
import { Loader } from "./Loader";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";

/** One setting: an on/off switch, a choice, or something of its own. */
export type SettingRow =
  | { kind: "toggle"; label: string; hint?: string; value: boolean; set: (value: boolean) => void; disabled?: boolean }
  | {
      kind: "select";
      label: string;
      hint?: string;
      value: string;
      options: { value: string; label: string }[];
      set: (value: string) => void;
      disabled?: boolean;
    }
  | { kind: "custom"; label: string; hint?: string; content: ReactNode }
  /** Still being read: the loader, in place of the settings. */
  | { kind: "loading"; label: string };

export interface SettingsSection {
  title: string;
  /** Shown under the title in the list, like the repository's name. */
  subtitle?: string;
  icon?: ReactNode;
  /** Shown in the list under this section, indented: part of it (Commit list under Appearance). */
  parent?: string;
  /** A line above it in the list, setting it apart (Export and import, at the end). */
  separated?: boolean;
  rows: SettingRow[];
}

/**
 * Every setting in one place, a section at a time: the sections on the left, the chosen
 * one's settings on the right. Changes apply right away.
 */
export function SettingsDialog({
  sections,
  initial,
  title = "Settings",
  onClose,
}: {
  sections: SettingsSection[];
  initial?: string;
  /** Like "Settings for notebook". */
  title?: string;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(initial ?? sections[0]?.title);
  const section = sections.find((candidate) => candidate.title === chosen) ?? sections[0];
  return (
    <Dialog
      title={title}
      className="settings-window"
      onCancel={onClose}
      buttons={
        <Button kind="secondary" onClick={onClose} autoFocus>
          Done
        </Button>
      }
    >
      <div className="settings">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {sections.map((candidate, index) => {
            const selected = candidate === section;
            // A section inside another: lines join it to that one (the last one ends them).
            const sub = candidate.parent
              ? ` sub${sections[index - 1]?.parent !== candidate.parent ? " first" : ""}${sections[index + 1]?.parent !== candidate.parent ? " last" : ""}`
              : "";
            return [
              candidate.separated && <div key={`${candidate.title}-line`} className="settings-nav-line" role="presentation" />,
              <button
                key={candidate.title}
                role="tab"
                id={`settings-tab-${candidate.title}`}
                aria-selected={selected}
                aria-controls="settings-panel"
                tabIndex={selected ? 0 : -1}
                className={`settings-tab${selected ? " selected" : ""}${sub}`}
                onClick={() => setChosen(candidate.title)}
                onKeyDown={(event) => {
                  // ↑ ↓ Home End move between the sections, showing each.
                  const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("[role=tab]")];
                  const next = stepFocus(tabs, event.currentTarget, event.key === "ArrowLeft" || event.key === "ArrowRight" ? "" : event.key);
                  if (!next) return;
                  event.preventDefault();
                  next.focus();
                  next.click();
                }}
              >
                <span className="settings-tab-icon">{candidate.icon}</span>
                <span className="settings-tab-text">
                  <span>{candidate.title}</span>
                  {candidate.subtitle && <span className="settings-tab-subtitle">{candidate.subtitle}</span>}
                </span>
              </button>,
            ];
          })}
        </nav>
        {section && (
          <section key={section.title} className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section.title}`}>
            <h3>
              {section.parent && (
                <>
                  <button className="settings-panel-parent" onClick={() => setChosen(section.parent!)}>
                    {section.parent}
                  </button>
                  <span className="settings-panel-crumb" aria-hidden>
                    ›
                  </span>
                </>
              )}
              {section.title}
              {section.subtitle && <span className="settings-panel-subtitle">{section.subtitle}</span>}
            </h3>
            {section.rows.map((row, index) => (
              // Rows of buttons have no label of their own: their place tells them apart.
              <SettingRowView key={row.label || `row-${index}`} row={row} />
            ))}
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** One setting: its label and hint on the left, its control on the right. */
function SettingRowView({ row }: { row: SettingRow }) {
  if (row.kind === "loading") return <Loader size={56} title={row.label} />;
  return (
    <div className={`settings-row${"disabled" in row && row.disabled ? " disabled" : ""}`}>
      <div className="settings-label">
        <span>{row.label}</span>
        {row.hint && <span className="settings-hint">{row.hint}</span>}
      </div>
      <div className="settings-control">
        {row.kind === "toggle" ? (
          <Switch on={row.value} onChange={row.set} label={row.label} disabled={row.disabled} />
        ) : row.kind === "select" ? (
          <select className="settings-select" value={row.value} onChange={(event) => row.set(event.target.value)} disabled={row.disabled} aria-label={row.label}>
            {row.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          row.content
        )}
      </div>
    </div>
  );
}

/** A list of names, like protected branches, with a field to add more. */
export function NameList({ names, onChange, placeholder }: { names: string[]; onChange: (names: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (name && !names.includes(name)) onChange([...names, name]);
    setDraft("");
  };
  return (
    <div className="name-list">
      {names.map((name) => (
        <span key={name} className="name-chip">
          <span className="chip-text">{name}</span>
          <button onClick={() => onChange(names.filter((other) => other !== name))} aria-label={`Remove ${name}`} title={`Remove ${name}`}>
            <CloseIcon size={10} />
          </button>
        </span>
      ))}
      <input
        className="name-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
