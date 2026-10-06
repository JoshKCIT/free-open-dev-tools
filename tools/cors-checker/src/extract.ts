import { getEntries, isToken, trimSpaceAndTab, type HeaderEntry } from './headers';
import { asciiLower } from './safelist';

/** The headers whose value is one number, so a second line of the same name is not allowed (the standard's ABNF allows one header). */
const SINGLE_HEADERS: ReadonlySet<string> = new Set(['access-control-max-age']);

function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

/** The elements of one header line, or null when the line does not fit the ABNF of its name. */
function readLine(value: string, single: boolean): string[] | null {
  if (single) return isDigits(value) ? [value] : null;
  const elements: string[] = [];
  let start = 0;
  for (;;) {
    const comma = value.indexOf(',', start);
    const element = trimSpaceAndTab(value.slice(start, comma < 0 ? value.length : comma));
    if (element !== '') {
      if (!isToken(element)) return null;
      elements.push(element);
    }
    if (comma < 0) return elements;
    start = comma + 1;
  }
}

/**
 * The Fetch Standard's "extract header list values": null when the name is absent; `'failure'` when a line does not fit
 * the ABNF of the name (a list of tokens, or for Access-Control-Max-Age one whole number on one line); otherwise the
 * elements of every line of that name in order. The spaces and tabs around an element are removed and empty elements are
 * dropped, as the `#` list rule allows.
 */
export function extractHeaderListValues(entries: readonly HeaderEntry[], name: string): string[] | null | 'failure' {
  const found = getEntries(entries, name);
  if (found.length === 0) return null;
  const single = SINGLE_HEADERS.has(asciiLower(name));
  if (single && found.length > 1) return 'failure';
  const values: string[] = [];
  for (const entry of found) {
    const elements = readLine(entry.value, single);
    if (elements === null) return 'failure';
    for (const element of elements) values.push(element);
  }
  return values;
}

/** The pasted line of the first line of a name that fails its list rule, or null when none does. */
export function firstBadListLine(entries: readonly HeaderEntry[], name: string): number | null {
  const single = SINGLE_HEADERS.has(asciiLower(name));
  for (const entry of getEntries(entries, name)) {
    if (readLine(entry.value, single) === null) return entry.line;
  }
  return null;
}
