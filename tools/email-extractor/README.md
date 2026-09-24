# Pattern Extractor

Pull emails, URLs, IP addresses and phone numbers out of unstructured text.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Scans pasted text for emails, http(s) URLs, IPv4 and IPv6 addresses and phone numbers, and lists what it found with a count of how many times each appeared. Built for pulling contact details and addresses out of a log file or an email without sending that text anywhere.

## Supported

- RFC 5322 dot-atom email addresses, with trailing sentence punctuation stripped
- http and https RFC 3986 URLs, with a trailing period or an unbalanced closing bracket stripped, a balanced one kept
- IPv4 addresses (RFC 3986 dec-octet: no leading zeros, no octet above 255)
- IPv6 addresses in every RFC 4291 section 2.2 form, including :: compression and an embedded IPv4 tail
- International phone numbers with a leading + and common separators, 7 to 15 digits total (ITU-T E.164)
- Choosing which of the five kinds to look for
- Collapsing duplicate matches into one entry with a count, or listing every occurrence separately

## Limits

- Phone detection is a pattern for common international formats, not per-country validation: a match is not proof the number exists or is dialable.
- Email addresses using a quoted local part or an IP-literal domain (RFC 5322's other local-part and domain forms) are out of scope and never matched
- IPv6 zone identifiers (RFC 4007, the "%eth0" suffix) are out of scope; a zoned address is matched only up to the "%"
- A phone candidate is limited to one pair of parentheses; more than one pair is not extracted as a phone number

## Ambiguous cases, and what this does about them

- RFC 3986: a URL's balanced parentheses are kept, an unbalanced trailing one is stripped, which is looser than the grammar (any sub-delims character is technically legal unencoded) and stricter than real-world links that end mid-sentence with unusual punctuation
- RFC 3986/RFC 5322 dec-octet: a leading zero on an IPv4 octet is rejected rather than read as octal, since some libraries disagree on what a leading zero means
- ITU-T E.164: the 7-15 digit total and the three excluded date shapes (YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY) are this tool's own disambiguation rule, not part of the standard, which does not define how to tell a phone number apart from other digit strings in free text

## Defined by

- [RFC 5322 — Internet Message Format](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)
- [RFC 4291 — IP Version 6 Addressing Architecture](https://www.rfc-editor.org/rfc/rfc4291)
- [ITU-T E.164 — The international public telecommunication numbering plan](https://www.itu.int/rec/T-REC-E.164)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/email-extractor email-extractor
cd email-extractor
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/email-extractor
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { extractPatterns } from '@fodt/email-extractor';

extractPatterns('Mail ops@example.com from 192.0.2.10');
// [{ kind: 'email', value: 'ops@example.com', index: 5, count: 1 },
//  { kind: 'ipv4', value: '192.0.2.10', index: 26, count: 1 }]
```

`isIPv4` and `isIPv6` are exported separately from `extractPatterns` because this tool's own tests prove each address form in isolation, including the shapes that must be rejected (a time, a MAC address, an over-range octet), before trusting the combined scan built on top of them.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Each cited standard is tested directly: RFC 5322 section 3.2.3/3.4.1 for the email dot-atom grammar, RFC 3986 Appendix A for the URL character set and its balanced-parenthesis sub-delim, RFC 4291 section 2.2 for every IPv6 text form including embedded IPv4, and ITU-T E.164's 15-digit maximum for phone numbers. Tests also assert the negative cases each standard implies: an over-range or too-long IPv4, a time or a MAC address that is not IPv6, and a date string or an IPv4 address that is not a phone number.

## Licence

MIT. See [LICENSE](./LICENSE).
