import meta from './meta.json';
import { parseAddress, formatIpv4, formatIpv6, expandIpv6, arpaName, IpError, type IpVersion } from './ip';

export { meta };

export class IpPtrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpPtrError';
  }
}

export interface PtrRow {
  line: number;
  input: string;
  version: IpVersion;
  address: string;
  /** Set for a single-address line: the reverse DNS name from arpaName. */
  reverseName?: string;
  /** Set for a CIDR-block line: the reverse zone name for the whole block. */
  zone?: string;
}

export interface PtrProblem {
  /** 1-based line number, or 0 for a problem that applies to the whole run, not one line. */
  line: number;
  message: string;
}

export interface PtrNamesOptions {
  /** An RFC 1123 host name every address row's PTR record should point to. Empty means no records. */
  hostname?: string;
  /** TTL written into each record line when above 0. Negative values are clamped to 0. */
  ttl?: number;
}

export interface PtrNamesResult {
  rows: PtrRow[];
  records: string[];
  problems: PtrProblem[];
}

const MAX_LINES = 10000;
const HOST_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** RFC 1123 section 2.1 (amending RFC 952): LDH labels of 1 to 63 octets, 253 octets at most without the final dot, a trailing dot allowed. */
function isRfc1123Hostname(text: string): boolean {
  const withoutTrailingDot = text.endsWith('.') ? text.slice(0, -1) : text;
  if (withoutTrailingDot.length === 0 || withoutTrailingDot.length > 253) return false;
  const labels = withoutTrailingDot.split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63 && HOST_LABEL.test(label));
}

function normaliseHostname(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

function formatAddress(value: bigint, version: IpVersion): string {
  return version === 4 ? formatIpv4(value) : formatIpv6(value);
}

/**
 * ::ffff:0:0/96 (RFC 4291 section 2.5.5.2): an IPv4-mapped IPv6 address
 * carries its embedded IPv4 address in the low-order 32 bits.
 */
function embeddedIpv4(value: bigint, version: IpVersion): bigint | null {
  if (version !== 6) return null;
  if (value >> 32n !== 0xffffn) return null;
  return value & 0xffffffffn;
}

interface ParsedCidr {
  version: IpVersion;
  value: bigint;
  prefix: number;
}

function parseCidrText(text: string): ParsedCidr {
  const slash = text.lastIndexOf('/');
  const addressText = text.slice(0, slash);
  const prefixText = text.slice(slash + 1).trim();
  const addr = parseAddress(addressText);
  if (!/^\d+$/.test(prefixText)) throw new IpError(`"${prefixText}" is not a prefix length.`);
  const prefix = Number(prefixText);
  const max = addr.version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > max) {
    throw new IpError(`A prefix for IPv${addr.version} must be between 0 and ${max}. Got ${prefix}.`);
  }
  return { version: addr.version, value: addr.value, prefix };
}

function networkValue(value: bigint, prefix: number, version: IpVersion): bigint {
  const bits = version === 4 ? 32 : 128;
  if (prefix === 0) return 0n;
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return value & mask;
}

/** IPv4 in-addr.arpa zone: only whole-octet prefixes (0, 8, 16, 24) delegate cleanly. */
function zoneForIpv4(value: bigint, prefix: number): string | null {
  if (prefix !== 0 && prefix !== 8 && prefix !== 16 && prefix !== 24) return null;
  const octets = formatIpv4(value).split('.');
  const used = octets.slice(0, prefix / 8);
  return used.length === 0 ? 'in-addr.arpa' : `${used.slice().reverse().join('.')}.in-addr.arpa`;
}

/** IPv6 ip6.arpa zone: only whole-nibble prefixes (a multiple of 4) delegate cleanly. */
function zoneForIpv6(value: bigint, prefix: number): string | null {
  if (prefix % 4 !== 0) return null;
  const nibbles = expandIpv6(value).replace(/:/g, '').split('');
  const used = nibbles.slice(0, prefix / 4);
  return used.length === 0 ? 'ip6.arpa' : `${used.slice().reverse().join('.')}.ip6.arpa`;
}

/**
 * Turns addresses and CIDR blocks, one per line, into reverse DNS names,
 * reverse zones, and (when a host name is given) RFC 1035 section 5.1
 * master-file PTR record lines.
 */
export function ptrNames(input: string, options: PtrNamesOptions = {}): PtrNamesResult {
  const hostnameText = (options.hostname ?? '').trim();
  if (hostnameText !== '' && !isRfc1123Hostname(hostnameText)) {
    throw new IpPtrError(
      `"${hostnameText}" is not an RFC 1123 host name: it must be labels of 1 to 63 letters, digits or hyphens (never starting or ending with a hyphen), joined by dots, 253 octets at most, with an optional trailing dot.`,
    );
  }
  const normalisedHostname = hostnameText === '' ? '' : normaliseHostname(hostnameText);

  const problems: PtrProblem[] = [];
  let ttl = options.ttl ?? 0;
  if (ttl < 0) {
    problems.push({ line: 0, message: `The TTL ${ttl} is negative, so it was treated as 0.` });
    ttl = 0;
  }

  const lines = input.split(/\r\n|\r|\n/);
  if (lines.length > MAX_LINES) {
    throw new IpPtrError(
      `This input has more than ${MAX_LINES} lines, so it was refused rather than risk freezing the tab.`,
    );
  }

  const rows: PtrRow[] = [];
  const records: string[] = [];

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed === '') return;
    const line = index + 1;

    if (trimmed.includes('%')) {
      problems.push({
        line,
        message: `"${trimmed}" carries a zone index, which identifies a local interface, not a globally meaningful address, so it has no reverse name.`,
      });
      return;
    }

    try {
      if (trimmed.includes('/')) {
        const cidr = parseCidrText(trimmed);
        const network = networkValue(cidr.value, cidr.prefix, cidr.version);
        const zone = cidr.version === 4 ? zoneForIpv4(network, cidr.prefix) : zoneForIpv6(network, cidr.prefix);
        if (zone === null) {
          const boundary = cidr.version === 4 ? 'octet' : 'nibble';
          problems.push({
            line,
            message: `A /${cidr.prefix} block does not land on a whole ${boundary} boundary, so its reverse delegation would need the classless scheme RFC 2317 defines, which this tool does not generate.`,
          });
          return;
        }
        rows.push({
          line,
          input: trimmed,
          version: cidr.version,
          address: `${formatAddress(network, cidr.version)}/${cidr.prefix}`,
          zone,
        });
        return;
      }

      const addr = parseAddress(trimmed);
      const reverseName = arpaName(addr.value, addr.version);
      rows.push({
        line,
        input: trimmed,
        version: addr.version,
        address: formatAddress(addr.value, addr.version),
        reverseName,
      });

      if (normalisedHostname !== '') {
        const record =
          ttl > 0
            ? `${reverseName}. ${ttl} IN PTR ${normalisedHostname}`
            : `${reverseName}. IN PTR ${normalisedHostname}`;
        records.push(record);
      }

      const embedded = embeddedIpv4(addr.value, addr.version);
      if (embedded !== null) {
        problems.push({
          line,
          message: `This is an IPv4-mapped IPv6 address; its embedded IPv4 address ${formatIpv4(embedded)} has its own reverse name ${arpaName(embedded, 4)} as well.`,
        });
      }
    } catch (err) {
      const message = err instanceof IpError ? err.message : err instanceof Error ? err.message : String(err);
      problems.push({ line, message });
    }
  });

  return { rows, records, problems };
}
