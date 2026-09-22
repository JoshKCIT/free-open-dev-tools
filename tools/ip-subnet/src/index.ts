import meta from './meta.json';

export { meta };

export type IpVersion = 4 | 6;

export interface IpAddress {
  version: IpVersion;
  /** Numeric value. IPv6 needs a BigInt, so IPv4 uses one too for consistency. */
  value: bigint;
  text: string;
}

export interface Network {
  version: IpVersion;
  prefix: number;
  networkValue: bigint;
  /** Total addresses in the block, including network and broadcast for IPv4. */
  size: bigint;
}

export class IpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpError';
  }
}

const V4_BITS = 32;
const V6_BITS = 128;
const bits = (v: IpVersion) => (v === 4 ? V4_BITS : V6_BITS);

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

export function formatAddress(value: bigint, version: IpVersion): string {
  return version === 4 ? formatIpv4(value) : formatIpv6(value);
}

// ---------------------------------------------------------------- networks

export function parseCidr(text: string): Network & { address: bigint } {
  const trimmed = text.trim();
  const slash = trimmed.lastIndexOf('/');
  const addressText = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const address = parseAddress(addressText);
  const max = bits(address.version);

  let prefix: number;
  if (slash === -1) {
    prefix = max;
  } else {
    const prefixText = trimmed.slice(slash + 1).trim();
    // A dotted mask such as 255.255.255.0 is accepted for IPv4.
    if (address.version === 4 && prefixText.includes('.')) {
      prefix = maskToPrefix(parseIpv4(prefixText));
    } else {
      if (!/^\d+$/.test(prefixText)) throw new IpError(`"${prefixText}" is not a prefix length.`);
      prefix = Number(prefixText);
    }
  }

  if (prefix < 0 || prefix > max) {
    throw new IpError(`A prefix for IPv${address.version} must be between 0 and ${max}. Got ${prefix}.`);
  }

  const networkValue = address.value & maskValue(prefix, address.version);
  return {
    version: address.version,
    prefix,
    networkValue,
    address: address.value,
    size: 1n << BigInt(max - prefix),
  };
}

export function maskValue(prefix: number, version: IpVersion): bigint {
  const max = BigInt(bits(version));
  if (prefix === 0) return 0n;
  return ((1n << BigInt(prefix)) - 1n) << (max - BigInt(prefix));
}

export function maskToPrefix(mask: bigint, version: IpVersion = 4): number {
  const max = bits(version);
  const binary = mask.toString(2).padStart(max, '0');
  const match = /^(1*)(0*)$/.exec(binary);
  if (!match) {
    throw new IpError(
      'A subnet mask must be a run of ones followed by a run of zeros. This one has ones after a zero.',
    );
  }
  return match[1]!.length;
}

export interface SubnetReport {
  version: IpVersion;
  cidr: string;
  inputAddress: string;
  network: string;
  prefix: number;
  mask: string;
  wildcard: string;
  broadcast?: string;
  firstHost?: string;
  lastHost?: string;
  firstAddress: string;
  lastAddress: string;
  totalAddresses: string;
  usableHosts: string;
  /** True when the address given was not the network address of its block. */
  addressIsNotNetwork: boolean;
  binaryNetwork: string;
  binaryMask: string;
  scope: string[];
  expanded?: string;
  arpa: string;
}

/** RFC 6890 and friends: the blocks with a meaning beyond ordinary routing. */
const SPECIAL_V4: [string, string][] = [
  ['0.0.0.0/8', 'This network (RFC 1122). Valid only as a source address.'],
  ['10.0.0.0/8', 'Private use (RFC 1918). Not routed on the public internet.'],
  ['100.64.0.0/10', 'Carrier-grade NAT shared address space (RFC 6598).'],
  ['127.0.0.0/8', 'Loopback (RFC 1122). Never leaves the host.'],
  ['169.254.0.0/16', 'Link-local, self-assigned when DHCP fails (RFC 3927).'],
  ['172.16.0.0/12', 'Private use (RFC 1918). Not routed on the public internet.'],
  ['192.0.0.0/24', 'IETF protocol assignments (RFC 6890).'],
  ['192.0.2.0/24', 'Documentation, TEST-NET-1 (RFC 5737). Safe to use in examples.'],
  ['192.88.99.0/24', 'Deprecated 6to4 relay anycast (RFC 7526).'],
  ['192.168.0.0/16', 'Private use (RFC 1918). Not routed on the public internet.'],
  ['198.18.0.0/15', 'Benchmark testing (RFC 2544).'],
  ['198.51.100.0/24', 'Documentation, TEST-NET-2 (RFC 5737). Safe to use in examples.'],
  ['203.0.113.0/24', 'Documentation, TEST-NET-3 (RFC 5737). Safe to use in examples.'],
  ['224.0.0.0/4', 'Multicast (RFC 5771).'],
  ['240.0.0.0/4', 'Reserved for future use (RFC 1112).'],
  ['255.255.255.255/32', 'Limited broadcast (RFC 8190).'],
];

