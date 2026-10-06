/**
 * Reads a full UTC time such as `2026-10-06T12:00:00Z` (an ISO 8601 time that ends in Z, with optional fraction digits)
 * and returns it in milliseconds since 1970, or null when the text is anything else, a day that does not exist included.
 * This is how a visitor fixes the moment the response arrives so a lifetime is always counted from the same instant.
 */
export function parseUtcTime(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(text);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  const ms = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0'));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const at = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const check = new Date(at);
  // Date.UTC rolls a day that does not exist (31 February) into the next month: refuse it.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return at;
}
