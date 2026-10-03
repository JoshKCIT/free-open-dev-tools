/**
 * DER writers, the small set the key formats need (ITU-T X.690): a tag, a length written in its shortest form, and a
 * body. Every writer returns a new array.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { KeyConverterError } from './model';

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function lengthOctets(length: number): number[] {
  if (length < 128) return [length];
  if (length < 256) return [0x81, length];
  if (length < 65536) return [0x82, length >> 8, length & 255];
  if (length < 16777216) return [0x83, length >> 16, (length >> 8) & 255, length & 255];
  return [0x84, (length >>> 24) & 255, (length >> 16) & 255, (length >> 8) & 255, length & 255];
}

export function tlv(tag: number, body: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag, ...lengthOctets(body.length)), body);
}

export function seq(...parts: Uint8Array[]): Uint8Array {
  return tlv(0x30, concat(...parts));
}

export function octet(bytes: Uint8Array): Uint8Array {
  return tlv(0x04, bytes);
}

/** A BIT STRING whose length is a whole number of bytes (no unused bits). */
export function bitString(bytes: Uint8Array): Uint8Array {
  return tlv(0x03, concat(Uint8Array.of(0), bytes));
}

/** An explicit, constructed context tag [n]. */
export function ctx(n: number, body: Uint8Array): Uint8Array {
  return tlv(0xa0 | n, body);
}

/** A non-negative INTEGER from its magnitude: leading zeros stripped, and a zero octet put in front of a set top bit. */
export function uint(bytes: Uint8Array): Uint8Array {
  let skip = 0;
  while (skip < bytes.length - 1 && bytes[skip] === 0) skip++;
  const magnitude = bytes.subarray(skip);
  if (magnitude.length === 0) return tlv(0x02, Uint8Array.of(0));
  return tlv(0x02, (magnitude[0]! & 0x80) !== 0 ? concat(Uint8Array.of(0), magnitude) : magnitude);
}

/** An INTEGER from 0 to 127, for version numbers. */
export function smallInt(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 127) throw new KeyConverterError('A small integer must be from 0 to 127.');
  return tlv(0x02, Uint8Array.of(n));
}

/** An OBJECT IDENTIFIER from its dotted form. Arcs are BigInt, so any size is exact. */
export function oid(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map((arc) => BigInt(arc));
  if (arcs.length < 2) throw new KeyConverterError('An object identifier needs at least two arcs.');
  const first = arcs[0]!;
  const second = arcs[1]!;
  if (first > 2n || (first < 2n && second >= 40n))
    throw new KeyConverterError('The first two arcs of an object identifier are out of range.');
  const out: number[] = [];
  const push = (value: bigint) => {
    const groups: number[] = [Number(value & 127n)];
    let rest = value >> 7n;
    while (rest > 0n) {
      groups.push(128 | Number(rest & 127n));
      rest >>= 7n;
    }
    for (let i = groups.length - 1; i >= 0; i--) out.push(groups[i]!);
  };
  push(first * 40n + second);
  for (let i = 2; i < arcs.length; i++) push(arcs[i]!);
  return tlv(0x06, Uint8Array.from(out));
}

export const NULL_DER = Uint8Array.of(0x05, 0x00);
