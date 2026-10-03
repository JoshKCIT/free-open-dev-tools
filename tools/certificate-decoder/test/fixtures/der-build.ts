/**
 * A tiny DER writer for tests: it builds certificate parts byte by byte so the decoder is tested against bytes it did not
 * make and against shapes OpenSSL will not produce (every string type, hostile counts, odd algorithms). Written from
 * ITU-T X.690 sections 8 and 10 and RFC 5280 appendix A; nothing here is shared with the package.
 */

export type Bytes = Uint8Array;

export function concat(...parts: (Bytes | number[])[]): Bytes {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function lengthBytes(length: number): number[] {
  if (length < 128) return [length];
  const octets: number[] = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) octets.unshift(value % 256);
  return [0x80 | octets.length, ...octets];
}

/** One element: a tag octet, the length in its shortest form, then the content. */
export function tlv(tag: number, content: Bytes | number[]): Bytes {
  return concat([tag], lengthBytes(content.length), content);
}

export const seq = (...children: (Bytes | number[])[]): Bytes => tlv(0x30, concat(...children));
export const set = (...children: (Bytes | number[])[]): Bytes => tlv(0x31, concat(...children));

/** A context-specific element: constructed ([n] holding other elements) or primitive (an implicit tag). */
export function context(number: number, content: Bytes | number[], constructed = true): Bytes {
  return tlv((constructed ? 0xa0 : 0x80) | number, content);
}

export function oid(dotted: string): Bytes {
  const arcs = dotted.split('.').map((arc) => BigInt(arc));
  const octets: number[] = [];
  const encode = (value: bigint): void => {
    const pieces: number[] = [Number(value & 0x7fn)];
    for (let rest = value >> 7n; rest > 0n; rest >>= 7n) pieces.unshift(Number(rest & 0x7fn) | 0x80);
    octets.push(...pieces);
  };
  encode(arcs[0]! * 40n + arcs[1]!);
  for (const arc of arcs.slice(2)) encode(arc);
  return tlv(0x06, octets);
}

export function hex(text: string): Bytes {
  const clean = text.replace(/[^0-9a-fA-F]/g, '');
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

/** An INTEGER from big-endian bytes written as hex; a 00 is put in front when the first bit is set (a non-negative value). */
export function integer(hexText: string): Bytes {
  let content = hex(hexText);
  while (content.length > 1 && content[0] === 0 && (content[1]! & 0x80) === 0) content = content.subarray(1);
  if ((content[0]! & 0x80) !== 0) content = concat([0], content);
  return tlv(0x02, content);
}

export const nul = (): Bytes => tlv(0x05, []);
export const boolean = (value: boolean): Bytes => tlv(0x01, [value ? 0xff : 0x00]);
export const octetString = (content: Bytes | number[]): Bytes => tlv(0x04, content);
export const bitString = (content: Bytes | number[], unused = 0): Bytes => tlv(0x03, concat([unused], content));

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
export const utf8 = (text: string): Bytes => tlv(0x0c, Uint8Array.from(Buffer.from(text, 'utf8')));
export const printable = (text: string): Bytes => tlv(0x13, ascii(text));
export const ia5 = (text: string): Bytes => tlv(0x16, ascii(text));
/** A TeletexString holds one byte per character here, as the decoder reads it (ISO 8859-1). */
export const teletex = (bytes: number[]): Bytes => tlv(0x14, bytes);
export const bmp = (text: string): Bytes => {
  const units: number[] = [];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i) >> 8, text.charCodeAt(i) & 255);
  return tlv(0x1e, units);
};
export const universal = (text: string): Bytes => {
  const out: number[] = [];
  for (const char of text) {
    const point = char.codePointAt(0)!;
    out.push((point >>> 24) & 255, (point >>> 16) & 255, (point >>> 8) & 255, point & 255);
  }
  return tlv(0x1c, out);
};
export const utcTime = (text: string): Bytes => tlv(0x17, ascii(text));
export const generalizedTime = (text: string): Bytes => tlv(0x18, ascii(text));

/** One attribute type and value pair inside its own RDN. */
export const rdn = (type: string, value: Bytes): Bytes => set(seq(oid(type), value));
export const name = (...rdns: Bytes[]): Bytes => seq(...rdns);

export const ALGORITHMS = {
  ecdsaSha256: seq(oid('1.2.840.10045.4.3.2')),
  sha256Rsa: seq(oid('1.2.840.113549.1.1.11'), nul()),
};

export function rsaSpki(modulusHex: string, exponentHex = '010001'): Bytes {
  return seq(seq(oid('1.2.840.113549.1.1.1'), nul()), bitString(seq(integer(modulusHex), integer(exponentHex))));
}

export interface CertificateParts {
  /** The version number as written (0, 1 or 2); leave out for a version 1 certificate. */
  version?: number;
  serialHex?: string;
  signature?: Bytes;
  issuer?: Bytes;
  notBefore?: Bytes;
  notAfter?: Bytes;
  subject?: Bytes;
  spki?: Bytes;
  /** Extension elements (see extension()), put in the [3] field. */
  extensions?: Bytes[];
}

/** An extension element: its identifier, the critical flag only when true (DER), and the bytes inside the OCTET STRING. */
export function extension(extnId: string, critical: boolean, value: Bytes | number[]): Bytes {
  return seq(oid(extnId), ...(critical ? [boolean(true)] : []), octetString(value));
}

/** A whole certificate with a made-up signature. Nothing checks the signature, so none is needed. */
export function buildCertificate(parts: CertificateParts = {}): Bytes {
  const signature = parts.signature ?? ALGORITHMS.ecdsaSha256;
  const tbs = seq(
    ...(parts.version === undefined ? [] : [context(0, integer(parts.version.toString(16).padStart(2, '0')))]),
    integer(parts.serialHex ?? '01'),
    signature,
    parts.issuer ?? name(rdn('2.5.4.3', utf8('Test Issuer'))),
    seq(parts.notBefore ?? utcTime('260101000000Z'), parts.notAfter ?? utcTime('360101000000Z')),
    parts.subject ?? name(rdn('2.5.4.3', utf8('Test Subject'))),
    parts.spki ?? rsaSpki('c1'.repeat(128)),
    ...(parts.extensions === undefined ? [] : [context(3, seq(...parts.extensions))]),
  );
  return seq(tbs, signature, bitString(new Uint8Array(8).fill(0xab)));
}

/** The Base64 of bytes, in one line. */
export function base64(bytes: Bytes): string {
  return Buffer.from(bytes).toString('base64');
}