const SPECIAL_V6: [string, string][] = [
  ['::/128', 'Unspecified address (RFC 4291).'],
  ['::1/128', 'Loopback (RFC 4291). Never leaves the host.'],
  ['::ffff:0:0/96', 'IPv4-mapped IPv6 address (RFC 4291).'],
  ['64:ff9b::/96', 'IPv4-IPv6 translation (RFC 6052).'],
  ['100::/64', 'Discard-only address block (RFC 6666).'],
  ['2001:db8::/32', 'Documentation (RFC 3849). Safe to use in examples.'],
  ['2001::/32', 'Teredo tunnelling (RFC 4380).'],
  ['2002::/16', 'Deprecated 6to4 (RFC 7526).'],
  ['fc00::/7', 'Unique local address (RFC 4193). The IPv6 equivalent of RFC 1918.'],
  ['fe80::/10', 'Link-local (RFC 4291). Valid only on one link.'],
  ['ff00::/8', 'Multicast (RFC 4291).'],
];

export function classify(value: bigint, version: IpVersion): string[] {
  const table = version === 4 ? SPECIAL_V4 : SPECIAL_V6;
  const out: string[] = [];
  for (const [cidr, description] of table) {
    const net = parseCidr(cidr);
    if ((value & maskValue(net.prefix, version)) === net.networkValue) out.push(description);
  }
  if (out.length === 0)
    out.push('Globally routable unicast address, as far as the reserved-block registries are concerned.');
  return out;
}

function toBinary(value: bigint, version: IpVersion): string {
  const max = bits(version);
  const binary = value.toString(2).padStart(max, '0');
  return version === 4 ? binary.replace(/(.{8})(?=.)/g, '$1.') : binary.replace(/(.{16})(?=.)/g, '$1:');
}

/** The reverse DNS name for an address, which is what a PTR record is filed under. */
export function arpaName(value: bigint, version: IpVersion): string {
  if (version === 4) {
    return formatIpv4(value).split('.').reverse().join('.') + '.in-addr.arpa';
  }
  return expandIpv6(value).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
}

export function describe(cidrText: string): SubnetReport {
  const net = parseCidr(cidrText);
  const { version, prefix, networkValue, size } = net;
  const mask = maskValue(prefix, version);
  const max = BigInt(bits(version));
  const wildcard = ((1n << max) - 1n) ^ mask;
  const lastValue = networkValue + size - 1n;

  const report: SubnetReport = {
    version,
    cidr: `${formatAddress(networkValue, version)}/${prefix}`,
    inputAddress: formatAddress(net.address, version),
    network: formatAddress(networkValue, version),
    prefix,
    mask: formatAddress(mask, version),
    wildcard: formatAddress(wildcard, version),
    firstAddress: formatAddress(networkValue, version),
    lastAddress: formatAddress(lastValue, version),
    totalAddresses: size.toString(),
    usableHosts: size.toString(),
    addressIsNotNetwork: net.address !== networkValue,
    binaryNetwork: toBinary(networkValue, version),
    binaryMask: toBinary(mask, version),
    scope: classify(networkValue, version),
    arpa: arpaName(net.address, version),
  };

  if (version === 4) {
    report.broadcast = formatIpv4(lastValue);
    if (prefix <= 30) {
      // The network and broadcast addresses are not assignable to a host.
      report.firstHost = formatIpv4(networkValue + 1n);
      report.lastHost = formatIpv4(lastValue - 1n);
      report.usableHosts = (size - 2n).toString();
    } else if (prefix === 31) {
      // RFC 3021: a /31 is a point-to-point link with two usable addresses.
      report.firstHost = formatIpv4(networkValue);
      report.lastHost = formatIpv4(lastValue);
      report.usableHosts = '2';
    } else {
      report.firstHost = formatIpv4(networkValue);
      report.lastHost = formatIpv4(networkValue);
      report.usableHosts = '1';
    }
  } else {
    report.expanded = expandIpv6(networkValue);
    report.firstHost = formatIpv6(networkValue);
    report.lastHost = formatIpv6(lastValue);
  }

  return report;
}

