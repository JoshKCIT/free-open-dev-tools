# UUID Generator & Parser

Generate and decode UUIDs (v1, v3, v4, v5 and v7), ULIDs, NanoIDs, KSUIDs, Snowflake IDs and ObjectIds, with the times they carry.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates UUIDs of every version that RFC 9562 still defines, and also ULIDs, NanoIDs, KSUIDs, Snowflake IDs and MongoDB ObjectIds. Inspect takes any of them apart and shows the time it carries and its other fields: a UUID's version, variant and timestamp, a ULID's millisecond time and random part, a KSUID's timestamp and payload, an ObjectId's time, random value and counter, and a Snowflake ID's time, datacenter, worker and sequence for the epoch you type. Random values come from the browser cryptographic source, never from Math.random, and nothing you type leaves your browser.

## Supported

- Version 4, random, the usual default
- Version 7, time-ordered, which sorts by creation time and is the better choice for database keys
- Version 1, time-based, with a random node identifier as RFC 9562 permits
- Versions 3 and 5, deterministic from a namespace and a name, with the four standard namespaces built in
- The nil and max UUIDs
- Parsing: version, variant, embedded timestamp, clock sequence, node id, and the hex, URN and Base64url forms
- Bulk generation, uppercase, no hyphens, braces and URN formatting
- ULIDs: 26 characters of Crockford base32 that sort by time, in monotonic order within a millisecond
- NanoIDs of 1 to 255 characters, from the 64 character URL-safe alphabet or from an alphabet you type
- KSUIDs: 27 characters of base62 with a one-second timestamp and 16 random bytes
- Snowflake IDs: 64-bit numbers with 41 bits of milliseconds since an epoch you choose, 5 datacenter bits, 5 worker bits and a 12-bit sequence
- MongoDB ObjectIds: 24 hexadecimal digits with a one-second timestamp, a 5-byte random value and a 3-byte counter
- Inspect: after the UUID parse fails, a pasted ULID, KSUID, ObjectId or Snowflake ID is recognised by its length and characters and shown with its time and fields

## Limits

- Version 1 uses a random node identifier with the multicast bit set, not your network card address. A browser cannot read a MAC address, and publishing one would leak a hardware identifier.
- Version 2, the DCE security variant, is not generated. It is effectively unused and RFC 9562 does not specify it.
- Versions 6 and 8 are recognised when parsing but not generated. Version 7 covers what version 6 was for.
- A version 1 or version 7 UUID reveals roughly when it was created. If that matters for your data, use version 4.
- Version 3 uses MD5, which is broken. It exists for compatibility with systems that already use it; choose version 5 for anything new.
- Version 1 can produce at most 10,000 ids per millisecond before the sub-millisecond tick field wraps. Bulk generation past that rate should use version 7.
- ULIDs made in the same millisecond count up from the first one, as the ULID specification describes for monotonic order; more than 2^80 in one millisecond is refused.
- KSUID times have one-second resolution and ObjectId times one second; a ULID or Snowflake time has one millisecond.
- Snowflake ids use 41 bits of milliseconds since the chosen epoch, 5 datacenter bits, 5 worker bits and a 12-bit sequence; more than 4,096 ids in one millisecond move to the next millisecond.
- NanoID alphabets hold 2 to 255 distinct characters and sizes run from 1 to 255; letters are drawn with rejection sampling so no character is favoured.
- ULID, KSUID, ObjectId and Snowflake ids reveal roughly when they were made, like UUID versions 1 and 7.
- At most 10,000 ids are made at a time, whatever the format.
- Uppercase, hyphens and wrapping apply only to UUID versions; the other formats are written in their own published form.

## Ambiguous cases, and what this does about them

