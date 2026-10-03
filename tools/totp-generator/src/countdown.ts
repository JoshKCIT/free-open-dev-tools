/**
 * A countdown bar made of markup and style only, for a frame that allows inline styles and no script: a bar that starts
 * at the share of the step that was left when the codes were made and drains to nothing in the seconds that were left,
 * with a rule that stops the movement for visitors who ask for less of it. Only two whole numbers from the caller are
 * written into it, each checked first, so nothing typed by a visitor can reach the markup.
 */
import { TotpError } from './errors';
import { PERIOD_MAX, PERIOD_MIN } from './otp';

/** A percentage with at most two decimals and no trailing zeros: 100, 56.67, 3.33. */
function percentText(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** The markup for `secondsLeft` seconds left in a step of `period` seconds (1 to `period`). */
export function countdownHtml(secondsLeft: number, period: number): string {
  if (
    typeof secondsLeft !== 'number' ||
    typeof period !== 'number' ||
    !Number.isSafeInteger(secondsLeft) ||
    !Number.isSafeInteger(period) ||
    period < PERIOD_MIN ||
    period > PERIOD_MAX ||
    secondsLeft < 1 ||
    secondsLeft > period
  ) {
    throw new TotpError('The countdown needs whole seconds left, from 1 up to the period.');
  }
  const start = percentText((secondsLeft / period) * 100);
  return (
    '<style>' +
    '.bar{height:14px;border-radius:7px;background:#e3e6ea;overflow:hidden}' +
    `.fill{height:100%;width:${start}%;background:#1a6ef0;animation:drain ${secondsLeft}s linear forwards}` +
    `@keyframes drain{from{width:${start}%}to{width:0%}}` +
    '@media (prefers-reduced-motion: reduce){.fill{animation:none}}' +
    '.t{margin:8px 0 0;font-size:14px}' +
    '</style>' +
    `<div class="bar" role="img" aria-label="${secondsLeft} of ${period} seconds left in the current step"><div class="fill"></div></div>` +
    `<p class="t">${secondsLeft} of ${period} seconds left</p>`
  );
}
