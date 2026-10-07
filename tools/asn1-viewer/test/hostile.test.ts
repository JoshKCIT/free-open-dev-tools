import { expect, it, vi } from 'vitest';
import { describeBytes, describeStructure, readBer, readInput, type Description } from '../src/index';
import { STRUCTURES } from './fixtures/openssl/structures';
import { PERSONNEL_HEX } from './fixtures/x690';
import { der, fromHex, mulberry32, readHex, toHex } from './helpers';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

/*
 * Hostile input. The caps are the ones the page states (40 levels, 100,000 elements, 5 MiB of text, 10 MiB of file), the
 * rules are the ones of the specification, and the sizes of the attacks are the ones that matter: a file of nested
 * indefinite headers, a file of tiny elements, nesting that is definite and so can be skipped. Doubling a hostile input must not
 * make a parser take more than 6 times as long (a parser that reads its input once takes about 2 times as long), and
 * four times the input not more than 12 times as long.
 */

it('nesting beyond 40 levels is not entered and says so, and reading stops at 100,000 elements saying how much was left', () => {
  // 2,621,440 headers 30 80, each opening an indefinite SEQUENCE: the 40th cannot be entered and its end cannot be found.
  const opens = new Uint8Array(2_621_440 * 2);
  for (let i = 0; i < opens.length; i += 2) {
    opens[i] = 0x30;
    opens[i + 1] = 0x80;
  }
  const nested = describeBytes(opens, { tryInside: false });
  expect(nested.nodes).toHaveLength(40);
  expect(nested.deepest).toBe(40);
  expect(nested.nodes[39]!.notRead).toBe('nesting');
  expect(nested.cut.depth).toMatchObject({ count: 1, firstOffset: 78 });
  expect(nested.cut.stopped).toEqual({ offset: 78, bytesLeft: 5_242_880 - 78 });
  expect(nested.findings).toHaveLength(1);
  expect(nested.findings[0]!.message).toContain('nested more than 40 levels deep');
  expect(nested.findings[0]!.message).toContain('5,242,802 bytes were left unread');
  expect(nested.findings[0]!.message).toContain('offset 78');
  expect(nested.nodes[39]!.value?.text).toBe('contents not read: nested more than 40 levels');

  // 100,000 definite SEQUENCEs inside one another can be skipped by their lengths: the 40th is shown and the rest is stepped over.
  const depth = 100_000;
  const definite = new Uint8Array(depth * 6);
  for (let i = 0; i < depth; i++) {
    const length = (depth - i - 1) * 6;
    definite.set([0x30, 0x84, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255], i * 6);
  }
  const skipped = describeBytes(definite, { tryInside: false });
  expect(skipped.nodes).toHaveLength(40);
  expect(skipped.cut.depth).toMatchObject({ count: 1, firstOffset: 234 });
  expect(skipped.cut.stopped).toBeNull();
  expect(skipped.findings).toHaveLength(1);
  expect(skipped.findings[0]!.message).toContain('599,766 bytes were skipped');

  // Exactly 40 levels are read in full; the 41st is where the cut is.
  let forty = [0x05, 0x00];
  for (let i = 0; i < 39; i++) forty = der(0x30, forty);
  const full = describeBytes(new Uint8Array(forty), { tryInside: false });
  expect(full.deepest).toBe(40);
  expect(full.cut.depth).toBeNull();
  expect(full.findings).toEqual([]);
  const over = describeBytes(new Uint8Array(der(0x30, forty)), { tryInside: false });
  expect(over.deepest).toBe(40);
  expect(over.cut.depth).toMatchObject({ count: 1 });

  // 5,000,000 NULLs in one SEQUENCE (about 10 MB): the 100,000th element is the last one read.
  const count = 5_000_000;
  const flood = new Uint8Array(6 + count * 2);
  flood.set([0x30, 0x84, (count * 2) >>> 24, ((count * 2) >>> 16) & 255, ((count * 2) >>> 8) & 255, (count * 2) & 255]);
  for (let i = 6; i < flood.length; i += 2) flood[i] = 0x05;
  const crowded = describeBytes(flood, { tryInside: false });
  expect(crowded.nodes).toHaveLength(100_000);
  expect(crowded.elements).toBe(100_000);
  expect(crowded.cut.nodes).toEqual({ offset: 6 + 99_999 * 2, bytesLeft: flood.length - (6 + 99_999 * 2) });
  const message = crowded.findings.find((finding) => finding.message.includes('at most 100,000 elements'))!.message;
  expect(message).toContain('9,800,002 bytes were left unread');
  expect(message).toContain('offset 200004');
});

