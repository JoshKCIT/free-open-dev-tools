import { useEffect, useState } from 'react';

/**
 * The seconds left until `endsAt` (device-clock milliseconds), counted down here with an interval of this component's
 * own, so the rest of the page is not re-rendered by the ticks. The interval is made when the block appears and cleared
 * when it goes away.
 *
 * The wrapper is a timer, which has live updates off, so a screen reader is not read a new number every second; the
 * label is fixed text. The progress bar repeats the number, so it is hidden from assistive technology and, for visitors
 * who ask for less motion, from the screen (see `.countdown progress` in styles.css). Only numbers are shown: no input
 * text ever reaches this component.
 */
export default function Countdown({ label, endsAt, periodMs }: { label?: string; endsAt: number; periodMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const leftMs = Math.min(Math.max(endsAt - now, 0), periodMs);
  // Rounded up, so a 30 second step counts 30 down to 1, as authenticator apps and the page's own notes count it.
  const secondsLeft = Math.ceil(leftMs / 1000);
  const periodSeconds = Math.round(periodMs / 1000);
  return (
    <div className="countdown" role="timer" aria-label={label ?? 'Time left in the current step'}>
      <span className="countdown-text">
        {secondsLeft} s left of {periodSeconds} s
      </span>
      <progress max={periodMs} value={leftMs} aria-hidden="true" />
    </div>
  );
}
