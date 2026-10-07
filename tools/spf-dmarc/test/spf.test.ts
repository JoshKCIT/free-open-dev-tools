import { expect, it, vi } from 'vitest';
import { isIPv4, isIPv6 } from 'node:net';
import {
  LOOKUP_LIMIT,
  SpfDmarcError,
  buildSpf,
  checkSpf,
  isIp4Literal,
  isIp6Literal,
  parseSpf,
  readTxtRecords,
  type SpfFields,
} from '../src/index';

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

  // A record in the box that holds more than 100 records is refused, naming the box and where the 101st record starts.
  const many = Array.from({ length: 101 }, () => 'v=spf1 -all').join('\n');
  const tooMany = refusal(() => readTxtRecords(many, 'spf'));
  expect(tooMany?.part).toBe('spf');
  expect(tooMany?.position).toBe(100 * 12 + 1);
  expect(tooMany?.message).toContain('SPF box');
  expect(tooMany?.message).toContain('100');
});

/** A record that is expected to read with no problem. */
function clean(text: string) {
  const record = parseSpf(text);
  expect(record.errors, text).toEqual([]);
  return record;
}

// The records RFC 7208 prints, each with the section it is printed in. Every one has single spaces between its terms, so
// its terms are what is left after the version when it is split at spaces.
const RFC_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['3', 'v=spf1 +mx a:colo.example.com/28 -all'],
  ['3.5', 'v=spf1 a:A.EXAMPLE.COM -all'],
  ['4.7', 'v=spf1 +mx -all'],
  ['4.7', 'v=spf1 +mx redirect=_spf.example.com'],
  ['5.1', 'v=spf1 a mx -all'],
  ['5.2', 'v=spf1 include:example.com include:example.org -all'],
  ['5.7', 'v=spf1 exists:%{ir}.%{l1r+-}._spf.%{d} -all'],
  ['6.1', 'v=spf1 redirect=_spf.example.com'],
  ['6.1', 'v=spf1 mx:example.com -all'],
  ['6.2', 'v=spf1 mx -all exp=explain._spf.%{d}'],
  ['10.1.1', 'v=spf1 ip4:192.0.2.1 ip4:192.0.2.129 -all'],
  ['10.1.1', 'v=spf1 a:authorized-spf.example.com -all'],
  ['10.1.1', 'v=spf1 ip4:192.0.2.0/24 mx -all'],
  ['10.1.2', 'v=spf1 -all'],
  ['A.1', 'v=spf1 +all'],
  ['A.1', 'v=spf1 a -all'],
  ['A.1', 'v=spf1 a:example.org -all'],
  ['A.1', 'v=spf1 mx -all'],
  ['A.1', 'v=spf1 mx:example.org -all'],
  ['A.1', 'v=spf1 mx mx:example.org -all'],
  ['A.1', 'v=spf1 mx/30 mx:example.org/30 -all'],
  ['A.1', 'v=spf1 ptr -all'],
  ['A.1', 'v=spf1 ip4:192.0.2.128/28 -all'],
  ['A.2', 'v=spf1 include:example.com include:example.net -all'],
  ['A.2', 'v=spf1 redirect=example.org'],
  ['A.3', 'v=spf1 mx include:mobile-users._spf.%{d} include:remote-users._spf.%{d} -all'],
  ['A.3', 'v=spf1 exists:%{l1r+}.%{d}'],
  ['A.3', 'v=spf1 exists:%{ir}.%{l1r+}.%{d}'],
  ['A.4', 'v=spf1 -ip4:192.0.2.0/24 +all'],
  ['A.4', 'v=spf1 -ptr +all'],
  ['A', 'v=spf1 exists:_h.%{h}._l.%{l}._o.%{o}._i.%{i}._spf.%{d} ?all'],
  ['A', 'v=spf1 mx ?exists:%{ir}.whitelist.example.org -all'],
  ['A', 'v=spf1 mx exists:%{l}._spf_verify.%{d} -all'],
  ['A', 'v=spf1 mx exists:%{ir}._spf_rate.%{d} -all'],
  ['A', 'v=spf1 mx redirect=%{l1r+}._at_.%{o}._spf.%{d}'],
];

