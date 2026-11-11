import { useEffect, useState } from "react";

/**
 * The time now, updated every `every` milliseconds while `active`: for times that grow
 * while you look at them, like how long a check has been running.
 */
export function useNow(every: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    // Catch up at once after a pause, then keep time.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, every);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [every, active]);
  return now;
}
