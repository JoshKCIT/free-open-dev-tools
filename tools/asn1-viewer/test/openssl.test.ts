import { expect, it } from 'vitest';
import { describeBytes, readBer, type Asn1Node } from '../src/index';
import { STRUCTURES } from './fixtures/openssl/structures';
import { fromHex, readFixture } from './helpers';

/*
 * Two recorded second opinions. OpenSSL 3.5.5 `asn1parse -inform DER -i` was run on real structures and on the worked
 * examples of ITU-T X.690 (fixtures/openssl, with the script that made them), and the reader must agree with every line
 * it printed. The 484 ECDSA signature vectors of Project Wycheproof (Apache-2.0, reduced to tcId, comment, flags and sig,
 * fixtures/wycheproof) are read to see that nothing throws and that encodings which are not DER are noticed.
 */

interface OpensslLine {
  offset: number;
  depth: number;
  headerLength: number;
  length: number | 'inf';
  constructed: boolean;
  tag: string;
}
interface OpensslRecording {
  openssl: string;
  recordedAt: string;
  structures: Record<string, OpensslLine[]>;
}
const RECORDING = JSON.parse(readFixture('openssl', 'asn1parse.json')) as OpensslRecording;

/** OpenSSL's name for a tag, written here from OpenSSL's own output format, independent of the package's names. */
const OPENSSL_UNIVERSAL = new Map<number, string>([
  [1, 'BOOLEAN'],
  [2, 'INTEGER'],
  [3, 'BIT STRING'],
  [4, 'OCTET STRING'],
  [5, 'NULL'],
  [6, 'OBJECT'],
  [10, 'ENUMERATED'],
  [12, 'UTF8STRING'],
  [16, 'SEQUENCE'],
  [17, 'SET'],
  [19, 'PRINTABLESTRING'],
  [22, 'IA5STRING'],
  [23, 'UTCTIME'],
  [24, 'GENERALIZEDTIME'],
  [26, 'VISIBLESTRING'],
]);

function opensslTag(node: Asn1Node): string {
  if (node.eoc) return 'EOC';
  if (node.cls === 'universal') return OPENSSL_UNIVERSAL.get(node.tag) ?? `<ASN1 ${node.tag}>`;
  const word = node.cls === 'application' ? 'appl' : node.cls === 'context' ? 'cont' : 'priv';
  return `${word} [ ${node.tag} ]`;
}

/** Structures where OpenSSL stopped listing before the end, or lists fewer lines than the reader has elements. None. */
const LISTED_SHORT: string[] = [];

it('the recorded structures match openssl asn1parse on offset, depth, header length, length and kind on every line', () => {
  expect(RECORDING.openssl).toContain('3.5.5');
  expect(RECORDING.recordedAt).toMatch(/^2026-/);
  const names = Object.keys(RECORDING.structures);
  // Every recorded structure has its bytes, and every set of bytes has its recording.
  expect(names.sort()).toEqual(Object.keys(STRUCTURES).sort());
  let compared = 0;
  for (const name of names) {
    const bytes = new Uint8Array(Buffer.from(STRUCTURES[name]!, 'base64'));
    const result = readBer(bytes);
    expect(result.findings, `${name}: nothing is wrong with a structure OpenSSL made`).toEqual([]);
    expect(result.cut, name).toEqual({ nodes: null, depth: null, stopped: null });
    const byOffset = new Map(result.nodes.map((node) => [node.offset, node]));
    const lines = RECORDING.structures[name]!;
    if (!LISTED_SHORT.includes(name))
      expect(result.nodes.length, `${name}: the same number of lines`).toBe(lines.length);
    for (const line of lines) {
      const node = byOffset.get(line.offset);
      const where = `${name} at offset ${line.offset}`;
      expect(node, where).toBeDefined();
      expect(node!.depth, `${where}: depth`).toBe(line.depth);
      expect(node!.headerLength, `${where}: header length`).toBe(line.headerLength);
      expect(node!.indefinite ? 'inf' : node!.length, `${where}: length`).toBe(line.length);
      expect(node!.constructed, `${where}: constructed or primitive`).toBe(line.constructed);
      expect(opensslTag(node!), `${where}: tag`).toBe(line.tag);
      compared++;
    }
  }
  // 15 worked examples and 16 structures made by OpenSSL, 636 lines in all.
  expect(names).toHaveLength(31);
  expect(compared).toBe(636);
});

interface WycheproofTest {
  tcId: number;
  comment: string;
  flags: string[];
  sig: string;
}
const WYCHEPROOF = JSON.parse(readFixture('wycheproof', 'ecdsa-p256-sha256.json')) as { tests: WycheproofTest[] };

/**
 * The InvalidEncoding vectors that the reader does not flag, by tcId. Each is something a reader that does not know the
 * schema cannot tell from a correct encoding: tcId 21 is an empty signature (no element, so nothing to find), and tcIds 38
 * and 39 are well-formed BER whose first octets (2e and 2f) are a constructed universal tag 14 and tag 15 where the
 * signature should have a SEQUENCE. An earlier, smaller sketch of the reader listed eight; it did not check a short-form length against the
 * container (tcIds 45 and 116 run past it), a constructed string (41), the unused-bits octet of a BIT STRING (97), a
 * constructed NULL (28) or a constructed INTEGER (31, 32, 88, 101, 131, 144), and this reader does.
 */
const UNFLAGGED_INVALID_ENCODING = [21, 38, 39];

it('the Wycheproof ECDSA signatures never throw: 10 valid give no finding, 7 of 7 BER are flagged and 89 of 92 invalid are flagged', () => {
  expect(WYCHEPROOF.tests).toHaveLength(484);
  const flagged = (test: WycheproofTest): boolean => {
    const result = describeBytes(fromHex(test.sig), { tryInside: false });
    return result.findings.length > 0;
  };
  const valid = WYCHEPROOF.tests.filter((test) => test.flags.includes('ValidSignature'));
  const ber = WYCHEPROOF.tests.filter((test) => test.flags.includes('BerEncodedSignature'));
  const invalid = WYCHEPROOF.tests.filter((test) => test.flags.includes('InvalidEncoding'));
  expect([valid.length, ber.length, invalid.length]).toEqual([10, 7, 92]);

  // Nothing throws, on any of the 484.
  for (const test of WYCHEPROOF.tests)
    expect(() => describeBytes(fromHex(test.sig)), `tcId ${test.tcId}`).not.toThrow();

  for (const test of valid) expect(flagged(test), `tcId ${test.tcId} is a valid signature`).toBe(false);
  for (const test of ber) expect(flagged(test), `tcId ${test.tcId} is BER and not DER`).toBe(true);

  const missed = invalid.filter((test) => !flagged(test)).map((test) => test.tcId);
  expect(invalid.length - missed.length).toBe(89);
  expect(missed).toEqual(UNFLAGGED_INVALID_ENCODING);
});