it('the RFC 7208 example records parse term by term with their positions', () => {
  for (const [section, text] of RFC_EXAMPLES) {
    const record = clean(text);
    expect(record.isSpf, `section ${section}: ${text}`).toBe(true);
    const expected = text.slice('v=spf1 '.length).split(' ');
    expect(
      record.terms.map((t) => t.text),
      `section ${section}: ${text}`,
    ).toEqual(expected);
    // Every position points at exactly the characters of its term.
    for (const term of record.terms) {
      expect(text.slice(term.start - 1, term.end)).toBe(term.text);
    }
  }

  // Positions of the section 3 example, counted by hand: v=spf1 is 1 to 6, a space is 7, +mx is 8 to 10.
  const section3 = clean('v=spf1 +mx a:colo.example.com/28 -all');
  expect(section3.terms.map((t) => [t.start, t.end, t.qualifier, t.kind, t.name])).toEqual([
    [8, 10, '+', 'mx', 'mx'],
    [12, 32, '+', 'a', 'a'],
    [34, 37, '-', 'all', 'all'],
  ]);
  expect(section3.terms[1]?.qualifierWritten).toBe(false);
  expect(section3.terms[1]?.domain).toBe('colo.example.com');
  expect(section3.terms[1]?.cidr4).toBe(28);
  expect(section3.terms[1]?.cidr6).toBeNull();
  const dual = clean('v=spf1 mx/30 mx:example.org/30//64');
  expect(dual.terms.map((t) => [t.domain, t.cidr4, t.cidr6])).toEqual([
    [null, 30, null],
    ['example.org', 30, 64],
  ]);

  // Section 12 and the text of section 4.6.1: mechanism names are case-insensitive; a modifier is a name and an equals sign.
  const odd = clean('v=spf1 Include:Example.COM A:a.example MX +PTR ~ALL');
  expect(odd.terms.map((t) => t.kind)).toEqual(['include', 'a', 'mx', 'ptr', 'all']);

  // The two-line examples of section 12 that are errors: "-all." and a prefix length on ptr, each at its position.
  expect(parseSpf('v=spf1 -all.').errors.map((e) => e.position)).toEqual([9]);
  expect(parseSpf('v=spf1 ptr/0 -all').errors.map((e) => e.position)).toEqual([11]);
  // exp and redirect may each appear once (section 6): the second one is the error.
  expect(parseSpf('v=spf1 exp=a.example -all exp=b.example').errors.map((e) => e.position)).toEqual([27]);
  expect(parseSpf('v=spf1 redirect=a.example redirect=b.example').errors.map((e) => e.position)).toEqual([27]);
  // An unknown modifier is ignored wherever it appears and as often as it appears (section 6).
  const unknown = clean('v=spf1 foo=bar a bar.baz_1-x=%{d}.y -all foo=again');
  expect(unknown.terms.map((t) => t.kind)).toEqual(['modifier', 'a', 'modifier', 'all', 'modifier']);
  expect(checkSpf(unknown).lookupCount).toBe(1);
  // A modifier takes no qualifier, and its name starts with a letter.
  expect(parseSpf('v=spf1 -foo=bar').errors.length).toBe(1);
  expect(parseSpf('v=spf1 1up=foo').errors.length).toBe(1);
  expect(parseSpf('v=spf1 =all').errors.length).toBe(1);
  // A domain needs a top label; a trailing period is allowed (section 12 domain-end); an all-digit top label is not one.
  expect(parseSpf('v=spf1 a:foo-bar').errors.length).toBe(1);
  expect(parseSpf('v=spf1 a:example.com.').errors).toEqual([]);
  expect(parseSpf('v=spf1 a:abc.123').errors.length).toBe(1);
  expect(parseSpf('v=spf1 a:foo.example.xn--zckzah').errors).toEqual([]);
  expect(parseSpf('v=spf1 include:').errors.length).toBe(1);
  // Macro rules (section 7.1 and 7.3): a percent sign starts a macro, the letter is one of the listed, the digit is not zero.
  expect(parseSpf('v=spf1 exists:%{ir}.sbl.example.org').errors).toEqual([]);
  expect(parseSpf('v=spf1 -exists:%(ir).sbl.example.org').errors.length).toBe(1);
  expect(parseSpf('v=spf1 exists:%{a}.example.org').errors.length).toBe(1);
  expect(parseSpf('v=spf1 exists:%{d0}.example.org').errors.length).toBe(1);
  expect(parseSpf('v=spf1 exists:%{d2').errors.length).toBe(1);
});