export function contains(cidrText: string, addressText: string): boolean {
  const net = parseCidr(cidrText);
  const address = parseAddress(addressText);
  if (address.version !== net.version) return false;
  return (address.value & maskValue(net.prefix, net.version)) === net.networkValue;
}

export interface Subnet {
  cidr: string;
  network: string;
  lastAddress: string;
  size: string;
}

/** Splits a block into equal blocks of a longer prefix. */
export function split(
  cidrText: string,
  newPrefix: number,
  limit = 1024,
): { subnets: Subnet[]; truncated: boolean; total: string } {
  const net = parseCidr(cidrText);
  if (newPrefix < net.prefix) {
    throw new IpError(
      `/${newPrefix} is larger than the block you started with. Choose a prefix of /${net.prefix} or longer.`,
    );
  }
  if (newPrefix > bits(net.version)) {
    throw new IpError(`/${newPrefix} is longer than IPv${net.version} allows.`);
  }
  const count = 1n << BigInt(newPrefix - net.prefix);
  const step = 1n << BigInt(bits(net.version) - newPrefix);
  const subnets: Subnet[] = [];
  const shown = count > BigInt(limit) ? BigInt(limit) : count;
  for (let i = 0n; i < shown; i++) {
    const start = net.networkValue + i * step;
    subnets.push({
      cidr: `${formatAddress(start, net.version)}/${newPrefix}`,
      network: formatAddress(start, net.version),
      lastAddress: formatAddress(start + step - 1n, net.version),
      size: step.toString(),
    });
  }
  return { subnets, truncated: count > BigInt(limit), total: count.toString() };
}

/** The shortest list of CIDR blocks that covers exactly the given range. */
export function rangeToCidrs(startText: string, endText: string): string[] {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
  if (start.version !== end.version) throw new IpError('Both addresses must be the same IP version.');
  if (start.value > end.value) throw new IpError('The start address is after the end address.');

  const max = bits(start.version);
  const out: string[] = [];
  let current = start.value;

  while (current <= end.value) {
    // The largest block that starts here is limited by the alignment of the
    // start address and by how much of the range is left.
    let size = max;
    while (size > 0) {
      const candidate = 1n << BigInt(max - size + 1);
      if ((current & (candidate - 1n)) !== 0n) break;
      if (current + candidate - 1n > end.value) break;
      size--;
    }
    out.push(`${formatAddress(current, start.version)}/${size}`);
    current += 1n << BigInt(max - size);
    if (current === 0n) break; // wrapped past the end of the address space
  }
  return out;
}

/** Collapses overlapping and adjacent blocks into the smallest equivalent set. */
export function summarise(cidrs: string[]): string[] {
  if (cidrs.length === 0) return [];
  const nets = cidrs.map((c) => parseCidr(c));
  const version = nets[0]!.version;
  if (nets.some((n) => n.version !== version)) throw new IpError('All blocks must be the same IP version.');

  const ranges = nets
    .map((n) => ({ start: n.networkValue, end: n.networkValue + n.size - 1n }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const merged: { start: bigint; end: bigint }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1n) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }

  return merged.flatMap((r) => rangeToCidrs(formatAddress(r.start, version), formatAddress(r.end, version)));
}

/** Generates addresses inside a block, using the cryptographic random source. */
export function randomInBlock(cidrText: string, count: number): string[] {
  const net = parseCidr(cidrText);
  const out: string[] = [];
  const byteLength = bits(net.version) / 8;
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    let value = 0n;
    for (const b of bytes) value = (value << 8n) | BigInt(b);
    const host = value & ((1n << BigInt(bits(net.version) - net.prefix)) - 1n);
    out.push(formatAddress(net.networkValue + host, net.version));
  }
  return out;
}
