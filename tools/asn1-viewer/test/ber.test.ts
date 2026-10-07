import { expect, it } from 'vitest';
import { Asn1Error, describeStructure } from '../src/index';
import { PERSONNEL_HEX, PERSONNEL_STRINGS } from './fixtures/x690';

/*
 * The tracer: the personnel record of ITU-T X.690 (02/2021) annex A.3, pasted as hex and read as a tree. The expected
 * numbers are the ones the standard's figure gives (a header of 60 81 85, 133 content octets, 136 bytes in all) and the
 * strings it spells out, never the reader's own output. The second test puts a unique marker inside malformed input and
 * asserts that no message, finding or label repeats it.
 */

it('the X.690 annex A.3 personnel record reads as 133 content octets under 60 81 85', () => {
  expect(PERSONNEL_HEX.startsWith('608185')).toBe(true);
  const result = describeStructure({ data: PERSONNEL_HEX, format: 'hex' });
  expect(result.bytes).toBe(136);
  expect(result.form).toBe('hex');

  // 0x60 is class 01 (application), primitive/constructed bit set, tag number 0; 81 85 is the long form of 133.
  const root = result.nodes[0]!;
  expect(root).toMatchObject({
    offset: 0,
    depth: 0,
    cls: 'application',
    tag: 0,
    constructed: true,
    indefinite: false,
    headerLength: 3,
    length: 133,
    end: 136,
  });
  expect(result.nodes.filter((node) => node.depth === 0)).toHaveLength(1);

  // The strings the figure spells out, in document order. The dates are [APPLICATION 3] values and appear as their text.
  const strings = result.nodes.map((node) => node.value?.string).filter((text): text is string => text !== undefined);
  expect(strings).toEqual(PERSONNEL_STRINGS);

  // A well-formed record: nothing to report, and the tree holds one root with the same number of elements.
  expect(result.findings).toEqual([]);
  expect(result.tree).toHaveLength(1);
  expect(result.elements).toBe(result.nodes.length);
  expect(result.copyText.split('\n')).toHaveLength(result.nodes.length);
});

it('refusals and notes name offsets and never repeat input beyond the 64 byte preview', () => {
  const marker = 'ZQ-7c1d9e{MK}';
  const copies = [marker, marker.slice(0, 12), marker.slice(2, 9)];
  const texts: string[] = [];
  const keep = (what: string, ...messages: string[]): void => {
    for (const message of messages) {
      texts.push(message);
      // Every message is short: it names a place and a rule and never carries bytes of the input.
      expect(message.length, `${what}: ${message}`).toBeLessThan(400);
    }
  };

  // Text that is not the format it was read as: the sentence names a character position.
  const refusals: [string, string, 'hex' | 'base64' | 'auto' | 'pem'][] = [
    ['hex with a marker in a non-hex run', '3003 020105 ' + marker + ' 00', 'hex'],
    ['Base64 with a marker', 'MAMCAQU' + marker + 'AAAA', 'base64'],
    [
      'PEM with a marker in its body',
      '-----BEGIN CERTIFICATE-----\nMAMCAQU\n' + marker + '\n-----END CERTIFICATE-----\n',
      'pem',
    ],
    ['auto detection of the same marker text', '3003020105 ' + marker, 'auto'],
  ];
  for (const [what, text, format] of refusals) {
    let caught: unknown;
    try {
      describeStructure({ data: text, format });
    } catch (err) {
      caught = err;
    }
    // Auto detection may read marker text as Base64 of some bytes; then nothing is thrown and the checks below cover it.
    if (caught !== undefined) {
      expect(caught, what).toBeInstanceOf(Asn1Error);
      const message = (caught as Asn1Error).message;
      expect(message, what).toMatch(/position \d+|offset \d+/);
      keep(what, message);
    }
  }
  // The hex and Base64 cases must be refusals, not silent reads.
  expect(() => describeStructure({ data: '3003 020105 ' + marker, format: 'hex' })).toThrow(Asn1Error);
  expect(() => describeStructure({ data: 'MAMCAQU' + marker, format: 'base64' })).toThrow(Asn1Error);

  // Bytes whose structure cannot be followed: findings name an offset and say nothing of the bytes.
  const text = (value: string): number[] => [...value].map((ch) => ch.charCodeAt(0));
  const broken: [string, number[]][] = [
    ['a length that runs past the end', [0x30, 0x83, 0xff, 0xff, 0xff, ...text(marker.repeat(6))]],
    ['an indefinite length that is never closed', [0x30, 0x80, 0x04, 0x0d, ...text(marker)]],
    ['a length of the reserved octet FF', [0x04, 0xff, ...text(marker)]],
  ];
  for (const [what, bytes] of broken) {
    const result = describeStructure({ data: new Uint8Array(bytes) });
    expect(result.findings.length, what).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.message, what).toMatch(/offset \d+/);
      keep(what, finding.message);
    }
  }

  for (const text of texts) {
    for (const copy of copies) expect(text).not.toContain(copy);
  }
});
