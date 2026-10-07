import { expect, it } from 'vitest';
import { LITERALS } from './fixtures/x690';
import { readHex } from './helpers';

/*
 * The worked examples of ITU-T X.690 (02/2021) clause 8, each read and compared with what its clause states: the tag
 * class and number, the form, the header and content lengths and the value. The expectations are written from the text of
 * the clauses (the bytes are in fixtures/x690.ts with the clause in each name), never taken from the reader's output.
 */

interface Line {
  offset: number;
  depth: number;
  cls: 'universal' | 'application' | 'context' | 'private';
  tag: number;
  constructed: boolean;
  headerLength: number;
  /** Content octets, or 'inf' for an indefinite length. */
  length: number | 'inf';
  /** Text that must appear in the value, when the clause gives a value. */
  has?: string[];
  /** The character string or object identifier the clause gives. */
  string?: string;
  oid?: string;
}

/** What each clause says about its example, keyed by the literal's clause and a word of its name. */
const EXPECTED: [clause: string, word: string, lines: Line[]][] = [
  [
    '8.1.3.4',
    'short form',
    // L = 38 is the one octet 00100110 = 0x26, bit 8 clear.
    [{ offset: 0, depth: 0, cls: 'universal', tag: 4, constructed: false, headerLength: 2, length: 38 }],
  ],
  [
    '8.1.3.5',
    'long form',
    // L = 201 is 10000001 11001001: an initial octet 0x81 saying one more octet follows, then 0xC9 = 201.
    [{ offset: 0, depth: 0, cls: 'universal', tag: 4, constructed: false, headerLength: 3, length: 201 }],
  ],
  [
    '8.1.3.6',
    'indefinite',
    // The indefinite form is the one octet 0x80; the contents end with end-of-contents octets 00 00 (clause 8.1.5).
    [
      { offset: 0, depth: 0, cls: 'universal', tag: 16, constructed: true, headerLength: 2, length: 'inf' },
      { offset: 2, depth: 1, cls: 'universal', tag: 2, constructed: false, headerLength: 2, length: 1, has: ['5'] },
      { offset: 5, depth: 1, cls: 'universal', tag: 0, constructed: false, headerLength: 2, length: 0 },
    ],
  ],
  [
    '8.2',
    'BOOLEAN TRUE',
    [{ offset: 0, depth: 0, cls: 'universal', tag: 1, constructed: false, headerLength: 2, length: 1, has: ['TRUE'] }],
  ],
  [
    '8.6.4.2',
    'primitive',
    // BIT STRING '0A3B5F291CD'H: 44 bits, so 4 unused bits in the last octet, after the initial octet 04.
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 3,
        constructed: false,
        headerLength: 2,
        length: 7,
        has: ['44 bits, 4 unused', '0a3b5f291cd0'],
      },
    ],
  ],
  [
    '8.6.4.2',
    'constructed',
    // The same value in two segments under an indefinite length: 16 bits with no unused bits, then 32 bits less four.
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 3,
        constructed: true,
        headerLength: 2,
        length: 'inf',
        has: ['44 bits, 4 unused', '0a3b5f291cd0'],
      },
      { offset: 2, depth: 1, cls: 'universal', tag: 3, constructed: false, headerLength: 2, length: 3 },
      { offset: 7, depth: 1, cls: 'universal', tag: 3, constructed: false, headerLength: 2, length: 5 },
      { offset: 14, depth: 1, cls: 'universal', tag: 0, constructed: false, headerLength: 2, length: 0 },
    ],
  ],
  ['8.8', 'NULL', [{ offset: 0, depth: 0, cls: 'universal', tag: 5, constructed: false, headerLength: 2, length: 0 }]],
  [
    '8.9',
    'SEQUENCE',
    [
      { offset: 0, depth: 0, cls: 'universal', tag: 16, constructed: true, headerLength: 2, length: 10 },
      {
        offset: 2,
        depth: 1,
        cls: 'universal',
        tag: 22,
        constructed: false,
        headerLength: 2,
        length: 5,
        string: 'Smith',
      },
      { offset: 9, depth: 1, cls: 'universal', tag: 1, constructed: false, headerLength: 2, length: 1, has: ['TRUE'] },
    ],
  ],
  [
    '8.14',
    'Type4',
    // [APPLICATION 7] constructed around [APPLICATION 3], whose contents are the five octets of "Jones".
    [
      { offset: 0, depth: 0, cls: 'application', tag: 7, constructed: true, headerLength: 2, length: 7 },
      {
        offset: 2,
        depth: 1,
        cls: 'application',
        tag: 3,
        constructed: false,
        headerLength: 2,
        length: 5,
        string: 'Jones',
      },
    ],
  ],
  [
    '8.19.5',
    'OBJECT IDENTIFIER',
    // 88 37 is 8 x 128 + 55 = 1079, which is 80 + 999: the first two arcs are 2 and 999.
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 6,
        constructed: false,
        headerLength: 2,
        length: 3,
        oid: '2.999.3',
      },
    ],
  ],
  [
    '8.20.5',
    'RELATIVE-OID',
    // c2 7b is 66 x 128 + 123 = 8571.
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 13,
        constructed: false,
        headerLength: 2,
        length: 4,
        oid: '8571.3.2',
      },
    ],
  ],
  [
    '8.23.5.4',
    'primitive',
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 26,
        constructed: false,
        headerLength: 2,
        length: 5,
        string: 'Jones',
      },
    ],
  ],
  [
    '8.23.5.4',
    'definite',
    // Constructed VisibleString of two OCTET STRING segments, "Jon" and "es"; the value is "Jones".
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 26,
        constructed: true,
        headerLength: 2,
        length: 9,
        string: 'Jones',
      },
      { offset: 2, depth: 1, cls: 'universal', tag: 4, constructed: false, headerLength: 2, length: 3, string: 'Jon' },
      { offset: 7, depth: 1, cls: 'universal', tag: 4, constructed: false, headerLength: 2, length: 2, string: 'es' },
    ],
  ],
  [
    '8.23.5.4',
    'indefinite',
    [
      {
        offset: 0,
        depth: 0,
        cls: 'universal',
        tag: 26,
        constructed: true,
        headerLength: 2,
        length: 'inf',
        string: 'Jones',
      },
      { offset: 2, depth: 1, cls: 'universal', tag: 4, constructed: false, headerLength: 2, length: 3, string: 'Jon' },
      { offset: 7, depth: 1, cls: 'universal', tag: 4, constructed: false, headerLength: 2, length: 2, string: 'es' },
      { offset: 11, depth: 1, cls: 'universal', tag: 0, constructed: false, headerLength: 2, length: 0 },
    ],
  ],
];