it('20,000 seeded mutations of the corpus never throw and never hang', () => {
  const corpus: Uint8Array[] = [fromHex(PERSONNEL_HEX)];
  for (const base64 of Object.values(STRUCTURES)) corpus.push(new Uint8Array(Buffer.from(base64, 'base64')));
  const random = mulberry32(190301);
  const pick = (n: number): number => Math.floor(random() * n);

  /** Changes bytes without regard to structure: flips, replaced bytes, a cut, a gap, inserted bytes. */
  const mangle = (original: Uint8Array): Uint8Array => {
    const bytes = Array.from(original);
    const edits = 1 + pick(4);
    for (let i = 0; i < edits && bytes.length > 0; i++) {
      const at = pick(bytes.length);
      const kind = pick(5);
      if (kind === 0) bytes[at] = bytes[at]! ^ (1 << pick(8));
      else if (kind === 1) bytes[at] = pick(256);
      else if (kind === 2) bytes.length = Math.max(0, at);
      else if (kind === 3) bytes.splice(at, 1 + pick(8));
      else bytes.splice(at, 0, ...Array.from({ length: 1 + pick(6) }, () => pick(256)));
    }
    return new Uint8Array(bytes);
  };

  /** Changes the shape and keeps the bytes well formed: another length, tag, or form of a real element. */
  const reshape = (original: Uint8Array): Uint8Array => {
    const nodes = readBer(original).nodes;
    if (nodes.length === 0) return original;
    const node = nodes[pick(nodes.length)]!;
    const bytes = Array.from(original);
    const kind = pick(5);
    if (kind === 0) bytes[node.offset] = (bytes[node.offset]! & 0x20) | (pick(4) << 6) | pick(31);
    else if (kind === 1) bytes[node.offset] = bytes[node.offset]! ^ 0x20;
    else if (kind === 2 && node.headerLength === 2) bytes[node.offset + 1] = pick(128);
    else if (kind === 3 && node.headerLength === 2) bytes[node.offset + 1] = 0x80;
    else if (node.headerLength >= 2) bytes[node.offset + 1] = 0x80 | pick(10);
    return new Uint8Array(bytes);
  };

  let reads = 0;
  for (let i = 0; i < 20_000; i++) {
    const original = corpus[pick(corpus.length)]!;
    const bytes = i % 2 === 0 ? mangle(original) : reshape(original);
    let result: Description;
    try {
      result = describeBytes(bytes, { tryInside: i % 4 < 2, flat: i % 3 === 0 });
    } catch (err) {
      throw new Error(`mutation ${i} threw: ${String(err)}`);
    }
    reads++;
    // Whatever the bytes were: offsets rise, nothing leaves the data, the levels stay within 40, findings stay within 200.
    let previous = -1;
    for (const node of result.nodes) {
      expect(node.offset).toBeGreaterThan(previous);
      previous = node.offset;
      expect(node.end).toBeLessThanOrEqual(bytes.length);
      expect(node.depth).toBeLessThan(40);
    }
    expect(result.findings.length).toBeLessThanOrEqual(200);
    expect(result.copyText.split('\n').length).toBeGreaterThanOrEqual(result.nodes.length);
  }
  expect(reads).toBe(20_000);
}, 180_000);

/** The ratio of the time for 2n to that for n, measured up to three times and judged by the median when the first is over. */
function judged(
  fn: (input: string) => unknown,
  make: (n: number) => string,
  n: number,
  limit: number,
  factor: number,
): number {
  const ratios: number[] = [];
  // For four times the input the helper's own 2n is replaced by 4n, so its median-of-5 timing is still used.
  const sizes = factor === 2 ? make : (size: number): string => make(size === n ? n : factor * n);
  for (let i = 0; i < 3; i++) {
    ratios.push(scalingRatio(fn, sizes, n));
    if (ratios[i]! <= limit) return ratios[i]!;
  }
  ratios.sort((a, b) => a - b);
  return ratios[1]!;
}

