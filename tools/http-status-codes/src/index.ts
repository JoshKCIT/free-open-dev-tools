import meta from './meta.json';
import { STATUS_CODES, UNASSIGNED_RANGES, REGISTRY_SNAPSHOT } from './registry';
import type { StatusEntry, StatusReference, StatusRegistrationStatus, UnassignedRange } from './registry';
import { UNOFFICIAL_CODES } from './unofficial';
import type { UnofficialStatusEntry } from './unofficial';

export { meta, STATUS_CODES, UNASSIGNED_RANGES, REGISTRY_SNAPSHOT, UNOFFICIAL_CODES };
export type { StatusEntry, StatusReference, StatusRegistrationStatus, UnassignedRange, UnofficialStatusEntry };

/** One row of a search result: a registered, temporary, unused or unofficial code. */
export interface StatusSearchRow {
  code: number;
  phrase: string;
  statusClass: string;
  definedIn: StatusReference[];
  statusLabel: string;
}

export interface StatusSearchResult {
  rows: StatusSearchRow[];
  note?: string;
}

/** The status class of a code, such as '4xx' for 404. */
export function statusClass(code: number): string {
  return `${Math.floor(code / 100)}xx`;
}

function registrationLabel(status: StatusRegistrationStatus): string {
  if (status === 'temporary') return 'Temporary registration';
  if (status === 'unused') return 'Unused';
  return 'Registered';
}

let allRowsCache: StatusSearchRow[] | undefined;

/** Every registered and unofficial code as one combined, code-ordered list. Built once and cached. */
function allRows(): StatusSearchRow[] {
  if (allRowsCache) return allRowsCache;
  const registered: StatusSearchRow[] = STATUS_CODES.map((e) => ({
    code: e.code,
    phrase: e.description,
    statusClass: statusClass(e.code),
    definedIn: e.references,
    statusLabel: registrationLabel(e.status),
  }));
  const unofficial: StatusSearchRow[] = UNOFFICIAL_CODES.map((e) => ({
    code: e.code,
    phrase: e.description,
    statusClass: statusClass(e.code),
    definedIn: [{ label: e.origin, url: e.sourceUrl }],
    statusLabel: e.label,
  }));
  allRowsCache = [...registered, ...unofficial].sort((a, b) => a.code - b.code);
  return allRowsCache;
}

function findUnassignedRange(code: number): UnassignedRange | undefined {
  return UNASSIGNED_RANGES.find((r) => code >= r.start && code <= r.end);
}

/**
 * Searches the combined registered + unofficial code list.
 *
 * - Empty query: every code.
 * - A bare class digit (1-5) or an `Nxx` form: every code in that class.
 * - A three-digit number: that exact code, an unassigned note, or a not-a-code note.
 * - `rfc <number>` or a bare 4-5 digit number: every code whose reference cites that RFC.
 * - Anything else: a case-insensitive substring match against the reason phrase.
 */
export function searchStatusCodes(query: string): StatusSearchResult {
  const q = query.trim();
  const rows = allRows();

  if (q === '') return { rows };

  const classMatch = /^([1-5])(xx)?$/i.exec(q);
  if (classMatch) {
    const digit = classMatch[1];
    return { rows: rows.filter((r) => r.statusClass === `${digit}xx`) };
  }

  if (/^\d{3}$/.test(q)) {
    const code = Number(q);
    const row = rows.find((r) => r.code === code);
    if (row) return { rows: [row] };
    const range = findUnassignedRange(code);
    if (range) {
      return {
        rows: [],
        note: `${code} is unassigned in the IANA HTTP Status Code Registry (unassigned range ${range.start}-${range.end}).`,
      };
    }
    return { rows: [], note: `${code} is not a valid HTTP status code.` };
  }

  const rfcMatch = /^(?:rfc\s*)?(\d{4,5})$/i.exec(q);
  if (rfcMatch) {
    const num = rfcMatch[1];
    const matched = rows.filter((r) => r.definedIn.some((d) => new RegExp(`^RFC ${num}\\b`, 'i').test(d.label)));
    if (matched.length > 0) return { rows: matched };
    return { rows: [], note: `No status code cites RFC ${num}.` };
  }

  const lower = q.toLowerCase();
  const matched = rows.filter((r) => r.phrase.toLowerCase().includes(lower));
  if (matched.length === 0) return { rows: [], note: `No status code matches "${query}".` };
  return { rows: matched };
}