it('ten lookups are within the limit and eleven are over it', () => {
  // The processing-limits cases mech-at-limit and mech-over-limit of the OpenSPF suite give 10 and 11 terms that cause lookups.
  const ten = checkSpf(parseSpf('v=spf1 a mx a mx a mx a mx a ptr ip4:1.2.3.4 -all'));
  expect(ten.lookupCount).toBe(10);
  expect(ten.withinLimit).toBe(true);
  expect(ten.notes.some((n) => n.tone === 'warn' && /limit/.test(n.message))).toBe(false);
  const eleven = checkSpf(parseSpf('v=spf1 a mx a mx a mx a mx a ptr a ip4:1.2.3.4 -all'));
  expect(eleven.lookupCount).toBe(11);
  expect(eleven.withinLimit).toBe(false);
  expect(eleven.permerror).toContain('10');
  expect(eleven.notes.some((n) => n.tone === 'warn' && /limit of 10/.test(n.message))).toBe(true);

  // The same boundary with includes, which add nothing else.
  for (const [count, within] of [
    [10, true],
    [11, false],
  ] as const) {
    const text = 'v=spf1 ' + 'include:a.example '.repeat(count) + '-all';
    const report = checkSpf(parseSpf(text));
    expect(report.lookupCount).toBe(count);
    expect(report.withinLimit).toBe(within);
  }
  // A record with a syntax error ends in permerror before any lookup, so it has a reason and counts no broken term.
  const broken = checkSpf(parseSpf('v=spf1 a include: mx'));
  expect(broken.valid).toBe(false);
  expect(broken.permerror).toContain('syntax');
  expect(broken.lookupCount).toBe(2);
});

it('a redirect is ignored and not counted when the record also holds an all', () => {
  // RFC 7208 section 6.1: "Any redirect modifier MUST be ignored when there is an all mechanism in the record, regardless
  // of the relative ordering of the redirect and the all."
  const before = checkSpf(parseSpf('v=spf1 redirect=_spf.example.com -all'));
  expect(before.lookupCount).toBe(0);
  expect(before.redirectIgnored).toBe(true);
  const after = checkSpf(parseSpf('v=spf1 -all redirect=_spf.example.com'));
  expect(after.lookupCount).toBe(0);
  expect(after.redirectIgnored).toBe(true);
  expect(after.notes.some((n) => /ignored/.test(n.message))).toBe(true);
  // Section 4.7: with no all, a redirect is followed and is counted.
  const followed = checkSpf(parseSpf('v=spf1 +mx redirect=_spf.example.com'));
  expect(followed.lookupCount).toBe(2);
  expect(followed.redirectIgnored).toBe(false);
  // Section 5.1: terms after an all are never tested, so they are listed and not counted; a modifier after it is not a test.
  const late = checkSpf(parseSpf('v=spf1 -all a mx exp=explain.example.com'));
  expect(late.neverTested).toEqual([2, 3]);
  expect(late.lookupCount).toBe(0);
  expect(late.notes.some((n) => /never tested/.test(n.message))).toBe(true);
  const none = checkSpf(parseSpf('v=spf1 a -all'));
  expect(none.neverTested).toEqual([]);
});