it('every parser stays linear on hostile input', () => {
  const hex =
    (text: string): ((n: number) => string) =>
    (n) =>
      text.repeat(Math.floor(n / text.length));
  const setOf = (n: number): string => {
    // A SET of n/6 equal INTEGERs: every neighbour is compared with the next.
    const children = '020101'.repeat(Math.max(1, Math.floor(n / 6)));
    const length = children.length / 2;
    const octets = length < 128 ? [length] : [0x80 | 3, (length >>> 16) & 255, (length >>> 8) & 255, length & 255];
    return '31' + toHex(new Uint8Array(octets)) + children;
  };
  const nestedOctets = (n: number): string => {
    // 30 OCTET STRINGs one inside another around n/2 bytes: each level is tried as ASN.1 once.
    let inner = new Array<number>(Math.max(2, Math.floor(n / 2))).fill(0);
    for (let i = 0; i < 30; i++) inner = der(0x04, inner);
    return toHex(new Uint8Array(inner));
  };
  const cases: [string, (input: string) => unknown, (n: number) => string, number][] = [
    ['hex of zero bytes', (s) => describeStructure({ data: s, format: 'hex', flat: true }), hex('00'), 20_000],
    ['nested indefinite headers', (s) => describeStructure({ data: s, format: 'hex' }), hex('3080'), 20_000],
    ['flood of NULLs', (s) => describeStructure({ data: s, format: 'hex', flat: true }), hex('0500'), 20_000],
    ['tag continuation octets', (s) => describeStructure({ data: s, format: 'hex' }), hex('1f80'), 20_000],
    ['Base64 of zero bytes', (s) => describeStructure({ data: s, format: 'base64' }), (n) => 'A'.repeat(n), 20_000],
    [
      'line feeds before hex',
      (s) => describeStructure({ data: s, format: 'hex' }),
      (n) => '\n'.repeat(n) + '0500',
      20_000,
    ],
    ['spaces in hex', (s) => describeStructure({ data: s, format: 'hex' }), hex('05 00 '), 20_000],
    ['PEM begin lines', (s) => describeStructure({ data: s, format: 'pem' }), hex('-----BEGIN A-----'), 20_000],
    ['text of dashes', (s) => readInput(s, 'auto'), (n) => '-'.repeat(n), 20_000],
    ['a SET of equal INTEGERs', (s) => describeStructure({ data: s, format: 'hex' }), setOf, 20_000],
    [
      'OCTET STRINGs inside OCTET STRINGs',
      (s) => describeStructure({ data: s, format: 'hex', tryInside: true }),
      nestedOctets,
      20_000,
    ],
    ['reader on hex bytes', (s) => readBer(fromHex(s.length % 2 === 0 ? s : s + '0')), hex('3000'), 20_000],
  ];
  for (const [name, fn, make, n] of cases) {
    const twice = judged(fn, make, n, MAX_SCALING_RATIO, 2);
    expect(twice, `${name}: twice the input took ${twice.toFixed(1)} times as long`).toBeLessThanOrEqual(
      MAX_SCALING_RATIO,
    );
    const fourfold = judged(fn, make, n, 12, 4);
    expect(fourfold, `${name}: four times the input took ${fourfold.toFixed(1)} times as long`).toBeLessThanOrEqual(12);
  }
}, 300_000);

it('reading the same bytes again, alone or between other inputs, gives a deep-equal tree', () => {
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
  const inputs = [
    PERSONNEL_HEX,
    toHex(new Uint8Array(Buffer.from(STRUCTURES['cms-stream']!, 'base64'))),
    toHex(new Uint8Array(Buffer.from(STRUCTURES['ts-query']!, 'base64'))),
    '3080' + '3080' + '0500',
    '04053003020105',
  ];
  const read = (hex: string): Description =>
    describeStructure({ data: hex, format: 'hex', tryInside: true, flat: true });
  const alone = inputs.map(read);
  // The same inputs again, in another order and with other inputs between them, one of which is refused.
  const again = [...inputs].reverse().map(read).reverse();
  expect(() => describeStructure({ data: 'not hex at all', format: 'hex' })).toThrow();
  const between = inputs.map((hex) => {
    read('0500');
    readHex('3003020105');
    return read(hex);
  });
  for (let i = 0; i < inputs.length; i++) {
    expect(again[i], `input ${i} read again`).toEqual(alone[i]);
    expect(between[i], `input ${i} read between others`).toEqual(alone[i]);
  }
  // The package prints nothing, whatever it reads.
  for (const spy of logs) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

it('the copy text holds every element read, including those past the 5,000 the tree draws', () => {
  // 6,000 NULLs in one SEQUENCE: 6,001 elements, more than the 5,000 the block draws.
  const nulls = new Array<number>(6_000).fill(0).flatMap(() => [0x05, 0x00]);
  const result = describeBytes(new Uint8Array(der(0x30, nulls)), { tryInside: false });
  expect(result.elements).toBe(6_001);
  expect(result.nodes).toHaveLength(6_001);
  // The whole tree is handed to the block, which draws part of it; the copy text is the whole of it.
  expect(result.tree).toHaveLength(1);
  expect(result.tree[0]!.children).toHaveLength(6_000);
  const lines = result.copyText.split('\n');
  expect(lines).toHaveLength(6_001);
  const lastOffset = 4 + 5_999 * 2;
  expect(lines[6_000]).toContain(`offset ${lastOffset},`);
  expect(lines[6_000]!.startsWith('  NULL\t')).toBe(true);
  expect(lines[0]).toMatch(/^SEQUENCE\toffset 0, header 4, length 12000, universal 16, constructed$/);

  // Guessed contents count as elements too and appear in the copy text, one level below their string.
  const guess = describeStructure({ data: '04053003020105', format: 'hex', tryInside: true });
  expect(guess.copyText.split('\n')).toHaveLength(4);
  expect(guess.copyText.split('\n')[1]).toBe('  contents look like ASN.1 (a guess)');
  expect(guess.elements).toBe(3);
});
