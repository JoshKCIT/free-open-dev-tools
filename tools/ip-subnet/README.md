# IP Subnet & CIDR Calculator

Calculate IPv4 and IPv6 network details, split subnets, and summarise ranges to CIDR.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Works out everything about a network block: the network and broadcast addresses, the mask and wildcard, the usable host range, and how many addresses it holds. It handles IPv6 with the same arithmetic as IPv4 by doing all of it in arbitrary precision integers, and it names the reserved blocks so you can tell at a glance whether an address is private, documentation or genuinely routable.

## Supported

- IPv4 and IPv6, with prefix lengths from /0 to /32 and /0 to /128
- Network, broadcast, first and last host, mask, wildcard mask and binary views
- A dotted subnet mask such as 255.255.255.0 in place of a prefix length
- RFC 5952 canonical IPv6 formatting, plus the fully expanded form
- Embedded IPv4 addresses, zone indexes and bracketed IPv6 notation on input
- Splitting a block into equal subnets of a longer prefix
- Converting an arbitrary address range into the fewest CIDR blocks that cover it exactly
- Summarising a list of blocks by merging adjacent and overlapping ones
- Naming reserved and special-purpose ranges from the RFC 6890 registries
- Reverse DNS names, in-addr.arpa and ip6.arpa
- Generating random addresses inside a block

## Limits

- This is arithmetic, not a network query. It never looks up who owns an address, whether a host is reachable, or what a name resolves to. Those all need a server.
- The list of special-purpose ranges is a fixed copy of the well-known registries. It covers the blocks that matter day to day, not every entry IANA has ever recorded, and registries do change.
- Splitting shows at most a thousand subnets at a time. The total count is always reported in full.
- IPv6 zone indexes such as %eth0 identify a local interface and are stripped, because they are not part of the address.

## Ambiguous cases, and what this does about them

- A /31 has no broadcast address and both of its addresses are usable, as RFC 3021 defines for point-to-point links. Applying the usual subtract-two rule makes a working link look unusable, so /31 and /32 are handled as their own cases.
- An IPv4 octet with a leading zero, such as 192.168.01.1, is read as decimal by some libraries and octal by others. That disagreement has been used to slip past address filters, so it is refused rather than guessed at.
- An address given without a prefix is treated as a single host, /32 or /128, rather than assumed to be a classful network.

## Defined by

- [RFC 4632 — Classless Inter-domain Routing (CIDR)](https://www.rfc-editor.org/rfc/rfc4632)
- [RFC 4291 — IP Version 6 Addressing Architecture](https://www.rfc-editor.org/rfc/rfc4291)
- [RFC 5952 — A Recommendation for IPv6 Address Text Representation](https://www.rfc-editor.org/rfc/rfc5952)
- [RFC 3021 — Using 31-Bit Prefixes on IPv4 Point-to-Point Links](https://www.rfc-editor.org/rfc/rfc3021)
- [RFC 1918 — Address Allocation for Private Internets](https://www.rfc-editor.org/rfc/rfc1918)
- [RFC 6890 — Special-Purpose IP Address Registries](https://www.rfc-editor.org/rfc/rfc6890)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/ip-subnet ip-subnet
cd ip-subnet
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/ip-subnet
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { describe, contains, split, rangeToCidrs, summarise } from '@fodt/ip-subnet';

describe('192.168.1.130/26');
// network 192.168.1.128, broadcast 192.168.1.191, 62 usable hosts

contains('10.0.0.0/8', '10.1.2.3');        // true
split('192.168.1.0/24', 26);               // four /26 blocks
rangeToCidrs('192.168.1.1', '192.168.1.6');
summarise(['192.168.0.0/25', '192.168.0.128/25']);  // ['192.168.0.0/24']
```

All arithmetic uses `bigint`, so IPv6 is handled exactly rather than approximately, and counts such as the size of a /64 are returned as strings to avoid losing precision. Parsing throws `IpError` with a message that says what was wrong with the address.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Covers RFC 5952 formatting rules including the single-zero-group exception, the RFC 3021 /31 case, /0 and /32 and /128 edges, dotted masks and masks with gaps, leading-zero octets, the RFC 1918 and RFC 6890 special ranges including the 172.16.0.0/12 boundary, and a property check that the blocks produced by rangeToCidrs cover exactly the requested range and no more.

## Licence

MIT. See [LICENSE](./LICENSE).
