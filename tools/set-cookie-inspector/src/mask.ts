import { joinedCookieStart } from './lines';

/**
 * Masks a value so it can be read over a shoulder without giving it away: its first characters, then its length. It keeps
 * min(4, floor(length / 4)) characters, so a short value shows few or none of them (four of ten would be too much of a
 * ten-character secret). Characters are counted as code points, so a character outside the basic plane counts once.
 * An empty value stays empty.
 */
export function maskValue(value: string): string {
  if (value === '') return '';
  const characters = Array.from(value);
  const keep = Math.min(4, Math.floor(characters.length / 4));
  return `${characters.slice(0, keep).join('')}… (${characters.length} characters)`;
}

/**
 * A setting (a Path, Domain, Expires, Max-Age or SameSite value) as it may be shown while values are masked: as written up
 * to a comma that starts another cookie, and that joined cookie masked. Cookies joined with commas (a combined header
 * copied from a library or a log) put the next cookie's name and value inside the setting before it.
 */
export function maskJoined(value: string): string {
  const cut = joinedCookieStart(value);
  return cut < 0 ? value : `${value.slice(0, cut)}, ${maskValue(value.slice(cut + 1).trimStart())}`;
}
