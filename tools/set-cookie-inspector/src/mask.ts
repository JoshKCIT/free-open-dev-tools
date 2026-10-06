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
