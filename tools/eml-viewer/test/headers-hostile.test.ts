/**
 * Hostile input for the header readers (Received, dates, addresses, Authentication-Results, DKIM-Signature, ARC): the hop
 * and header-size edges, comments nested far deeper than any real header, names that could be keys of a plain object, and
 * linear time. Every hostile input is built here at run time; none is stored. Expected values for the addresses come from
 * RFC 5322 Appendix A.1.2, A.1.3, A.5 and A.6.1.
 */
import { it, expect } from 'vitest';
import {
  MAX_ADDRESSES,
  MAX_COMMENT_DEPTH,
  MAX_HEADER_BYTES,
  MAX_HOPS,
  analyzeMessage,
  groupArc,
  parseAddressList,
  parseAuthenticationResults,
  parseDkimSignature,
  parseReceived,
  readMailDate,
  stripComments,
  withCommas,
} from '../src/index';
import { HOSTILE, scalingRatio } from './scaling';
import { build } from './helpers';

const start = Date.UTC(2026, 9, 6, 10, 0, 0);

function stated(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCDate()} Oct 2026 ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
}

/** `count` Received lines, newest first as a mail system writes them: hop k is from h<k> and one second after hop k - 1. */
function receivedLines(count: number): string[] {
  const lines: string[] = [];
  for (let k = count; k >= 1; k--)
    lines.push(`Received: from h${k}.example by h${k + 1}.example; ${stated(start + k * 1000)}`);
  return lines;
}

/** A Received line of exactly `bytes` characters (name, colon and value), padded with a comment. */
function receivedOfSize(bytes: number): string {
  const head = 'Received: from a.example by b.example; 21 Nov 1997 10:01:22 -0600 (';
  const pad = bytes - head.length - 1;
  return `${head}${'x'.repeat(pad)})`;
}

it('200 hops are listed and the 201st stops the list with a note, and a 65,536-byte header is read while 65,537 bytes stop it', async () => {
  expect(MAX_HOPS).toBe(200);
  expect(MAX_HEADER_BYTES).toBe(65_536);

  // WEB-06 boundary: 200 Received lines are all listed, oldest first.
  const exact = await analyzeMessage(build([...receivedLines(200), 'From: a@example.com'], 'Hello.'));
  expect(exact.hops).toHaveLength(200);
  expect(exact.hops[0]?.from).toBe('h1.example');
  expect(exact.hops[199]?.from).toBe('h200.example');
  expect(exact.hops[199]?.delaySeconds).toBe(1);
  expect(exact.notes.join(' ')).not.toContain('Only the oldest');

  // A 201st line stops the list: the 200 oldest are kept, the newest is left out, and a note says so.
  const over = await analyzeMessage(build([...receivedLines(201), 'From: a@example.com'], 'Hello.'));
  expect(over.hops).toHaveLength(200);
  expect(over.hops[199]?.from).toBe('h200.example');
  expect(over.notes.join(' ')).toContain('Only the oldest 200 are listed');
  expect(over.notes.join(' ')).toContain('1 newer line was not read');

  // A header of 65,536 bytes is read; one of 65,537 bytes stops the reading of it and of the headers after it, with a note.
  const line = receivedOfSize(65_536);
  expect(line.length).toBe(65_536);
  const read = await analyzeMessage(build([line, 'From: a@example.com'], 'Hello.'));
  expect(read.hops).toHaveLength(1);
  expect(read.hops[0]?.from).toBe('a.example');
  expect(read.headers.map((h) => h.name)).toEqual(['Received', 'From']);
  expect(read.notes.join(' ')).not.toContain('longer than');

  const tooLong = receivedOfSize(65_537);
  expect(tooLong.length).toBe(65_537);
  const stopped = await analyzeMessage(build([tooLong, 'From: a@example.com'], 'Hello.'));
  expect(stopped.hops).toHaveLength(0);
  expect(stopped.headers).toHaveLength(0);
  expect(stopped.notes.join(' ')).toContain(`longer than ${withCommas(65_536)} bytes`);
});

