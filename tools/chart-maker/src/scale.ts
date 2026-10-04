/**
 * Axis ticks and the one function that writes every number a reader sees. Pure: no DOM, no clock, nothing logged.
 */

/** A number rounded to 12 significant digits, so a multiple like 3 * 0.1 is 0.3 and not 0.30000000000000004. */
function clean(n: number): number {
  return Number(n.toPrecision(12)) + 0;
}

/**
 * Round tick values for a value axis that has to cover `min` to `max`, with about `count` gaps between them. The gap is
 * 1, 2 or 5 times a power of ten, the first tick is at or below `min`, the last at or above `max`, and zero is a tick
 * whenever the range crosses it. A range of no width (one value, or all values equal) is widened to reach zero, so the
 * axis always has two or more ticks.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  let low = Math.min(min, max);
  let high = Math.max(min, max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  if (low === high) {
    if (low === 0) high = 1;
    else if (low > 0) low = 0;
    else high = 0;
  }
  const gaps = Math.max(1, Math.floor(count));
  const raw = (high - low) / gaps;
  const power = 10 ** Math.floor(Math.log10(raw));
  // A relative tolerance keeps 0.2 / 0.1 (a hair over 2 in some orders of arithmetic) a 2 and not a 5.
  const lead = raw / power;
  const multiplier = lead <= 1.000001 ? 1 : lead <= 2.000001 ? 2 : lead <= 5.000001 ? 5 : 10;
  const step = multiplier * power;
  if (!(step > 0) || !Number.isFinite(step)) return [low, high];
  const first = Math.floor(low / step + 1e-9);
  const last = Math.ceil(high / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last && ticks.length < 64; k++) ticks.push(clean(k * step));
  return ticks;
}

/**
 * The text of a number as a reader sees it: at most six significant digits, written without an exponent for every size
 * from 1e-20 up to 1e21 (so 0.0000001 stays 0.0000001), and never a negative zero. A number that is not finite reads as
 * 0 (the reader of this package never lets one through).
 */
export function formatValue(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Number(n.toPrecision(6));
  if (rounded === 0) return '0';
  const size = Math.abs(rounded);
  // JavaScript writes 1e-7 as an exponent; below 1e-6 the digits are written out instead.
  if (size >= 1e-6 || size < 1e-20) return String(rounded);
  const [mantissa, exponent] = rounded.toExponential().split('e');
  const digits = mantissa!.replace('-', '').replace('.', '');
  const places = -Number(exponent) - 1;
  return (rounded < 0 ? '-' : '') + '0.' + '0'.repeat(places) + digits;
}