it('ip4 prefixes up to 32 and ip6 prefixes up to 128 are accepted and one more is refused with its position', () => {
  for (const ok of [
    'v=spf1 ip4:192.0.2.0/0',
    'v=spf1 ip4:192.0.2.0/32',
    'v=spf1 ip4:192.0.2.0',
    'v=spf1 ip6:2001:db8::/0',
    'v=spf1 ip6:2001:db8::/128',
    'v=spf1 ip6:2001:db8::',
    'v=spf1 a/32//128',
    'v=spf1 mx/0//0',
  ]) {
    expect(parseSpf(ok).errors, ok).toEqual([]);
  }
  const at = (text: string): number[] => parseSpf(text).errors.map((e) => e.position);
  // The position is the first digit of the number that is out of range.
  expect(at('v=spf1 ip4:192.0.2.0/33')).toEqual([22]);
  expect(at('v=spf1 ip6:2001:db8::/129')).toEqual([23]);
  expect(at('v=spf1 a/33')).toEqual([10]);
  expect(at('v=spf1 a//129')).toEqual([11]);
  expect(at('v=spf1 mx:example.org/32//129')).toEqual([27]);
  // A leading zero, a missing number and a stray slash are refused where they start.
  expect(at('v=spf1 ip4:192.0.2.0/032')).toEqual([22]);
  expect(at('v=spf1 ip4:192.0.2.0/')).toEqual([22]);
  expect(at('v=spf1 ip4:192.0.2.0//32').length).toBe(1);
  expect(at('v=spf1 a/24/64').length).toBe(1);
  expect(at('v=spf1 ip4').length).toBe(1);
  expect(at('v=spf1 ip6:2001:db8::1//33').length).toBe(1);
  // Addresses: a leading zero and a number over 255 are refused (RFC 7208 section 12 qnum), and ::ffff:1.2.3.4 is accepted.
  expect(at('v=spf1 ip4:01.1.1.1').length).toBe(1);
  expect(at('v=spf1 ip4:1.2.3.256').length).toBe(1);
  expect(at('v=spf1 ip4:1.2.3').length).toBe(1);
  expect(at('v=spf1 ip4:1.2.3.4:8080').length).toBe(1);
  expect(at('v=spf1 ip6:::ffff:1.2.3.4')).toEqual([]);
  expect(at('v=spf1 ip6:::1%eth0').length).toBe(1);
  expect(at('v=spf1 ip6:2001:db8::1::2').length).toBe(1);
});

