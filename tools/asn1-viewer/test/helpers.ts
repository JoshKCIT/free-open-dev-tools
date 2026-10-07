import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeStructure, type Asn1Node, type Description, type Finding } from '../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The text of a file under test/fixtures. */
export function readFixture(...parts: string[]): string {
  return readFileSync(join(HERE, 'fixtures', ...parts), 'utf8');
}

/** The bytes of a hex string without separators. */
export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (octet) => octet.toString(16).padStart(2, '0')).join('');
}

/** A small seeded generator (mulberry32), so every run of a test sees the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reads hex as a structure, without looking inside OCTET STRING contents unless asked. */
export function readHex(hex: string, tryInside = false): Description {
  return describeStructure({ data: hex, format: 'hex', tryInside });
}

/** What could not be read: the findings that are problems, leaving out the notes for valid BER that is not DER. */
export function problemsOf(description: Description): Finding[] {
  return description.findings.filter((finding) => finding.kind === 'problem');
}

/** The node at an offset, or a failure naming the offset. */
export function nodeAt(description: Description, offset: number): Asn1Node {
  const node = description.nodes.find((candidate) => candidate.offset === offset);
  if (node === undefined) throw new Error(`no element at offset ${offset}`);
  return node;
}

/** Bytes of a tag, a length given as its octets, and contents. The length octets are the caller's, so a test can write any. */
export function tlv(tag: number, lengthOctets: number[], content: number[]): number[] {
  return [tag, ...lengthOctets, ...content];
}

/** The shortest definite length octets for a length. */
export function shortestLength(length: number): number[] {
  if (length < 128) return [length];
  const octets: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) octets.unshift(rest % 256);
  return [0x80 | octets.length, ...octets];
}

/** A definite-length element with the shortest length octets. */
export function der(tag: number, content: number[]): number[] {
  return tlv(tag, shortestLength(content.length), content);
}
