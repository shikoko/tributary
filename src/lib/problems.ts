// Errors that stop the interface, kept in the problems log (see src-tauri/src/problems.rs)
// so they can be sent with a report later.
import { reportProblem } from "../api";

/** How many problems one window keeps, so an error that repeats can't fill the log. */
const MAX_REPORTS = 20;
/** How much of a stack trace to keep. */
const STACK_LINES = 12;

const reported = new Set<string>();

/** `error` as text for the log: its message, and where it happened. */
export function describeProblem(error: unknown, where?: string | null): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(`${error.name}: ${error.message}`);
    const stack = (error.stack ?? "").split("\n").filter((line) => line.trim());
    // Chromium starts the stack with the message; WebKit doesn't.
    if (stack[0]?.startsWith(`${error.name}:`)) stack.shift();
    parts.push(...stack.slice(0, STACK_LINES).map((line) => `  ${line.trim()}`));
  } else {
    parts.push(String(error));
  }
  const components = where
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, STACK_LINES);
  if (components?.length) parts.push("In:", ...components.map((line) => `  ${line}`));
  return parts.join("\n");
}

/**
 * Keep `what` in the problems log, once (the same problem again isn't kept twice), at most
 * MAX_REPORTS times. Never fails: where the log is, or null.
 */
export async function keepProblem(what: string): Promise<string | null> {
  if (reported.has(what) || reported.size >= MAX_REPORTS) return null;
  reported.add(what);
  try {
    return await reportProblem(what);
  } catch {
    return null;
  }
}

/** Keep errors nothing else caught (in event handlers, timers and promises) in the log too. */
export function watchForProblems() {
  window.addEventListener("error", (event) => {
    // Pictures and scripts that don't load are errors too, without one: not problems.
    if (!event.error && !event.message) return;
    void keepProblem(`uncaught: ${describeProblem(event.error ?? event.message)}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void keepProblem(`unhandled: ${describeProblem(event.reason)}`);
  });
}