it('addresses, groups and comments are read and a comment nested 100,000 deep is refused', async () => {
  const flat = (text: string): { name: string; address: string; group: string }[] => parseAddressList(text).mailboxes;

  // RFC 5322 Appendix A.1.2: a name, a bare address, a name with a question mark, an address with no name, a quoted name
  // holding a semicolon and escaped quotes.
  expect(flat('Mary Smith <mary@x.test>, jdoe@example.org, Who? <one@y.test>')).toEqual([
    { name: 'Mary Smith', address: 'mary@x.test', group: '' },
    { name: '', address: 'jdoe@example.org', group: '' },
    { name: 'Who?', address: 'one@y.test', group: '' },
  ]);
  expect(flat('<boss@nil.test>, "Giant; \\"Big\\" Box" <sysservices@example.net>')).toEqual([
    { name: '', address: 'boss@nil.test', group: '' },
    { name: 'Giant; "Big" Box', address: 'sysservices@example.net', group: '' },
  ]);
  expect(flat('"Joe Q. Public" <john.q.public@example.com>')).toEqual([
    { name: 'Joe Q. Public', address: 'john.q.public@example.com', group: '' },
  ]);

  // Appendix A.1.3: a group with three members, and a group with none.
  const group = parseAddressList('A Group:Ed Jones <c@a.test>,joe@where.test,John <jdoe@one.test>;');
  expect(group.groups).toEqual(['A Group']);
  expect(group.mailboxes).toEqual([
    { name: 'Ed Jones', address: 'c@a.test', group: 'A Group' },
    { name: '', address: 'joe@where.test', group: 'A Group' },
    { name: 'John', address: 'jdoe@one.test', group: 'A Group' },
  ]);
  const empty = parseAddressList('Undisclosed recipients:;');
  expect(empty.groups).toEqual(['Undisclosed recipients']);
  expect(empty.mailboxes).toEqual([]);
  // A mailbox after a group is not in the group.
  expect(parseAddressList('G: a@x.example; b@y.example').mailboxes.map((m) => m.group)).toEqual(['G', '']);

  // Appendix A.5: comments in names, addresses, after a group name, inside a group list and after the group.
  expect(flat('Pete(A nice \\) chap) <pete(his account)@silly.test(his host)>')).toEqual([
    { name: 'Pete', address: 'pete@silly.test', group: '' },
  ]);
  const oddities = parseAddressList(
    "A Group(Some people)\r\n     :Chris Jones <c@(Chris's host.)public.example>,\r\n         joe@example.org,\r\n  John <jdoe@one.test> (my dear friend); (the end of the group)",
  );
  expect(oddities.groups).toEqual(['A Group']);
  expect(oddities.mailboxes).toEqual([
    { name: 'Chris Jones', address: 'c@public.example', group: 'A Group' },
    { name: '', address: 'joe@example.org', group: 'A Group' },
    { name: 'John', address: 'jdoe@one.test', group: 'A Group' },
  ]);
  const hidden = parseAddressList('(Empty list)(start)Hidden recipients  :(nobody(that I know))  ;');
  expect(hidden.groups).toEqual(['Hidden recipients']);
  expect(hidden.mailboxes).toEqual([]);

  // Appendix A.6.1: an obsolete route is dropped, an empty element is skipped, spaces around the dot are closed up.
  expect(flat('Mary Smith <@node.test:mary@example.net>, , jdoe@test  . example')).toEqual([
    { name: 'Mary Smith', address: 'mary@example.net', group: '' },
    { name: '', address: 'jdoe@test.example', group: '' },
  ]);

  // At most 500 mailboxes are read, and a note says how many were left.
  const many = parseAddressList(Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `a${i}@x.example`).join(', '));
  expect(many.mailboxes).toHaveLength(MAX_ADDRESSES);
  expect(many.notes.join(' ')).toContain('more than 500');
  expect(parseAddressList(Array.from({ length: MAX_ADDRESSES }, (_, i) => `a${i}@x.example`).join(', ')).notes).toEqual(
    [],
  );

  // A comment nested 50 deep is read; one nested 51 deep, or 100,000 deep, stops the reading of that header with a note.
  expect(MAX_COMMENT_DEPTH).toBe(50);
  const okay = '('.repeat(50) + 'x' + ')'.repeat(50);
  expect(stripComments(`a${okay}b`)).toMatchObject({ text: 'a b', tooDeep: false, unclosed: false });
  expect(stripComments(`a${'('.repeat(51)}x${')'.repeat(51)}b`)).toMatchObject({ text: 'a', tooDeep: true });
  expect(stripComments('a (never closed')).toMatchObject({ text: 'a ', unclosed: true });
  expect(stripComments('a "(not a comment)" b').text).toBe('a "(not a comment)" b');
  expect(stripComments('a \\( b (c \\) d) e').text).toBe('a \\( b   e');
  const deep = '('.repeat(100_000);
  const deepAddress = parseAddressList(`Joe <joe@example.org>, ${deep}`);
  expect(deepAddress.mailboxes).toEqual([{ name: 'Joe', address: 'joe@example.org', group: '' }]);
  expect(deepAddress.notes.join(' ')).toContain('nested more than 50 levels deep');
  expect(parseReceived(`from a.example ${deep}) by b.example; 21 Nov 1997 10:01:22 -0600`).notes.join(' ')).toContain(
    'nested more than 50 levels deep',
  );
  expect(readMailDate(`21 Nov 1997 10:01:22 -0600 ${deep}`)).toBeNull();
  expect(parseAuthenticationResults(`mx.example.org; spf=pass ${deep}`).notes.join(' ')).toContain(
    'nested more than 50 levels deep',
  );
  expect(parseAuthenticationResults(`mx.example.org; spf=pass ${deep}`).results).toEqual([
    { method: 'spf', methodVersion: '', result: 'pass', reason: '', properties: [] },
  ]);

  // A header of 60,000 opening parentheses goes through the whole analysis without throwing and is said once.
  const analysis = await analyzeMessage(
    build(
      [`From: Joe <joe@example.org> ${'('.repeat(60_000)}`, `Received: from a.example ${'('.repeat(60_000)}`],
      'Hello.',
    ),
  );
  expect(analysis.notes.filter((n) => n.includes('nested more than 50 levels deep')).length).toBeGreaterThan(0);
});