/** A small seeded generator (mulberry32), so a difference can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('the address checks agree with node net isIPv4 and isIPv6 except a zone id', () => {
  const rng = mulberry32(7208);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
  const numbers = [
    '0',
    '1',
    '9',
    '10',
    '99',
    '100',
    '199',
    '200',
    '249',
    '250',
    '255',
    '256',
    '300',
    '01',
    '001',
    '00',
    'a',
    '',
    '1a',
    '-1',
    ' 1',
  ];
  const groups = [
    '0',
    '1',
    'a',
    'abcd',
    'ABCD',
    'ffff',
    'fffff',
    '0000',
    '00000',
    'g',
    '',
    '1.2.3.4',
    '01.2.3.4',
    '255.255.255.255',
    '256.1.1.1',
    '1.2.3',
  ];
  const fixed4 = [
    '192.0.2.1',
    '0.0.0.0',
    '255.255.255.255',
    '01.1.1.1',
    '1.2.3.256',
    '1.2.3',
    '1.2.3.4.5',
    '',
    '1.2.3.4 ',
    '1..2.3',
  ];
  const fixed6 = [
    '::',
    '::1',
    '1::',
    '::ffff:1.2.3.4',
    '1:2:3:4:5:6:1.2.3.4',
    '12345::',
    '1:2:3:4:5:6:7:8',
    '1:2:3:4:5:6:7:8:9',
    '1::2::3',
    ':::',
    ':1',
    '1:',
    '2001:db8::cd30',
    '::1.2.3.4',
    'fe80::1',
  ];
  const zone = ['::1%eth0', 'fe80::1%1', 'fe80::1%', '1:2:3:4:5:6:7:8%z'];

  const corpus4: string[] = [...fixed4];
  for (let i = 0; i < 3000; i++)
    corpus4.push(Array.from({ length: pick([3, 4, 4, 4, 5]) }, () => pick(numbers)).join('.'));
  const corpus6: string[] = [...fixed6, ...zone];
  for (let i = 0; i < 6000; i++) {
    const parts = Array.from({ length: Math.floor(rng() * 9) + 1 }, () => pick(groups));
    let text = parts.join(':');
    const style = rng();
    if (style < 0.35 && parts.length > 1) text = parts.slice(0, 2).join(':') + '::' + parts.slice(2).join(':');
    else if (style < 0.45) text = '::' + text;
    else if (style < 0.55) text = text + '::';
    corpus6.push(text);
  }

  const differences: string[] = [];
  for (const text of corpus4) if (isIp4Literal(text) !== isIPv4(text)) differences.push(`ip4 ${JSON.stringify(text)}`);
  for (const text of corpus6) if (isIp6Literal(text) !== isIPv6(text)) differences.push(`ip6 ${JSON.stringify(text)}`);
  // The only named difference: net accepts a zone id after the address, the grammar RFC 7208 cites has none.
  expect(differences.sort()).toEqual(
    zone
      .filter((z) => isIPv6(z))
      .map((z) => `ip6 ${JSON.stringify(z)}`)
      .sort(),
  );
  for (const z of zone) expect(isIp6Literal(z), z).toBe(false);
  expect(isIPv6('::1%eth0')).toBe(true);
  expect(isIp6Literal('::1%eth0')).toBe(false);

  // Agreement on the values the research measured.
  for (const [text, expected] of [
    ['01.1.1.1', false],
    ['1.2.3.256', false],
    ['192.0.2.1', true],
  ] as const) {
    expect(isIp4Literal(text)).toBe(expected);
    expect(isIPv4(text)).toBe(expected);
  }
  for (const [text, expected] of [
    ['::1', true],
    ['1::', true],
    ['::ffff:1.2.3.4', true],
    ['1:2:3:4:5:6:1.2.3.4', true],
    ['12345::', false],
  ] as const) {
    expect(isIp6Literal(text)).toBe(expected);
    expect(isIPv6(text)).toBe(expected);
  }
});

it('quoted strings are joined without spaces and a tab between terms is a syntax error', () => {
  // RFC 7208 section 3.3: strings are concatenated "without adding spaces".
  const [spaced] = readTxtRecords('example.com. IN TXT "v=spf1 " "a"');
  expect(spaced?.text).toBe('v=spf1 a');
  expect(spaced?.strings).toEqual(['v=spf1 ', 'a']);
  expect(parseSpf(spaced?.text ?? '').terms.map((t) => t.text)).toEqual(['a']);
  const [joined] = readTxtRecords('example.com. IN TXT "v=spf1" "a"');
  expect(joined?.text).toBe('v=spf1a');
  const notSpf = parseSpf(joined?.text ?? '');
  expect(notSpf.isSpf).toBe(false);
  expect(notSpf.terms).toEqual([]);
  expect(notSpf.errors.length).toBe(1);
  // The example of section 3.3 itself.
  const [rfc] = readTxtRecords('IN TXT "v=spf1 .... first" "second string..."');
  expect(rfc?.text).toBe('v=spf1 .... firstsecond string...');
  // Section 4.5: v=spf10 is not a version.
  expect(parseSpf('v=spf10 -all').isSpf).toBe(false);
  expect(parseSpf('V=SPF1 -all').isSpf).toBe(true);
  expect(parseSpf('v=spf1-all').isSpf).toBe(false);
  expect(parseSpf('').isSpf).toBe(false);
  // Section 12: terms are separated by spaces only, so a tab or a line feed between terms is an error at its term.
  const tab = parseSpf('v=spf1 a\tmx -all');
  expect(tab.errors.length).toBe(1);
  expect(tab.errors[0]?.position).toBe(8);
  expect(parseSpf('v=spf1 a\tmx -all').terms.length).toBe(2);
  expect(parseSpf('v=spf1\ta -all').isSpf).toBe(false);
  expect(parseSpf('v=spf1 a\n-all').errors.length).toBe(1);
  // Several spaces and a trailing space are allowed by the record rule (1*SP, then *SP).
  expect(parseSpf('v=spf1   a    -all  ').errors).toEqual([]);

  // The zone-file forms: owner name, time to live, class, the TXT word or the old SPF type, comments and the parenthesis form.
  const forms = readTxtRecords(
    [
      '; a comment line is skipped',
      '',
      'example.com.          TXT "v=spf1 +mx a:colo.example.com/28 -all"',
      'mail.example.com. 3600 IN TXT "v=spf1 -all"',
      'TXT "v=spf1 a"',
      '_spf 300 txt ( "v=spf1 "   ; the first part',
      '               "a mx "',
      '               "-all" )  ; the end',
      'old.example.com. SPF "v=spf1 -all"',
      'v=spf1 ip4:192.0.2.1 -all',
    ].join('\n'),
  );
  expect(forms.map((r) => [r.label, r.text])).toEqual([
    ['example.com.', 'v=spf1 +mx a:colo.example.com/28 -all'],
    ['mail.example.com.', 'v=spf1 -all'],
    [null, 'v=spf1 a'],
    ['_spf', 'v=spf1 a mx -all'],
    ['old.example.com.', 'v=spf1 -all'],
    [null, 'v=spf1 ip4:192.0.2.1 -all'],
  ]);
  expect(forms.map((r) => r.line)).toEqual([3, 4, 5, 6, 9, 10]);
  expect(forms[3]?.strings).toEqual(['v=spf1 ', 'a mx ', '-all']);
  expect(forms[4]?.warnings.some((w) => /SPF record type/.test(w))).toBe(true);
  expect(forms[0]?.warnings).toEqual([]);
  // Quotes are read before comment characters, so a semicolon inside a string is data; the escapes are \", \\ and \DDD.
  const [quoted] = readTxtRecords('TXT "v=spf1 a ; -all" ; the comment');
  expect(quoted?.text).toBe('v=spf1 a ; -all');
  const [escaped] = readTxtRecords('TXT "v=spf1\\032exp=a\\.example\\\\b\\"c"');
  expect(escaped?.text).toBe('v=spf1 exp=a.example\\b"c');
  // Curly quotes are replaced with straight quotes, with a warning.
  const [curly] = readTxtRecords(
    'TXT ' + String.fromCodePoint(0x201c) + 'v=spf1 a -all' + String.fromCodePoint(0x201d),
  );
  expect(curly?.text).toBe('v=spf1 a -all');
  expect(curly?.warnings.some((w) => /curly/i.test(w))).toBe(true);
  // A string that is never closed still reads, with a warning, and is never repeated in the message.
  const [open] = readTxtRecords('TXT "v=spf1 a');
  expect(open?.text).toBe('v=spf1 a');
  expect(open?.warnings.some((w) => /closing quote/.test(w))).toBe(true);
});

/** A record of exactly `length` characters: a version, an unknown modifier and padding that reads without a problem. */
function recordOfLength(length: number): string {
  const head = 'v=spf1 pad=';
  return head + 'x'.repeat(length - head.length);
}

