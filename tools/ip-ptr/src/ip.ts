/**
 * Address parsing and reverse-name arithmetic.
 *
 * The dotted-quad and hextet arithmetic below follows RFC 791 (IPv4 dotted
 * decimal), RFC 4291 section 2.2 (the three conventional IPv6 text forms)
 * and RFC 5952 (the recommended canonical text form for an IPv6 address).
 * Every function here is copied byte for byte from an already-proven,
 * already-tested implementation elsewhere in this project (D-23: copy,
 * never import, across tool packages) -- see this plan's own SUMMARY for
 * exactly where it was copied from and the line range copied.
 */

export type IpVersion = 4 | 6;

export interface IpAddress {
  version: IpVersion;
  /** Numeric value. IPv6 needs a BigInt, so IPv4 uses one too for consistency. */
  value: bigint;
  text: string;
}

export class IpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpError';
  }
}

// ---------------------------------------------------------------- parsing

export function parseIpv4(text: string): bigint {
  const parts = text.trim().split('.');
  if (parts.length !== 4)
    throw new IpError(`An IPv4 address has four parts separated by dots. "${text}" has ${parts.length}.`);
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      throw new IpError(
        `"${part}" is not a number between 0 and 255. Leading zeros are rejected because some systems read them as octal.`,
      );
    }
    if (part.length > 1 && part.startsWith('0')) {
      throw new IpError(
        `"${part}" has a leading zero. Some libraries read that as octal, so it is refused rather than guessed at.`,
      );
    }
    const n = Number(part);
    if (n > 255) throw new IpError(`"${part}" is greater than 255.`);
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

export function parseIpv6(text: string): bigint {
  let input = text.trim();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  // A zone index identifies a local interface and is not part of the address.
  const zoneAt = input.indexOf('%');
  if (zoneAt !== -1) input = input.slice(0, zoneAt);

  // An embedded IPv4 tail, as in ::ffff:192.0.2.1, becomes two hex groups.
  const v4Match = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(input);
  if (v4Match) {
    const v4 = parseIpv4(v4Match[1]!);
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    input = input.slice(0, v4Match.index + 1) + high.toString(16) + ':' + low.toString(16);
  }

  const doubleColon = input.indexOf('::');
  if (input.indexOf('::', doubleColon + 1) !== -1) {
    throw new IpError('An IPv6 address may contain "::" at most once, because two of them would be ambiguous.');
  }

  let groups: string[];
  if (doubleColon === -1) {
    groups = input.split(':');
    if (groups.length !== 8) {
      throw new IpError(`An IPv6 address without "::" needs exactly eight groups. "${text}" has ${groups.length}.`);
    }
  } else {
    const head = input
      .slice(0, doubleColon)
      .split(':')
      .filter((g) => g !== '');
    const tail = input
      .slice(doubleColon + 2)
      .split(':')
      .filter((g) => g !== '');
    const missing = 8 - head.length - tail.length;
    if (missing < 0) throw new IpError('Too many groups for an address that also uses "::".');
    if (missing === 0) {
      throw new IpError('"::" must stand for at least one group of zeros. This address already has eight groups.');
    }
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      throw new IpError(`"${group}" is not a group of one to four hexadecimal digits.`);
    }
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

export function parseAddress(text: string): IpAddress {
  const trimmed = text.trim();
  if (trimmed === '') throw new IpError('No address given.');
  if (trimmed.includes(':')) return { version: 6, value: parseIpv6(trimmed), text: trimmed };
  return { version: 4, value: parseIpv4(trimmed), text: trimmed };
}

// ---------------------------------------------------------------- formatting

export function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join('.');
}

/** Full form, eight groups of four digits, no compression. */
export function expandIpv6(value: bigint): string {
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16).padStart(4, '0'));
  }
  return groups.join(':');
}

/** RFC 5952 canonical form: lowercase, no leading zeros, longest zero run compressed. */
export function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));

  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (start === -1) start = i;
      length++;
      if (length > bestLength) {
        bestLength = length;
        bestStart = start;
      }
    } else {
      start = -1;
      length = 0;
    }
  }

  const text = groups.map((g) => g.toString(16));
  // RFC 5952 section 4.2.2: a single zero group is not compressed.
  if (bestLength < 2) return text.join(':');

  const head = text.slice(0, bestStart).join(':');
  const tail = text.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/** The reverse DNS name for an address, which is what a PTR record is filed under. */
export function arpaName(value: bigint, version: IpVersion): string {
  if (version === 4) {
    return formatIpv4(value).split('.').reverse().join('.') + '.in-addr.arpa';
  }
  return expandIpv6(value).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
}