it('Received, address, Authentication-Results, DKIM and ARC names such as __proto__, constructor and toString are plain names', async () => {
  const auth = parseAuthenticationResults(
    '__proto__; constructor=toString __proto__.constructor=toString; toString=pass',
  );
  expect(auth.serverId).toBe('__proto__');
  expect(auth.results.map((r) => [r.method, r.result])).toEqual([
    ['constructor', 'toString'],
    ['toString', 'pass'],
  ]);
  expect(auth.results[0]?.properties).toEqual([{ ptype: '__proto__', property: 'constructor', value: 'toString' }]);

  const received = parseReceived(
    'from __proto__ by constructor with toString id hasOwnProperty; 21 Nov 1997 10:01:22 -0600',
  );
  expect(received).toMatchObject({ from: '__proto__', by: 'constructor', with: 'toString', id: 'hasOwnProperty' });

  const arc = groupArc([
    { index: 1, name: '__proto__', value: 'i=1' },
    { index: 2, name: 'constructor', value: 'i=1' },
    { index: 3, name: 'ARC-Seal', value: 'i=1; a=rsa-sha256; cv=__proto__; d=constructor; s=toString' },
  ]);
  expect(arc.sets).toHaveLength(1);
  expect(arc.sets[0]?.seal).toMatchObject({ cv: '__proto__', domain: 'constructor', selector: 'toString' });

  const dkim = parseDkimSignature('constructor=2; toString=3; hasOwnProperty=4; valueOf=5');
  expect(dkim.tags.map((r) => r.tag)).toEqual(['constructor', 'toString', 'hasOwnProperty', 'valueOf']);

  const analysis = await analyzeMessage(
    build(
      [
        '__proto__: x',
        'constructor: y',
        'toString: z',
        'Received: from a.example by b.example; 21 Nov 1997 10:01:22 -0600',
      ],
      'x',
    ),
  );
  expect(analysis.hops).toHaveLength(1);
  expect(analysis.headers.map((h) => h.name)).toEqual(['__proto__', 'constructor', 'toString', 'Received']);

  // Nothing above wrote to the shared object prototype.
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(({} as Record<string, unknown>)['pass']).toBeUndefined();
  expect(({} as Record<string, unknown>)['toString']).toBe(Object.prototype.toString);
});

