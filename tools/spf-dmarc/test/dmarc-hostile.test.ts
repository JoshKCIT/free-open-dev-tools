import { expect, it, vi } from 'vitest';
import { buildDmarc, checkDmarc, parseDmarc, pickDmarcRecord, readTxtRecords, type DmarcFields } from '../src/index';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

// The six shared hostile strings plus this tool's own for the DMARC half: many tags, many repeats, many addresses, many
// colons for fo, many quotes and parentheses for the zone reader. Each parser is timed on an input of size n and of size 2n;
// a ratio over 6 means it does more than a bounded number of passes over its input.
const OWN: ReadonlyArray<(n: number) => string> = [
  (n) => 'a=b; '.repeat(Math.ceil(n / 5)),
  (n) => 'p=none;'.repeat(Math.ceil(n / 7)),
  (n) => 'p=;'.repeat(Math.ceil(n / 3)),
  (n) => 'rua=' + 'mailto:a@example.com,'.repeat(Math.ceil(n / 21)),
  (n) => 'rua=' + ','.repeat(n),
  (n) => 'rua=mailto:' + 'a'.repeat(n) + '@example.com',
  (n) => 'rua=mailto:a@' + 'a.'.repeat(Math.floor(n / 2)),
  (n) => 'rua=' + '!1m'.repeat(Math.floor(n / 3)),
  (n) => 'fo=' + '0:'.repeat(Math.floor(n / 2)),
  (n) => 'fo=' + 'd:s:'.repeat(Math.floor(n / 4)),
  (n) => 'pct=1;'.repeat(Math.ceil(n / 6)),
  (n) => ' ; '.repeat(Math.ceil(n / 3)),
  (n) => '=;'.repeat(Math.floor(n / 2)),
  (n) => '"'.repeat(n),
  (n) => '(;'.repeat(Math.floor(n / 2)),
  (n) => '\\'.repeat(n),
];

const FIELDS: DmarcFields = {
  policy: 'none',
  subPolicy: 'inherit',
  nonExistent: 'inherit',
  adkim: 'r',
  aspf: 'r',
  rua: '',
  ruf: '',
  fo: '0',
  test: false,
};

// The record sizes stay inside the 16,384 character cap at 2n; the box sizes stay inside 65,536.
const RECORD_N = 4_000;
const BOX_N = 16_000;

it('every DMARC parser stays linear on hostile input', () => {
  const makers = [...HOSTILE, ...OWN];
  const parse = (input: string): unknown => checkDmarc(parseDmarc(input), 'example.com');
  for (const [i, make] of makers.entries()) {
    const asRecord = (n: number): string => 'v=DMARC1; ' + make(n);
    const ratio = scalingRatio(parse, asRecord, RECORD_N);
    expect(ratio, `parseDmarc and checkDmarc, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
  }
  for (const [i, make] of makers.entries()) {
    const read = (input: string): unknown => pickDmarcRecord(readTxtRecords(input, 'dmarc'));
    const ratio = scalingRatio(read, make, BOX_N);
    expect(ratio, `readTxtRecords and pickDmarcRecord, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
    const quoted = scalingRatio(read, (n) => '_dmarc IN TXT "v=DMARC1; ' + make(n) + '"', BOX_N);
    expect(quoted, `the zone reader inside quotes, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
  }
  // Many lines that hold no record (comments and blank lines) are skipped one by one.
  const lines = scalingRatio(
    (input) => pickDmarcRecord(readTxtRecords(input, 'dmarc')),
    (n) => '; a comment\n\n'.repeat(Math.ceil(n / 13)),
    BOX_N,
  );
  expect(lines, 'readTxtRecords over many lines').toBeLessThan(MAX_SCALING_RATIO);
  // The builder reads each field once; entries are capped at 100 and a field at 65,536 characters.
  const build = (rua: string): unknown => buildDmarc({ ...FIELDS, rua, ruf: rua, fo: rua });
  for (const [i, make] of makers.entries()) {
    const ratio = scalingRatio(build, make, BOX_N);
    expect(ratio, `buildDmarc, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
  }
});

it('tag names __proto__, constructor and toString are plain names', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
  try {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const record = parseDmarc(`v=DMARC1; ${name}=1; p=reject; ${name}=2`);
      // An unknown tag, named like a property of every object, is just an unknown tag: it changes nothing and breaks nothing.
      expect(
        record.tags.slice(0, 4).map((t) => [t.name, t.value, t.status]),
        name,
      ).toEqual([
        ['v', 'DMARC1', 'ok'],
        [name, '1', 'unknown'],
        ['p', 'reject', 'ok'],
        [name, '2', 'unknown'],
      ]);
      expect(record.byName.get(name)?.value, name).toBe('1');
      expect(record.byName.has(name), name).toBe(true);
      expect(checkDmarc(record).policy.domain, name).toBe('reject');
      expect(checkDmarc(record).valid, name).toBe(true);
    }
    // A record that holds none of them does not find them either.
    const plain = parseDmarc('v=DMARC1; p=reject');
    for (const name of ['__proto__', 'constructor', 'toString']) expect(plain.byName.has(name)).toBe(false);
    // The names also come out as plain names when they are the host or the domain of an address.
    const hosts = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:a@constructor,mailto:b@toString.example'), 'valueOf');
    expect(hosts.authorisations.length).toBe(2);
    // Nothing leaked onto the object prototype, and the package printed nothing.
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('a record of thousands of tags is read in one pass and every list a page shows is capped', () => {
  const text = 'v=DMARC1; ' + 'x=1; '.repeat(3_000) + 'p=reject';
  const record = parseDmarc(text);
  expect(record.tags.filter((t) => t.status === 'unknown').length).toBe(3_000);
  expect(checkDmarc(record).policy.domain).toBe('reject');
  // Thousands of repeats and thousands of bad addresses give a few notes, not thousands of them.
  const repeated = checkDmarc(parseDmarc('v=DMARC1; ' + 'p=none; '.repeat(1_000) + 'pct=1; '.repeat(1_000)));
  expect(repeated.notes.length).toBeLessThanOrEqual(60);
  const bad = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:ok@example.com' + ',nonsense'.repeat(1_500)));
  expect(bad.notes.length).toBeLessThanOrEqual(60);
  expect(bad.notes.some((n) => n.message.includes('more'))).toBe(true);
});
