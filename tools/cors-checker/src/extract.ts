import { getEntries, trimSpaceAndTab, type HeaderEntry } from './headers';

/**
 * The elements of a comma separated header (the Fetch Standard's "extract header list values"): null when the name is
 * absent, otherwise the elements of every line of that name in order, with the spaces and tabs around each element
 * removed and empty elements dropped.
 */
export function extractHeaderListValues(entries: readonly HeaderEntry[], name: string): string[] | null {
  const found = getEntries(entries, name);
  if (found.length === 0) return null;
  const values: string[] = [];
  for (const entry of found) {
    let start = 0;
    for (;;) {
      const comma = entry.value.indexOf(',', start);
      const element = trimSpaceAndTab(entry.value.slice(start, comma < 0 ? entry.value.length : comma));
      if (element !== '') values.push(element);
      if (comma < 0) break;
      start = comma + 1;
    }
  }
  return values;
}