it('a record of 450 octets gets no size note, 451 octets gets one, and a string over 255 octets is flagged', () => {
  const sizeNote = (text: string, strings?: readonly string[]) =>
    checkSpf(clean(text), strings).notes.filter((n) => /450 octets/.test(n.message));
  expect(recordOfLength(450).length).toBe(450);
  expect(sizeNote(recordOfLength(449))).toEqual([]);
  expect(sizeNote(recordOfLength(450))).toEqual([]);
  const over = sizeNote(recordOfLength(451));
  expect(over.length).toBe(1);
  expect(over[0]?.tone).toBe('warn');
  // The size is counted in octets, not characters: three characters of two octets each.
  const accents = 'v=spf1 pad=' + String.fromCodePoint(0xe9).repeat(3);
  expect(accents.length).toBe(14);
  expect(parseSpf(accents).octets).toBe(17);

  // One string of 255 octets is fine and one of 256 is flagged; a record read from several strings is flagged only when one is long.
  const stringNote = (record: string) => {
    const [read] = readTxtRecords(`example.com. IN TXT "${record}"`);
    return checkSpf(clean(read?.text ?? ''), read?.strings).notes.filter((n) => /255 octets/.test(n.message));
  };
  expect(stringNote(recordOfLength(255))).toEqual([]);
  const long = stringNote(recordOfLength(256));
  expect(long.length).toBe(1);
  expect(long[0]?.tone).toBe('warn');
  const [split] = readTxtRecords(`example.com. IN TXT "${recordOfLength(255)}" "x"`);
  const splitReport = checkSpf(clean(split?.text ?? ''), split?.strings);
  expect(splitReport.notes.filter((n) => /255 octets/.test(n.message))).toEqual([]);
  expect(splitReport.stringsNeeded).toBe(2);
  expect(splitReport.octets).toBe(256);
  // A bare record is one pasted line, so only the number of strings it would need is reported.
  expect(checkSpf(clean(recordOfLength(256))).stringsNeeded).toBe(2);
  expect(checkSpf(clean(recordOfLength(255))).stringsNeeded).toBe(1);
});

