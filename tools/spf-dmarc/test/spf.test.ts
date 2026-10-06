import { expect, it } from 'vitest';
import { LOOKUP_LIMIT, SpfDmarcError, checkSpf, parseSpf, readTxtRecords } from '../src/index';

// Expected values are the literals of RFC 7208. The section is named where a record is taken from the text.

// A marker that stands for something a visitor pasted. No message of the package may ever hold it.
const MARK = 'zq8-MARKER-4471-zq8';

/** The error a call throws, or null when it does not throw. */
function refusal(call: () => unknown): SpfDmarcError | null {
  try {
    call();
    return null;
  } catch (err) {
    if (err instanceof SpfDmarcError) return err;
    throw err;
  }
}

it('include, a, mx, ptr, exists and redirect count toward 10 and all, ip4, ip6 and exp do not', () => {
  // RFC 7208 section 4.6.4: "the include, a, mx, ptr, and exists mechanisms, and the redirect modifier" cause DNS queries;
  // "the all, ip4, and ip6 mechanisms, and the exp modifier" do not.
  for (const term of ['include:example.com', 'a', 'mx', 'ptr', 'exists:example.com', 'redirect=example.com']) {
    const report = checkSpf(parseSpf(`v=spf1 ${term}`));
    expect(report.lookupCount, term).toBe(1);
  }
  for (const term of ['all', 'ip4:192.0.2.1', 'ip6:2001:db8::1', 'exp=explain.example.com']) {
    const report = checkSpf(parseSpf(`v=spf1 ${term}`));
    expect(report.lookupCount, term).toBe(0);
  }

  // Four terms that cause lookups, each with its position (1-based, in the record as written).
  const record = parseSpf('v=spf1 a mx include:example.com include:example.org -all');
  expect(record.errors).toEqual([]);
  expect(record.terms.map((t) => [t.text, t.start, t.end])).toEqual([
    ['a', 8, 8],
    ['mx', 10, 11],
    ['include:example.com', 13, 31],
    ['include:example.org', 33, 51],
    ['-all', 53, 56],
  ]);
  const report = checkSpf(record);
  expect(report.lookupCount).toBe(4);
  expect(report.limit).toBe(LOOKUP_LIMIT);
  expect(report.limit).toBe(10);
  expect(report.withinLimit).toBe(true);
  expect(report.lookups.map((l) => l.term)).toEqual(['a', 'mx', 'include:example.com', 'include:example.org']);

  // The qualifier and the name are read apart, and the name is case-insensitive (RFC 7208 section 4.6.1).
  const loud = parseSpf('v=SPF1 +MX ~All');
  expect(loud.terms.map((t) => [t.qualifier, t.kind])).toEqual([
    ['+', 'mx'],
    ['~', 'all'],
  ]);
});

it('an empty box shows nothing and v=spf1 alone is valid with no lookups', () => {
  expect(readTxtRecords('')).toEqual([]);
  expect(readTxtRecords('   \n\r\n  ')).toEqual([]);

  // RFC 7208 section 4.7: with no mechanism matching and no redirect the result is neutral.
  const record = parseSpf('v=spf1');
  expect(record.isSpf).toBe(true);
  expect(record.errors).toEqual([]);
  expect(record.terms).toEqual([]);
  const report = checkSpf(record);
  expect(report.valid).toBe(true);
  expect(report.lookupCount).toBe(0);
  expect(report.withinLimit).toBe(true);
  expect(report.notes.some((note) => /neutral/.test(note.message))).toBe(true);
});

it('refusals name the box and the position and never repeat pasted text', () => {
  // A paste over the limit is refused before any work, naming the box and the first character not read.
  const tooLong = refusal(() => readTxtRecords(MARK + 'a'.repeat(65_540), 'spf'));
  expect(tooLong).not.toBeNull();
  expect(tooLong?.part).toBe('spf');
  expect(tooLong?.position).toBe(65_537);
  expect(tooLong?.message).toContain('SPF box');
  expect(tooLong?.message).toContain('65,536');
  expect(tooLong?.message).not.toContain(MARK);

  // A record over 16,384 characters is refused the same way by the parser.
  const longRecord = refusal(() => parseSpf('v=spf1 ' + MARK + 'a'.repeat(16_400)));
  expect(longRecord?.part).toBe('spf');
  expect(longRecord?.position).toBe(16_385);
  expect(longRecord?.message).not.toContain(MARK);

  // A malformed term is a problem with a position, and the pasted text is not in it.
  const record = parseSpf(`v=spf1 a ${MARK}:x ${MARK}`);
  expect(record.errors.length).toBeGreaterThanOrEqual(2);
  expect(record.errors.map((e) => e.position)).toEqual([10, 10 + MARK.length + 3]);
  for (const problem of record.errors) expect(problem.message).not.toContain(MARK);
  for (const note of checkSpf(record).notes) expect(note.message).not.toContain(MARK);
});
