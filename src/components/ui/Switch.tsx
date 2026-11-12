/** An on/off switch, for a setting that takes effect straight away. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} disabled={disabled}>
      <span className="switch-knob" />
    </button>
  );
}