- A UUID with unexpected variant bits is still 32 hex digits and many tools accept it silently. This one parses it, names the variant and says plainly that it was probably not produced by a compliant library.
- Version 1 timestamps count 100-nanosecond intervals from 1582-10-15, so the millisecond precision shown is the best a JavaScript date can express.
- A Snowflake ID carries no epoch, so the time Inspect shows is right only for the epoch you type. The default, 1288834974657 (2010-11-04T01:42:54.657Z), is the reference epoch of the published layout; ids made with another epoch show a wrong date until you type theirs. Any whole number of up to 19 digits can be read as a Snowflake ID.
- A KSUID counts its seconds from 2014-05-13T16:53:20Z, not from 1970, so the stored timestamp is 1400000000 smaller than a Unix time; both are shown.
- The five middle bytes of an ObjectId are random per page load, not per id, and its last three bytes are a counter that starts at a random value; only the first four bytes are a time.
- A ULID is 26 characters of 5 bits each, which is 130 bits, so its first character can only be 0 to 7; text starting with anything higher is refused when decoding. Letter case does not matter when reading a ULID.
- The NanoID library accepts alphabets of 1 to 256 symbols; this page takes 2 to 255 different characters, because one symbol has nothing random in it, and refuses control and direction characters so the ids stay readable.
- Inspect tries the UUID parse first and only then the other shapes, by length: 26 characters for a ULID, 27 for a KSUID, 24 hexadecimal digits for an ObjectId and 1 to 19 digits for a Snowflake ID.

## Defined by

- [RFC 9562 — Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562)
- [RFC 9562 appendix A — worked examples and test vectors](https://www.rfc-editor.org/rfc/rfc9562#name-test-vectors)
- [ULID specification](https://github.com/ulid/spec)
- [KSUID reference implementation and README](https://github.com/segmentio/ksuid)
- [MongoDB ObjectId reference page](https://www.mongodb.com/docs/manual/reference/method/ObjectId/)
- [NanoID library README](https://github.com/ai/nanoid)
- [Snowflake ID layout (Wikipedia)](https://en.wikipedia.org/wiki/Snowflake_ID)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/uuid uuid
cd uuid
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/uuid
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { v4, v7, v5, parse, isValid, NAMESPACES } from '@fodt/uuid';

v4();                                  // random
v7();                                  // time-ordered, sorts by creation
v5('dns', 'www.example.com');          // deterministic
parse('2ed6657d-e927-568b-95e1-2665a8aea6a2');
isValid(someString, 4);

import { generateUlids, decodeUlid, generateNanoIds, decodeSnowflake, detectIdentifier } from '@fodt/uuid';

generateUlids(3);                                // three ULIDs, counting up inside one millisecond
decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV').iso;    // '2016-07-30T23:54:10.259Z'
generateNanoIds({ count: 1, size: 12 });
decodeSnowflake('1888944671579078978', 1288834974657).iso;   // '2025-02-10T13:34:39.256Z'
detectIdentifier(text, 1288834974657);           // a ULID, KSUID, ObjectId or Snowflake ID by shape, or null
```

`parse` never throws: it returns a report with `valid` and a `problems` list, so a malformed id can be explained rather than rejected. `generate` is the batch entry point the web page uses for UUIDs; it still refuses anything that is not a UUID version. The other formats are separate functions: `generateUlids`, `generateNanoIds`, `generateKsuids`, `generateSnowflakes` and `generateObjectIds`, with `decodeUlid`, `decodeKsuid`, `decodeObjectId` and `decodeSnowflake`. They throw `IdentifierError` with a fixed sentence that names the format and the rule and never repeats the text given. The generators that read the clock take it as an optional last argument (`now`, milliseconds) so a test can freeze it.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

The version 3 and version 5 worked examples from RFC 9562 appendix A are asserted exactly. Beyond those: version and variant nibbles across many samples, version 7 lexicographic ordering and timestamp round trip, version 1 uniqueness inside a single millisecond, parsing of the URN and brace forms, rejection of non-RFC variants, 5000 generated ids with no duplicates, and a loose distribution check that would catch a constant or unseeded generator. The other formats are checked against published values: the ULID specification's example and largest value, the four KSUID README examples and its two inspect examples, the MongoDB reference page's example ids and the Snowflake layout's worked example. The KSUID and NanoID upstream files are copied byte for byte under test/fixtures with their licence and recorded hashes that a test checks. Also asserted: round trips of every format, monotonic ULID order, a 4,096-id spill into the next millisecond, rejection sampling over every NanoID alphabet size from 2 to 255, a spy showing the browser cryptographic source is the only source of randomness, and the fixed refusal sentences.

## Licence

MIT. See [LICENSE](./LICENSE).
