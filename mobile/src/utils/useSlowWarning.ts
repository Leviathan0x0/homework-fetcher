import { useEffect, useState } from "react";

/**
 * Becomes true once `active` has been continuously true for `delayMs`.
 *
 * Used to escalate the copy on genuinely slow operations — the homework
 * re-scrape can legitimately take 15s+, and a progress indicator that says
 * nothing for that long is indistinguishable from a frozen app. Resets as soon as
 * the operation finishes, and clears its timer on unmount.
 */
export function useSlowWarning(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return elapsed;
}
