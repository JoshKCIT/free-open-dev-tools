# IP to PTR Record

Build in-addr.arpa and ip6.arpa reverse DNS names from an address.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns IPv4 and IPv6 addresses, one per line, into their reverse DNS names exactly as RFC 1035 and RFC 3596 define them, and turns a block on a whole octet or nibble boundary into its reverse zone name. When a host name is given, each address row also gets an RFC 1035 master-file PTR record line pointing at it, ready to paste into a zone file.

## Supported

- Building the in-addr.arpa reverse name for an IPv4 address, reversing its four octets
- Building the ip6.arpa reverse name for an IPv6 address, reversing all 32 nibbles
- Accepting every RFC 4291 text form of an IPv6 address (full, compressed with double colon, and mixed with an embedded IPv4 tail) and reading them as the same address
- Showing every parsed address in the RFC 5952 recommended canonical text form
- Building the reverse zone name for a CIDR block that lands on a whole octet boundary (IPv4, prefix 0, 8, 16 or 24) or a whole nibble boundary (IPv6, prefix a multiple of 4)
- Building an RFC 1035 section 5.1 master-file PTR record line for each address, with an optional TTL, once a host name is given
- Noting the embedded IPv4 address's own reverse name for an IPv4-mapped IPv6 address
- Converting up to 10,000 lines in one paste, reporting a malformed or unsupported line by its number while the rest still convert

## Limits

- This cannot query a name server, so it cannot say whether a PTR record for an address is actually published anywhere or whether a forward name resolves back to it -- that needs a real request to a server
- A CIDR block whose prefix does not land on a whole octet (IPv4) or nibble (IPv6) boundary is refused: classless reverse delegation inside an octet uses the scheme RFC 2317 defines, which this does not generate
- A zone index such as %eth0 identifies a local network interface, not a globally meaningful address, so a line carrying one is reported and skipped rather than guessed at

## Ambiguous cases, and what this does about them

- Every name below is written in lower case; RFC 1035 and RFC 3596 print IN-ADDR.ARPA and IP6.ARPA in capitals in their own examples, but DNS names compare case-insensitively (RFC 4343), so this makes no difference to what a name server sees
- An IPv4-mapped IPv6 address's embedded IPv4 address gets its own reverse name too, delivered as an extra entry alongside the line's other problems rather than as a new field, since it is worth knowing but is not itself a fault with the input line

## Defined by

- [RFC 1035 -- Domain Names, section 3.5 (the IN-ADDR.ARPA domain)](https://www.rfc-editor.org/rfc/rfc1035)
- [RFC 1035 -- Domain Names, section 5.1 (master file format)](https://www.rfc-editor.org/rfc/rfc1035)
- [RFC 3596 -- DNS Extensions to Support IP Version 6, section 2.5 (the IP6.ARPA domain)](https://www.rfc-editor.org/rfc/rfc3596)
- [RFC 4291 -- IP Version 6 Addressing Architecture, section 2.2 (text representation of addresses)](https://www.rfc-editor.org/rfc/rfc4291)
- [RFC 5952 -- A Recommendation for IPv6 Address Text Representation](https://www.rfc-editor.org/rfc/rfc5952)
- [RFC 1123 -- Requirements for Internet Hosts, section 2.1 (host name syntax)](https://www.rfc-editor.org/rfc/rfc1123)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/ip-ptr ip-ptr
cd ip-ptr
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/ip-ptr
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { ptrNames } from '@fodt/ip-ptr';

ptrNames('192.0.2.1\n2001:db8::1', { hostname: 'host.example.com', ttl: 3600 });
```

`ptrNames(input, { hostname, ttl })` reads one non-empty line at a time (CRLF, LF or CR). A line holding a plain address gets a `reverseName`; a line holding a CIDR block gets a `zone` when its prefix lands on a whole octet or nibble boundary. `hostname`, when given, must be an RFC 1123 host name or the call throws `IpPtrError` before any row is built. `ttl` below 0 is clamped to 0 and noted in `problems` under line 0, meaning the whole run rather than one line. A malformed or unsupported line becomes a `problems` entry naming its own 1-based line number; the rest of the input still converts.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The RFC 1035 section 3.5 and RFC 3596 section 2.5 worked examples are asserted against the RFC text vendored into this folder's own test fixtures, not transcribed from memory. The copied address arithmetic in ip.ts is proven byte-identical to the already-tested implementation it was copied from.

## Licence

MIT. See [LICENSE](./LICENSE).
