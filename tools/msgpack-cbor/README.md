# MessagePack & CBOR Converter

Convert MessagePack and CBOR to JSON and back, from hex, Base64 or a file, with binary values and tags kept visible.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts MessagePack and CBOR to JSON and back, in your browser, from pasted hex or Base64 or from a file. JSON cannot hold binary data, tags, extension types, big integers or map keys that are not text, so each of those is written as an explicit marker such as $bytes or $bigint, and the same markers convert back to the same bytes. CBOR can also be shown as the diagnostic notation of RFC 8949, the text form that standard prints its own examples in. The codecs are this folder's own code, checked against the published test vectors of both formats.

## Supported

- CBOR as in RFC 8949: all major types, indefinite-length strings, arrays and maps, tags of any number, half, single and double precision floats and simple values
- MessagePack as in its specification: every format in the format table, extension types, and the timestamp extension in its 4, 8 and 12 byte layouts
- Hex (with or without spaces) or Base64 in, from pasted text or a file; hex or Base64 out
- CBOR as diagnostic notation (RFC 8949 section 8), for example {_ "a": 1, "b": [_ 2, 3]}
- JSON to MessagePack or CBOR, reading the markers listed under limits and writing the shortest form of every integer, float and length

## Limits

- Input up to 5 MiB; nesting deeper than 256 levels is refused with its byte offset.
- The JSON text is limited to 32 MiB (33,554,432 characters): a deeply nested value indents every line, so a value of a few million items inside a few hundred levels can pass it, and the conversion is then refused with a message (CBOR diagnostic notation does not indent).
- JSON cannot hold every MessagePack and CBOR value, so these markers are used both ways: $bigint, $bytes, $tag with $value, $ext with $hex, $timestamp, $map, $float, $undefined and $simple.
- JSON to CBOR or MessagePack uses preferred serialization (the shortest form), so an item first written in a longer form, such as an indefinite-length array or a float with more bytes than it needs, does not come back byte for byte; converting to JSON warns, with a count, when a bignum an integer holds, a float wider than its value needs, an indefinite-length array or map, or a timestamp in a longer layout than it needs would come back in another form.
- Unknown tags and extension types are shown, never dropped or interpreted.
- In JSON a number with a fraction or an exponent is a float and a number without either is an integer, of any size up to 20,000 digits.
- A CBOR bignum of more than 8,192 bytes is shown as a $tag over its bytes instead of as digits, which loses nothing.
- A NaN keeps its meaning but not its payload bits: it is written back as the standard quiet NaN, and a warning says when a payload was dropped.
- JSON nested deeper than 256 levels is refused with its line and column; a $map counts as three levels.

## Ambiguous cases, and what this does about them

- A CBOR map or MessagePack map is written as a JSON object only when every key is text, no key repeats and no key begins with a dollar sign; otherwise it is written as a $map list of key and value pairs, so no key is lost or mistaken for a marker
- CBOR bignums (tags 2 and 3) are written as $bigint with their decimal value, as RFC 8949 prints them, and come back as the shortest integer or bignum that holds the value
- An object whose keys look like a marker but do not fit it (a $bytes that is not Base64, for example) is written as an ordinary map, after a warning
- MessagePack timestamps keep seconds and nanoseconds separately, so a 12 byte timestamp reaches years far outside what a JavaScript date can hold
- Text strings must be valid UTF-8; a MessagePack or CBOR string that is not is refused with its byte offset

## Defined by

- [RFC 8949 Concise Binary Object Representation (CBOR)](https://www.rfc-editor.org/rfc/rfc8949)
- [MessagePack specification](https://github.com/msgpack/msgpack/blob/master/spec.md)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/msgpack-cbor msgpack-cbor
cd msgpack-cbor
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/msgpack-cbor
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convert } from '@fodt/msgpack-cbor';

const result = convert({
  format: 'cbor',
  direction: 'to-json',
  input: 'c249010000000000000000',
  inputEncoding: 'hex',
  outputEncoding: 'hex',
  show: 'json',
});
console.log(result.text);
// { "$bigint": "18446744073709551616" }
```

`convert(job)` takes the format (`msgpack` or `cbor`), the direction (`to-json` or `from-json`), the input as text or bytes, how text input is encoded (`hex` or `base64`), how bytes are written out (`hex` or `base64`) and, for CBOR, whether to show `json` or `diagnostic` notation. It returns the text, the bytes when the direction is from JSON, and any warnings. `readInputBytes(text, encoding)` reads hex (spaces and line breaks allowed) or Base64 and refuses a bad digit with its position. Every expected failure is a `MsgpackCborError` with a plain message, a byte `offset` when one applies and a `path` into the value.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

CBOR is tested against all 81 rows of RFC 8949 Appendix A Table 6, vendored from the RFC text by a script, with each item printed in diagnostic notation exactly as the RFC prints it and every row in preferred form written back byte for byte from its JSON form. The rows that cannot come back identical are named in the test with the reason: the six infinities and NaNs written wider than they need, and the eleven items written with indefinite lengths. MessagePack is tested against the published MessagePack test suite (kawanet/msgpack-test-suite, MIT, commit e04f6ed): all 15 groups, 85 cases and 233 encodings, including every extension size and the timestamps with seconds and nanoseconds. The 8 byte timestamp layout was also worked out independently with Python's struct module from the specification. Neither format is checked against this folder's own output, and no MessagePack or CBOR library is used or compared.

## Licence

MIT. See [LICENSE](./LICENSE).