it('a built SPF record checks clean and keeps the fixed term order', () => {
  const fields: SpfFields = {
    ip4: '192.0.2.10\n198.51.100.0/24',
    ip6: '2001:db8::/32',
    includes: 'spf.protection.example\nmail.example.org',
    a: true,
    mx: true,
    ending: '-all',
    redirect: '',
  };
  const built = buildSpf(fields);
  expect(built.problems).toEqual([]);
  expect(built.record).toBe(
    'v=spf1 ip4:192.0.2.10 ip4:198.51.100.0/24 ip6:2001:db8::/32 a mx include:spf.protection.example include:mail.example.org -all',
  );
  expect(built.length).toBe(built.record.length);
  expect(built.lookups).toBe(4);
  const parsed = parseSpf(built.record);
  expect(parsed.errors).toEqual([]);
  expect(parsed.terms.map((t) => t.kind)).toEqual(['ip4', 'ip4', 'ip6', 'a', 'mx', 'include', 'include', 'all']);
  expect(checkSpf(parsed).lookupCount).toBe(built.lookups);
  expect(built.report.valid).toBe(true);

  // The order is fixed, whatever order the lines were typed in, and blank lines are skipped.
  const shuffled = buildSpf({
    ...fields,
    ip4: '\n198.51.100.0/24\n\n192.0.2.10\n',
    includes: 'mail.example.org\nspf.protection.example',
  });
  expect(shuffled.record).toBe(
    'v=spf1 ip4:198.51.100.0/24 ip4:192.0.2.10 ip6:2001:db8::/32 a mx include:mail.example.org include:spf.protection.example -all',
  );
  // Each ending, and a redirect after the other terms (counted, because there is no all).
  for (const ending of ['~all', '?all'] as const) {
    expect(buildSpf({ ...fields, ending }).record.endsWith(' ' + ending)).toBe(true);
  }
  const redirected = buildSpf({ ...fields, ending: 'redirect', redirect: '_spf.example.com' });
  expect(
    redirected.record.endsWith(' mx include:spf.protection.example include:mail.example.org redirect=_spf.example.com'),
  ).toBe(true);
  expect(redirected.lookups).toBe(5);
  expect(redirected.problems).toEqual([]);
  // Nothing entered gives a record that closes with the chosen ending.
  const bare = buildSpf({ ip4: '', ip6: '', includes: '', a: false, mx: false, ending: '-all', redirect: '' });
  expect(bare.record).toBe('v=spf1 -all');
  expect(bare.lookups).toBe(0);
  expect(buildSpf({ ...fields, a: false, mx: false, ip4: '', ip6: '', includes: '' }).record).toBe('v=spf1 -all');

  // An entry that is not valid is listed as a problem with its field and line, left out of the record, and never repeated.
  const MARKED = 'zq8-MARKER-4471-zq8';
  const bad = buildSpf({
    ip4: `192.0.2.10\n999.1.1.1\n1.2.3.4 -all\n${MARKED}`,
    ip6: 'not-an-address',
    includes: `${MARKED} b\nok.example.org\n-bad`,
    a: false,
    mx: false,
    ending: 'redirect',
    redirect: '',
  });
  expect(bad.problems.map((p) => [p.field, p.line])).toEqual([
    ['ip4', 2],
    ['ip4', 3],
    ['ip4', 4],
    ['ip6', 1],
    ['includes', 1],
    ['includes', 3],
    ['redirect', 1],
  ]);
  for (const problem of bad.problems) expect(problem.message).not.toContain(MARKED);
  expect(bad.record).toBe('v=spf1 ip4:192.0.2.10 include:ok.example.org');
  expect(parseSpf(bad.record).errors).toEqual([]);
  // A builder box over the limit is refused, naming the builder.
  const refused = refusal(() => buildSpf({ ...fields, ip4: 'a'.repeat(65_537) }));
  expect(refused?.part).toBe('builder');
  expect(refused?.message).not.toContain('aaaa');
});

