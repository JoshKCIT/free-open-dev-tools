import { it, expect } from 'vitest';
import { STATUS_CODES, UNOFFICIAL_CODES, searchStatusCodes, statusClass } from '../src/index';

// Source: https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv
// fetched 2026-09-24. The registry's own last-updated date (http-status-codes.xml
// <updated>) is 2025-09-15. 64 is the number of assigned-code data rows in that
// fetched CSV (every row whose Description is not exactly "Unassigned"), counted
// by hand from the fetched file, not derived from STATUS_CODES.
const FETCHED_ASSIGNED_COUNT = 64;

// Six rows hand-transcribed from the same fetched CSV.
const HAND_TRANSCRIBED: { code: number; description: string; reference: string }[] = [
  { code: 100, description: 'Continue', reference: 'RFC9110, Section 15.2.1' },
  { code: 201, description: 'Created', reference: 'RFC9110, Section 15.3.2' },
  { code: 207, description: 'Multi-Status', reference: 'RFC4918' },
  { code: 226, description: 'IM Used', reference: 'RFC3229' },
  { code: 425, description: 'Too Early', reference: 'RFC8470' },
  { code: 451, description: 'Unavailable For Legal Reasons', reference: 'RFC7725' },
];

it('every assigned code in the IANA registry snapshot is present with its reference', () => {
  expect(STATUS_CODES.length).toBe(FETCHED_ASSIGNED_COUNT);

  for (const row of HAND_TRANSCRIBED) {
    const entry = STATUS_CODES.find((e) => e.code === row.code);
    expect(entry, `code ${row.code} missing from STATUS_CODES`).toBeDefined();
    expect(entry!.description).toBe(row.description);
    expect(entry!.references.length).toBeGreaterThan(0);
    const refText = row.reference
      .replace(/^RFC(\d+), Section (.+)$/, 'RFC $1 section $2')
      .replace(/^RFC(\d+)$/, 'RFC $1');
    expect(entry!.references.some((r) => r.label === refText)).toBe(true);
  }
});

it('RFC 9110 codes cite their section and every entry names a defining document', () => {
  const rfc9110Codes = STATUS_CODES.filter((e) => e.references.some((r) => r.label.startsWith('RFC 9110')));
  expect(rfc9110Codes.length).toBeGreaterThan(10);
  for (const e of rfc9110Codes) {
    const ref = e.references.find((r) => r.label.startsWith('RFC 9110'))!;
    expect(ref.label).toMatch(/^RFC 9110 section \d+\.\d+(\.\d+)?$/);
    expect(ref.url).toContain('rfc9110#section-');
  }
  // Every registered/temporary/unused entry names at least one defining document.
  for (const e of STATUS_CODES) {
    expect(e.references.length, `code ${e.code} has no reference`).toBeGreaterThan(0);
  }
});

it('the temporary 104 registration and the unused 306 and 418 are labelled as such', () => {
  const c104 = STATUS_CODES.find((e) => e.code === 104)!;
  expect(c104.status).toBe('temporary');
  expect(c104.description).toContain('TEMPORARY');
  expect(c104.references[0]!.url).toContain('draft-ietf-httpbis-resumable-upload-05');

  const c306 = STATUS_CODES.find((e) => e.code === 306)!;
  expect(c306.status).toBe('unused');
  const c418 = STATUS_CODES.find((e) => e.code === 418)!;
  expect(c418.status).toBe('unused');

  const result104 = searchStatusCodes('104');
  expect(result104.rows[0]!.statusLabel).toBe('Temporary registration');
  const result418 = searchStatusCodes('418');
  expect(result418.rows[0]!.statusLabel).toBe('Unused');
});

it('unofficial nginx and Cloudflare codes are labelled unofficial with their origin', () => {
  const nginx444 = UNOFFICIAL_CODES.find((e) => e.code === 444)!;
  expect(nginx444.label).toBe('Unofficial (nginx)');
  expect(nginx444.origin).toContain('nginx');
  const nginx499 = UNOFFICIAL_CODES.find((e) => e.code === 499)!;
  expect(nginx499.label).toBe('Unofficial (nginx)');

  const cf520 = UNOFFICIAL_CODES.find((e) => e.code === 520)!;
  expect(cf520.label).toBe('Unofficial (Cloudflare)');
  expect(cf520.origin).toContain('Cloudflare');
  const cf526 = UNOFFICIAL_CODES.find((e) => e.code === 526)!;
  expect(cf526.label).toBe('Unofficial (Cloudflare)');

  const result = searchStatusCodes('520');
  expect(result.rows[0]!.statusLabel).toBe('Unofficial (Cloudflare)');
  expect(result.rows[0]!.definedIn[0]!.label).toContain('Cloudflare');
});

it('searching 4xx, a phrase fragment, an RFC number or an unassigned code gives the right answer', () => {
  const classResult = searchStatusCodes('4xx');
  expect(classResult.rows.length).toBeGreaterThan(20);
  expect(classResult.rows.every((r) => r.statusClass === '4xx')).toBe(true);

  const digitResult = searchStatusCodes('4');
  expect(digitResult.rows.length).toBe(classResult.rows.length);

  const phraseResult = searchStatusCodes('teapot');
  // 418 is Unused; its description text is "(Unused)", not "teapot" -- the
  // registry no longer publishes the "I'm a teapot" phrase for 418, so a
  // teapot search legitimately finds nothing. Assert the honest outcome:
  // a clear note, not a silent empty table.
  expect(phraseResult.rows.length).toBe(0);
  expect(phraseResult.note).toContain('teapot');

  const phraseResult2 = searchStatusCodes('legal reasons');
  expect(phraseResult2.rows.length).toBe(1);
  expect(phraseResult2.rows[0]!.code).toBe(451);

  const rfcResult = searchStatusCodes('rfc 7725');
  expect(rfcResult.rows.length).toBe(1);
  expect(rfcResult.rows[0]!.code).toBe(451);
  const rfcResultBare = searchStatusCodes('9110');
  expect(rfcResultBare.rows.length).toBeGreaterThan(10);

  const unassignedResult = searchStatusCodes('299');
  expect(unassignedResult.rows.length).toBe(0);
  expect(unassignedResult.note).toContain('unassigned');

  const notCodeResult = searchStatusCodes('999');
  expect(notCodeResult.rows.length).toBe(0);
  expect(notCodeResult.note).toContain('not a valid');
});

it('statusClass groups codes by their leading digit', () => {
  expect(statusClass(100)).toBe('1xx');
  expect(statusClass(404)).toBe('4xx');
  expect(statusClass(511)).toBe('5xx');
});
