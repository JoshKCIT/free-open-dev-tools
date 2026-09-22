import { md5, sha1 } from '@noble/hashes/legacy.js';
import meta from './meta.json';

export { meta };

export type UuidVersion = 1 | 3 | 4 | 5 | 7;

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** The four namespaces defined in RFC 9562 appendix A for v3 and v5. */
export const NAMESPACES = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
} as const;

export type NamespaceName = keyof typeof NAMESPACES;

const HEX = /^[0-9a-fA-F]$/;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source. A UUID built from Math.random is a real
  // collision risk and shows up in production incidents.
  globalThis.crypto.getRandomValues(out);
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('A UUID must contain 32 hexadecimal digits.');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    if (!HEX.test(pair[0]!) || !HEX.test(pair[1]!)) throw new Error(`"${pair}" is not a pair of hex digits.`);
    out[i] = parseInt(pair, 16);
  }
  return out;
}

/** Sets the four version bits and the two variant bits in place. */
function stamp(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx, the RFC 9562 variant
  return bytes;
}

export function v4(): string {
  return bytesToUuid(stamp(randomBytes(16), 4));
}

/**
 * Time-ordered UUID. The first 48 bits are the Unix timestamp in milliseconds,
 * which is why v7 sorts by creation time and v4 does not.
 */
export function v7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Math.floor(now));
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  return bytesToUuid(stamp(bytes, 7));
}

// The v1 epoch is 1582-10-15, in 100-nanosecond intervals.
const GREGORIAN_OFFSET_100NS = 122192928000000000n;

const v1Clock = randomBytes(2);
let v1Node: Uint8Array | null = null;
let lastV1Base = -1n;
let v1Counter = 0;

/**
 * Time-based UUID. Uses a random node identifier with the multicast bit set,
 * as RFC 9562 section 6.10 permits, rather than a real MAC address. A browser
 * cannot read a MAC address, and publishing one would be a privacy problem.
 */
export function v1(now: number = Date.now()): string {
  if (!v1Node) {
    v1Node = randomBytes(6);
    v1Node[0] = v1Node[0]! | 0x01; // multicast bit marks it as not a real MAC
  }
  const base = BigInt(Math.floor(now)) * 10000n + GREGORIAN_OFFSET_100NS;
  // A millisecond holds 10,000 of the 100-nanosecond ticks this format counts,
  // so repeat calls inside one millisecond claim successive ticks. That keeps
  // every id distinct and ordered while the millisecond that reads back out
  // stays exactly the one that was asked for.
  if (base === lastV1Base) {
    v1Counter = (v1Counter + 1) % 10000;
  } else {
    lastV1Base = base;
    v1Counter = 0;
  }
  const time = base + BigInt(v1Counter);

  const bytes = new Uint8Array(16);
  const timeLow = Number(time & 0xffffffffn);
  const timeMid = Number((time >> 32n) & 0xffffn);
  const timeHigh = Number((time >> 48n) & 0x0fffn);

  bytes[0] = (timeLow >>> 24) & 0xff;
  bytes[1] = (timeLow >>> 16) & 0xff;
  bytes[2] = (timeLow >>> 8) & 0xff;
  bytes[3] = timeLow & 0xff;
  bytes[4] = (timeMid >>> 8) & 0xff;
  bytes[5] = timeMid & 0xff;
  bytes[6] = ((timeHigh >>> 8) & 0x0f) | 0x10;
  bytes[7] = timeHigh & 0xff;
  bytes[8] = (v1Clock[0]! & 0x3f) | 0x80;
  bytes[9] = v1Clock[1]!;
  bytes.set(v1Node, 10);
  return bytesToUuid(bytes);
}

function nameBased(namespace: string, name: string, version: 3 | 5): string {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const digest = version === 3 ? md5(input) : sha1(input);
  return bytesToUuid(stamp(digest.slice(0, 16), version));
}

/** MD5-based, deterministic for a given namespace and name. */
export function v3(namespace: string, name: string): string {
  return nameBased(resolveNamespace(namespace), name, 3);
}

/** SHA-1-based, deterministic for a given namespace and name. Prefer this over v3. */
export function v5(namespace: string, name: string): string {
  return nameBased(resolveNamespace(namespace), name, 5);
}

export function resolveNamespace(nameOrUuid: string): string {
  const key = nameOrUuid.toLowerCase() as NamespaceName;
  if (key in NAMESPACES) return NAMESPACES[key];
  return nameOrUuid;
}