const OWN_HOSTILE: ReadonlyArray<readonly [string, (n: number) => string]> = [
  ['open parentheses', (n) => '('.repeat(n)],
  ['nested open parentheses and text', (n) => '(a'.repeat(Math.floor(n / 2))],
  ['quotes', (n) => '"'.repeat(n)],
  ['angle brackets', (n) => '<'.repeat(n)],
  ['backslashes', (n) => '\\('.repeat(Math.floor(n / 2))],
  ['colons', (n) => ':'.repeat(n)],
  ['equals signs', (n) => '='.repeat(n)],
  ['clause words', (n) => 'from by with id for '.repeat(Math.floor(n / 20))],
  ['a 10,000 word Received', (n) => `from ${'w '.repeat(Math.floor(n / 2))}`],
  ['tag pairs', (n) => 'a=b; '.repeat(Math.floor(n / 5))],
  ['results', (n) => 'mx.example.org; spf=pass header.d=x '.repeat(Math.floor(n / 37))],
  ['addresses', (n) => 'a@b.example, '.repeat(Math.floor(n / 13))],
  ['groups', (n) => 'g: a@b.example; '.repeat(Math.floor(n / 16))],
  ['dates', (n) => '1 Jan 2000 '.repeat(Math.floor(n / 11))],
  ['dots', (n) => 'a . '.repeat(Math.floor(n / 4))],
];

it('every header parser stays linear on hostile input', () => {
  const parsers: ReadonlyArray<readonly [string, (input: string) => unknown]> = [
    ['readMailDate', (s) => readMailDate(s)],
    ['parseReceived', (s) => parseReceived(s)],
    ['parseAddressList', (s) => parseAddressList(s)],
    ['parseAuthenticationResults', (s) => parseAuthenticationResults(s)],
    ['parseDkimSignature', (s) => parseDkimSignature(s, 'example.com', 0)],
    ['stripComments', (s) => stripComments(s)],
    [
      'groupArc',
      (s) =>
        groupArc([
          { index: 1, name: 'ARC-Seal', value: s },
          { index: 2, name: 'ARC-Authentication-Results', value: s },
          { index: 3, name: 'ARC-Message-Signature', value: s },
        ]),
    ],
  ];
  const inputs: ReadonlyArray<readonly [string, (n: number) => string]> = [
    ...HOSTILE.map((make, i) => [`shared string ${i + 1}`, make] as const),
    ...OWN_HOSTILE,
  ];
  const slow: string[] = [];
  let measured = 0;
  for (const [parserName, parser] of parsers) {
    for (const [inputName, make] of inputs) {
      let ratio = scalingRatio(parser, make, 20_000);
      // The limit is not loosened. A ratio over it is measured twice more and the median of the three is judged.
      if (ratio > 6) {
        const again = [ratio, scalingRatio(parser, make, 20_000), scalingRatio(parser, make, 20_000)].sort(
          (a, b) => a - b,
        );
        ratio = again[1] ?? ratio;
      }
      measured++;
      if (ratio > 6) slow.push(`${parserName} on ${inputName}: ${ratio.toFixed(1)}`);
    }
  }
  expect(measured).toBe(parsers.length * inputs.length);
  expect(slow).toEqual([]);
}, 240_000);
