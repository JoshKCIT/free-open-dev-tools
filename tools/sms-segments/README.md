# SMS Segment Calculator

Count the SMS segments a message needs, see whether it fits the GSM 7-bit alphabet and which characters force Unicode.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Type or paste a text message and see how many SMS segments it needs. The count follows 3GPP TS 23.038 and TS 23.040: a message made only of characters in the GSM 7-bit default alphabet is counted in septets, 160 in one message and 153 a part once it is longer; any other character turns the whole message into UCS-2, counted in 16-bit units, 70 in one message and 67 a part. Nothing you type is sent anywhere.

## Supported

- The GSM 7-bit default alphabet of 3GPP TS 23.038 with its extension table: form feed, ^, {, }, backslash, [, ~, ], the vertical bar and the euro sign count two septets each (an escape and a code)
- UCS-2 counting in UTF-16 code units: a character above U+FFFF counts two units and is never split between parts
- Segment sizes from 3GPP TS 23.040 clause 9.2.3.24.1: 160 septets or 70 units in one message, 153 septets or 67 units a part when the message is longer

## Limits

- Counts follow 3GPP TS 23.038 and TS 23.040 for one text message sent with a standard concatenation header. A sending service can change the text, choose another encoding, join or split messages differently, or bill differently from what this page shows.
- The page counts the characters exactly as typed. It does not normalise accents or replace look-alike characters.
- Text over 100,000 characters is refused.

## Defined by

- [3GPP TS 23.038: Alphabets and language-specific information](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=745)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sms-segments sms-segments
cd sms-segments
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sms-segments
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { analyseMessage } from '@fodt/sms-segments';

const result = analyseMessage('a'.repeat(161));
result.encoding; // 'gsm7'
result.segments.map((s) => s.used); // [153, 8]
```

`analyseMessage(text)` walks the text once by code point and returns the encoding, the counts and the segments.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The tracer test is derived from 3GPP TS 23.040 clause 9.2.3.24.1: 153 is 160 minus 7.

## Licence

MIT. See [LICENSE](./LICENSE).
