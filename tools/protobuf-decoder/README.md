# Protobuf Decoder (no schema)

Decode raw Protocol Buffers bytes without a schema into field numbers, wire types and the values they could hold.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decodes raw Protocol Buffers bytes in your browser without a schema. The wire format carries field numbers and wire types but not field names or types, so every field is shown with each reading its bytes allow: a varint as an unsigned, a signed and a zigzag number, fixed 32 and 64 bit values as integers and as floating point, and a length-delimited field as text, as bytes and, when its bytes parse completely, as a nested message. Paste hex or Base64, or open a file; nothing is uploaded.

## Supported

- All six wire types of the Protocol Buffers encoding guide: varint, 64 bit, length-delimited, start group, end group and 32 bit
- Varints up to 10 bytes, so the full 64 bit range, and field numbers from 1 to 536,870,911
- Nested messages, found by trying to parse each length-delimited field, and matched start and end groups
- Packed repeated varints, found by trying to parse each length-delimited field as a run of varints, when you ask for them
- Hex (with or without spaces) or Base64 in, from pasted text or a file, up to 5 MiB
- A text listing in the style of a raw decode (1: 150) and a table of every field with its number, wire type, offset and readings

## Limits

- Input up to 5 MiB.
- Without a schema the decoder cannot know a field's type, so every reading the bytes allow is shown: a varint as unsigned, signed and zigzag, fixed values as integers and floating point, and length-delimited bytes as text, bytes or a nested message guess.
- Nested-message guesses stop at 32 levels; the bytes are still shown. Groups nested deeper than 32 levels are refused.
- Field names, enum names and default values are not in the wire format and cannot be shown.
- A length-delimited field is a nested message guess only when its bytes parse completely as fields, so a short string that happens to look like one can show as both text and a message.
- Packed repeated fixed-width numbers are not guessed: they show as bytes, and as a nested message only if the bytes happen to parse as one.
- The table lists the first 500 fields and the listing the first 50,000 fields, counting those inside nested messages and groups (a length-delimited field after that is not tried as a nested message); the page says when more were found.

## Ambiguous cases, and what this does about them

- A varint of 150 is an unsigned 150, a signed 150 and a zigzag 75; the declared type decides which is meant and is not in the bytes
- The same eight bytes are a fixed64, an sfixed64 or a double, and four bytes are a fixed32, an sfixed32 or a float; all three readings are shown
- A length-delimited field can be a string, bytes, a nested message or a packed list; the readings that fit are all shown, text first
- Text is shown only when the bytes are valid UTF-8 with no control characters other than tab, line feed and carriage return
- A varint written with more bytes than it needs (80 00 for 0) is accepted, because decoders accept it
- A varint of 10 bytes whose last byte is above 1 does not fit in 64 bits and is refused
- Offsets count bytes from the start of the input, and a nested field's offset is its position in the whole input

## Defined by

- [Protocol Buffers: Encoding](https://protobuf.dev/programming-guides/encoding/)
- [Protocol Buffers Language Guide (proto3): assigning field numbers](https://protobuf.dev/programming-guides/proto3/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/protobuf-decoder protobuf-decoder
cd protobuf-decoder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/protobuf-decoder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decodeProtobuf, formatDecodeRaw, readInputBytes } from '@fodt/protobuf-decoder';

const bytes = readInputBytes('08 96 01', 'hex');
const fields = decodeProtobuf(bytes, { nested: true, packed: false });
console.log(formatDecodeRaw(fields));
// 1: 150
console.log(fields[0].readings);
// [ { label: 'Unsigned', value: '150' }, { label: 'Signed', value: '150' }, { label: 'Zigzag', value: '75' } ]
```

`decodeProtobuf(bytes, { nested, packed })` returns the fields of one message, each with its `path` (the field numbers from the top, such as `3.1`), `number`, `wireType`, `wireName`, byte `offset` and `readings` (a label and a value each, the first being the one a plain listing uses), and `children` for a nested message or group. `decodeProtobufInfo` also says how many fields were found and whether the list was cut at `MAX_FIELDS`; `countFields(fields)` counts the fields of a decoded list, the nested ones too, which is the number kept. `formatDecodeRaw(fields)` writes the listing: `1: 150`, a quoted string for text, `bytes 00 01 ff` for bytes, `[1, 2, 3]` for packed varints and an indented `3 { ... }` block for a message or group. `readInputBytes(text, encoding)` reads hex or Base64. Every expected failure is a `ProtobufDecoderError` with a plain message and the byte `offset` it is about (for text that is not hex or Base64, the character position).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The encoding guide's own examples (08 96 01, and the bytes of its Test2, Test3 and Test4 messages) and the other encodings are the bytes the real protobuf library, Python 3.14.3 with protobuf 7.34.1, wrote for messages built from descriptors in code, quoted as literals with the program and version in the test comment: sint32 -500, int64 -2, fixed32 1, a double 1.5, a float, a fixed64, an sfixed32, a bool, bytes, a string, the largest uint64, a group and an unpacked repeated field. Truncation is tried at every position of every encoding. Nothing is checked against this folder's own output.

## Licence

MIT. See [LICENSE](./LICENSE).