it('the X.690 clause examples read with the tags, lengths and values the clauses give', () => {
  // Every literal has an expectation, and every expectation has a literal: nothing is read without a stated answer.
  expect(EXPECTED).toHaveLength(LITERALS.length);
  for (const [clause, word, lines] of EXPECTED) {
    const literal = LITERALS.find((candidate) => candidate.clause === clause && candidate.name.includes(word));
    expect(literal, `a literal for clause ${clause} with "${word}"`).toBeDefined();
    const what = `clause ${clause}, ${literal!.name}`;
    const result = readHex(literal!.hex);
    // No finding at all: these are the standard's own examples. Notes for BER that DER does not allow are expected for
    // indefinite lengths and constructed strings, and are checked in ber.test.ts; here only problems matter.
    expect(
      result.findings.filter((finding) => finding.kind === 'problem'),
      what,
    ).toEqual([]);
    expect(result.nodes, what).toHaveLength(lines.length);
    lines.forEach((line, index) => {
      const node = result.nodes[index]!;
      const here = `${what}, element ${index + 1}`;
      expect(node.offset, here).toBe(line.offset);
      expect(node.depth, here).toBe(line.depth);
      expect(node.cls, here).toBe(line.cls);
      expect(node.tag, here).toBe(line.tag);
      expect(node.constructed, here).toBe(line.constructed);
      expect(node.headerLength, here).toBe(line.headerLength);
      if (line.length === 'inf') {
        expect(node.indefinite, here).toBe(true);
      } else {
        expect(node.indefinite, here).toBe(false);
        expect(node.length, here).toBe(line.length);
      }
      for (const text of line.has ?? []) expect(node.value?.text, here).toContain(text);
      if (line.string !== undefined) expect(node.value?.string, here).toBe(line.string);
      if (line.oid !== undefined) expect(node.value?.oid, here).toBe(line.oid);
    });
  }
});
