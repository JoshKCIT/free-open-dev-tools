import { Fragment, useEffect, useRef, useState } from 'react';
import type { RunLimit } from '../lib/tool-ui';

/** A run that finishes within this many milliseconds shows nothing new. */
export const CUE_DELAY_MS = 1000;

/** How often the shown cue reads the clock again. */
const TICK_MS = 250;

/**
 * A limit in whole and tenths of seconds, never rounded up: 1500 reads 1.5, 2549 reads 2.5, 10000 reads 10. A limit that
 * is shown larger than the helper enforces would promise the visitor more time than they have.
 */
export function formatLimitSeconds(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/**
 * The visible line. N is floored to whole seconds, so it never exceeds the true elapsed time. Only a total limit can be
 * passed: a quiet limit restarts with every sign of progress, so a long run is not past it.
 */
export function cueSentence(elapsedMs: number, limit: RunLimit | undefined): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (!limit) return `Working… ${seconds} s`;
  const x = formatLimitSeconds(limit.ms);
  if (limit.kind === 'quiet') return `Working… ${seconds} s (stops after ${x} s with no progress)`;
  if (elapsedMs > limit.ms) return `Working… ${seconds} s, past the ${x} s limit, stopping`;
  return `Working… ${seconds} s (stops at ${x} s)`;
}

/** The one sentence a screen reader hears when the cue appears. Fixed text and the limit only: never any input. */
export function startSentence(limit: RunLimit | undefined): string {
  if (!limit) return 'Working.';
  const x = formatLimitSeconds(limit.ms);
  return limit.kind === 'quiet'
    ? `Working. This stops by itself after ${x} seconds with no progress.`
    : `Working. This stops by itself after ${x} seconds.`;
}

/**
 * The working cue: nothing for the first second of a run, then one line beside the output that counts the seconds and
 * names the limit the page's own helper enforces. It owns its own timers (one timeout for the delay, one interval after
 * it) and a single cleanup removes both, so it can be unmounted by a finished run, Cancel, Reset, an edit, a superseding
 * run, a crash or leaving the page and nothing it made stays alive. Only this component re-renders on a tick, so the
 * output tables are never redrawn by the clock. The ticking text is hidden from assistive technology: the runner's
 * status element speaks once at each end instead.
 *
 * `runId` and `startedAt` (a `performance.now()` reading taken when the run began) key the clock on the run, not on
 * `running`: a run that supersedes another restarts the count from zero.
 */
export default function WorkingCue({
  runId,
  startedAt,
  limit,
  cancellable,
  stale,
  onShown,
}: {
  runId: number;
  startedAt: number;
  limit: RunLimit | undefined;
  cancellable: boolean;
  /** An earlier result is still on screen under the cue. */
  stale: boolean;
  /** Called once, when the cue first appears for this run. */
  onShown: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;

  useEffect(() => {
    setElapsedMs(null);
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setElapsedMs(Math.max(0, performance.now() - startedAt));
    const delay = setTimeout(
      () => {
        tick();
        onShownRef.current();
        interval = setInterval(tick, TICK_MS);
      },
      Math.max(0, CUE_DELAY_MS - (performance.now() - startedAt)),
    );
    return () => {
      clearTimeout(delay);
      if (interval !== undefined) clearInterval(interval);
    };
  }, [runId, startedAt]);

  if (elapsedMs === null) return null;
  const parts = [cueSentence(elapsedMs, limit)];
  if (cancellable) parts.push('Press Cancel to stop it.');
  if (stale) parts.push('Showing the previous result while this runs.');
  // A plain space between the parts keeps the text readable when it is copied; the flex layout ignores it.
  return (
    <div className="working-cue" aria-hidden="true">
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 ? ' ' : null}
          <span>{part}</span>
        </Fragment>
      ))}
    </div>
  );
}
