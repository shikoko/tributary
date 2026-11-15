import { STATE_WORDS, type RunState } from "../lib/runGraph";

/** How something went, as a small round mark: a tick, a cross, a turning arc, a dashed ring. */
export function RunStateIcon({ state, size = 14 }: { state: RunState; size?: number }) {
  return (
    <svg className={`run-state-icon ${state}`} width={size} height={size} viewBox="0 0 16 16" aria-label={STATE_WORDS[state]} role="img">
      {state === "success" && (
        <>
          <circle cx={8} cy={8} r={7} className="fill" />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.6" className="mark" />
        </>
      )}
      {state === "failure" && (
        <>
          <circle cx={8} cy={8} r={7} className="fill" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" className="mark" />
        </>
      )}
      {(state === "running" || state === "queued") && (
        <>
          <circle cx={8} cy={8} r={6} className="track" />
          <path d="M8 2a6 6 0 0 1 6 6" className="arc" />
        </>
      )}
      {state === "cancelled" && (
        <>
          <circle cx={8} cy={8} r={6.2} className="ring" />
          <path d="M5.5 8h5" className="line" />
        </>
      )}
      {state === "skipped" && (
        <>
          <circle cx={8} cy={8} r={6.2} className="ring" />
          <path d="M4.8 11.2l6.4-6.4" className="line" />
        </>
      )}
      {state === "waiting" && <circle cx={8} cy={8} r={6} className="dashed" />}
    </svg>
  );
}