export interface ParsedUuid {
  input: string;
  canonical: string;
  valid: boolean;
  /** Version nibble. 0 for nil, 15 for max, null when the value is not a UUID. */
  version: number | null;
  /** Human name for the variant field. */
  variant: string;
  isNil: boolean;
  isMax: boolean;
  /** Present for v1 and v7, which embed a timestamp. */
  timestamp?: { iso: string; ms: number };
  /** Present for v1. */
  clockSequence?: number;
  /** Present for v1. True when the node id is random rather than a real MAC. */
  nodeIsRandom?: boolean;
  node?: string;
  hex: string;
  urn: string;
  base64url: string;
  problems: string[];
}

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parse(input: string): ParsedUuid {
  const problems: string[] = [];
  const trimmed = input
    .trim()
    .replace(/^urn:uuid:/i, '')
    .replace(/^\{|\}$/g, '');
  const canonical = trimmed.toLowerCase();

  if (!CANONICAL.test(canonical)) {
    const stripped = canonical.replace(/-/g, '');
    if (/^[0-9a-f]{32}$/.test(stripped)) {
      problems.push('Hyphens are missing or misplaced. The canonical form is 8-4-4-4-12.');
    } else {
      return {
        input,
        canonical: '',
        valid: false,
        version: null,
        variant: 'not a UUID',
        isNil: false,
        isMax: false,
        hex: '',
        urn: '',
        base64url: '',
        problems: ['This is not a UUID: it needs 32 hexadecimal digits.'],
      };
    }
  }

  const bytes = uuidToBytes(canonical);
  const normalised = bytesToUuid(bytes);
  const isNil = normalised === NIL_UUID;
  const isMax = normalised === MAX_UUID;
  const version = (bytes[6]! & 0xf0) >> 4;

  const variantByte = bytes[8]!;
  let variant: string;
  if (isNil) variant = 'nil';
  else if (isMax) variant = 'max';
  else if ((variantByte & 0x80) === 0x00) variant = 'reserved, NCS backward compatibility';
  else if ((variantByte & 0xc0) === 0x80) variant = 'RFC 9562 (the normal one)';
  else if ((variantByte & 0xe0) === 0xc0) variant = 'reserved, Microsoft backward compatibility';
  else variant = 'reserved for future definition';

  const result: ParsedUuid = {
    input,
    canonical: normalised,
    valid: true,
    version: isNil || isMax ? null : version,
    variant,
    isNil,
    isMax,
    hex: normalised.replace(/-/g, ''),
    urn: `urn:uuid:${normalised}`,
    base64url: bytesToBase64Url(bytes),
    problems,
  };

  if (!isNil && !isMax) {
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version)) {
      problems.push(`Version ${version} is not one this specification defines.`);
    }
    if ((variantByte & 0xc0) !== 0x80) {
      problems.push(
        'The variant bits are not the RFC 9562 ones, so this was probably not generated by a compliant library.',
      );
    }
  }

  if (version === 1) {
    const timeLow = ((bytes[0]! << 24) >>> 0) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
    const timeMid = (bytes[4]! << 8) | bytes[5]!;
    const timeHigh = ((bytes[6]! & 0x0f) << 8) | bytes[7]!;
    const time = (BigInt(timeHigh) << 48n) | (BigInt(timeMid) << 32n) | BigInt(timeLow >>> 0);
    const ms = Number((time - GREGORIAN_OFFSET_100NS) / 10000n);
    result.timestamp = { ms, iso: new Date(ms).toISOString() };
    result.clockSequence = ((bytes[8]! & 0x3f) << 8) | bytes[9]!;
    result.nodeIsRandom = (bytes[10]! & 0x01) === 1;
    result.node = Array.from(bytes.slice(10))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':');
  }

  if (version === 7) {
    let ms = 0;
    for (let i = 0; i < 6; i++) ms = ms * 256 + bytes[i]!;
    result.timestamp = { ms, iso: new Date(ms).toISOString() };
  }

  return result;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alpha[b0 >> 2];
    if (b1 === undefined) {
      out += alpha[(b0 & 3) << 4];
      break;
    }
    out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += alpha[(b1 & 15) << 2];
      break;
    }
    out += alpha[((b1 & 15) << 2) | (b2 >> 6)]! + alpha[b2 & 63]!;
  }
  return out;
}

export function isValid(input: string, version?: UuidVersion): boolean {
  const parsed = parse(input);
  if (!parsed.valid || parsed.problems.length > 0) return false;
  return version === undefined || parsed.version === version;
}

export interface GenerateOptions {
  version: UuidVersion;
  count?: number;
  namespace?: string;
  name?: string;
  uppercase?: boolean;
  braces?: boolean;
  urn?: boolean;
  hyphens?: boolean;
}

export function generate(options: GenerateOptions): string[] {
  const { version, count = 1, namespace = NAMESPACES.dns, name = '', uppercase, braces, urn, hyphens = true } = options;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let value: string;
    switch (version) {
      case 1:
        value = v1();
        break;
      case 3:
        value = v3(namespace, name);
        break;
      case 4:
        value = v4();
        break;
      case 5:
        value = v5(namespace, name);
        break;
      case 7:
        value = v7();
        break;
      default:
        throw new Error(`Unsupported version: ${String(version)}`);
    }
    if (!hyphens) value = value.replace(/-/g, '');
    if (uppercase) value = value.toUpperCase();
    if (urn) value = `urn:uuid:${value}`;
    else if (braces) value = `{${value}}`;
    out.push(value);
  }
  return out;
}
