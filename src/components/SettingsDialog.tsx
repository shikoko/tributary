import { useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { CloseIcon } from "./Icons";

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
  | { kind: "custom"; label: string; hint?: string; content: ReactNode };

export interface SettingsSection {
  title: string;
  rows: SettingRow[];
}

/** Every setting in one place. Changes apply right away. */
export function SettingsDialog({ sections, onClose }: { sections: SettingsSection[]; onClose: () => void }) {
  return (
    <Dialog
      title="Settings"
      wide
      onCancel={onClose}
      buttons={
        <button className="secondary-button" onClick={onClose} autoFocus>
          Done
        </button>
      }
    >
      <div className="settings">
        {sections.map((section) => (
          <section key={section.title} className="settings-section">
            <h3>{section.title}</h3>
            {section.rows.map((row) => (
              <div key={row.label} className={`settings-row${"disabled" in row && row.disabled ? " disabled" : ""}`}>
                <div className="settings-label">
                  <span>{row.label}</span>
                  {row.hint && <span className="settings-hint">{row.hint}</span>}
                </div>
                <div className="settings-control">
                  {row.kind === "toggle" ? (
                    <button
                      role="switch"
                      aria-checked={row.value}
                      aria-label={row.label}
                      className={`switch${row.value ? " on" : ""}`}
                      onClick={() => row.set(!row.value)}
                      disabled={row.disabled}
                    >
                      <span className="switch-knob" />
                    </button>
                  ) : row.kind === "select" ? (
                    <select
                      className="settings-select"
                      value={row.value}
                      onChange={(event) => row.set(event.target.value)}
                      disabled={row.disabled}
                      aria-label={row.label}
                    >
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
            ))}
          </section>
        ))}
      </div>
    </Dialog>
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
          {name}
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