it('a builder entry typed with the prefix the builder writes itself is written once and the drop is reported', () => {
  const none: SpfFields = { ip4: '', ip6: '', includes: '', a: false, mx: false, ending: '-all', redirect: '' };
  // Provider documentation writes include:<name>; pasted as written it must not become include:include:<name>, which a
  // receiver reads as an include of a name that does not exist (RFC 7208 section 5.2: permerror).
  const included = buildSpf({ ...none, includes: 'include:_spf.example.com' });
  expect(included.record).toBe('v=spf1 include:_spf.example.com -all');
  expect(included.problems).toEqual([]);
  expect(included.adjusted.map((a) => [a.field, a.line])).toEqual([['includes', 1]]);
  expect(included.adjusted[0]?.message).toContain('include:');
  expect(included.report.valid).toBe(true);
  // The redirect box, in the form redirect=<name>.
  const redirected = buildSpf({ ...none, ending: 'redirect', redirect: 'redirect=_spf.example.com' });
  expect(redirected.record).toBe('v=spf1 redirect=_spf.example.com');
  expect(redirected.adjusted.map((a) => [a.field, a.line])).toEqual([['redirect', 1]]);
  // Any ASCII letter case, a prefix typed twice, and the ip4 and ip6 boxes the same way.
  const mixed = buildSpf({
    ...none,
    ip4: 'IP4:192.0.2.10',
    ip6: 'ip6:2001:db8::/32',
    includes: 'Include:a.example\nINCLUDE:include:b.example\nc.example',
  });
  expect(mixed.record).toBe(
    'v=spf1 ip4:192.0.2.10 ip6:2001:db8::/32 include:a.example include:b.example include:c.example -all',
  );
  expect(mixed.problems).toEqual([]);
  expect(mixed.adjusted.map((a) => [a.field, a.line])).toEqual([
    ['ip4', 1],
    ['ip6', 1],
    ['includes', 1],
    ['includes', 2],
  ]);
  // No built record of this test holds a doubled prefix, and every record reads back clean.
  for (const built of [included, redirected, mixed]) {
    expect(built.record).not.toMatch(/include:include:|redirect=redirect=|ip4:ip4:|ip6:ip6:/i);
    expect(parseSpf(built.record).errors).toEqual([]);
  }
  // A prefix with nothing after it is not dropped and the entry stays a problem; the message never repeats the entry.
  const bare = buildSpf({ ...none, includes: `include:\n${MARK}:` });
  expect(bare.adjusted).toEqual([]);
  expect(bare.problems.map((p) => [p.field, p.line])).toEqual([
    ['includes', 1],
    ['includes', 2],
  ]);
  for (const message of [...bare.problems, ...mixed.adjusted].map((p) => p.message)) {
    expect(message).not.toContain(MARK);
    expect(message).not.toContain('example');
  }
  // An entry with no prefix gives no line in the list.
  expect(buildSpf({ ...none, includes: 'spf.protection.example' }).adjusted).toEqual([]);
});

it('terms keep record order and the lookup count is the same every time', () => {
  const texts = [
    'v=spf1 a mx include:example.com include:example.org -all',
    'v=spf1 ip4:192.0.2.0/24 foo=bar exists:%{i}.example.org redirect=_spf.example.com',
    'v=spf1 -all a mx',
  ];
  const first = texts.map((t) => checkSpf(parseSpf(t)));
  for (const record of first.map((r) => r.record)) {
    const starts = record.terms.map((t) => t.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(record.terms.map((t) => t.index)).toEqual(record.terms.map((_, i) => i + 1));
  }
  // Interleaved in three different orders, the reports are deep-equal to the first.
  for (const order of [
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0],
  ]) {
    for (const i of order) expect(checkSpf(parseSpf(texts[i] ?? ''))).toStrictEqual(first[i]);
  }
  expect(first.map((r) => r.lookupCount)).toEqual([4, 2, 0]);
});

it('modifier names __proto__, constructor and toString are plain names', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    // A modifier name starts with a letter, so __proto__ is a syntax error and nothing more; the others are ordinary names.
    const record = parseSpf(
      'v=spf1 constructor=1 toString=2 hasOwnProperty=3 constructor=4 a __proto__=5 redirect=a.example',
    );
    expect(record.terms.map((t) => [t.kind, t.name])).toEqual([
      ['modifier', 'constructor'],
      ['modifier', 'toString'],
      ['modifier', 'hasOwnProperty'],
      ['modifier', 'constructor'],
      ['a', 'a'],
      ['invalid', ''],
      ['redirect', 'redirect'],
    ]);
    expect(record.errors.length).toBe(1);
    expect(record.errors[0]?.position).toBe(66);
    // Repeating them is not an error (unknown modifiers may repeat) and nothing is added to any prototype.
    expect(parseSpf('v=spf1 constructor=1 constructor=2 toString=3 toString=4').errors).toEqual([]);
    expect(Object.keys(Object.prototype)).toEqual([]);
    const report = checkSpf(record);
    expect(report.lookupCount).toBe(2);
    // The package prints nothing.
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
});
