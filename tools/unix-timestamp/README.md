# Unix Timestamp Converter

Convert between epoch values and dates, with unit detection and time zone control.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a Unix timestamp to a date and back. It detects whether a bare number is in seconds, milliseconds, microseconds or nanoseconds and tells you which it chose, because guessing silently is how a timestamp ends up a thousand times off. Dates are shown in UTC and in any IANA time zone, with the offset that actually applied on that date rather than today's.

## Supported

- Seconds, milliseconds, microseconds and nanoseconds, detected automatically or chosen by you
- ISO 8601, the HTTP date format, date only, time only and epoch values in every unit
- Any IANA time zone, with the correct historical offset and daylight saving state for that date
- Day of the week, day of the year, ISO week number, quarter and leap year
- Relative time, such as three days ago
- Parsing a date back to a timestamp, from ISO 8601, RFC 2822 or a bare date
- Negative timestamps, meaning dates before 1970

## Limits

- Leap seconds do not exist in Unix time. A timestamp cannot represent 23:59:60, and a duration across a leap second is off by a second against UTC. Nothing here can fix that; it is how the format is defined.
- JavaScript dates cover roughly 275,760 years either side of 1970. Anything further is refused rather than shown wrong.
- Nanosecond values exceed what a JavaScript number holds exactly, so they are shown as text and converted through milliseconds. The last six digits of a nanosecond timestamp are not preserved.
- Time zone data comes from your browser. A very old browser may have out-of-date rules for zones that changed recently.
- Dates before 1582 are shown on the proleptic Gregorian calendar, which is not what was in use at the time.

## Ambiguous cases, and what this does about them

- A bare number has no unit. Detection uses magnitude, with the boundary chosen so anything from 1973 to the year 5138 reads as seconds. Small numbers are flagged as a low-confidence guess rather than presented as fact, and the unit can always be overridden.
- A date string with no time zone, such as 2026-01-15, is read as UTC here. Many tools read it as local time, which shifts the date by up to a day depending on where you are sitting. The interpretation is stated on screen every time.

## Defined by

- [ISO 8601 — Date and time representations](https://www.iso.org/iso-8601-date-and-time-format.html)
- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339)
- [RFC 9110 section 5.6.7 — the HTTP date format](https://www.rfc-editor.org/rfc/rfc9110#section-5.6.7)
- [IANA Time Zone Database](https://www.iana.org/time-zones)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/unix-timestamp unix-timestamp
cd unix-timestamp
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/unix-timestamp
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseInput, render, detectUnit } from '@fodt/unix-timestamp';

const parsed = parseInput('1767225600');
parsed.detectedUnit;    // 'seconds'
render(parsed.ms!, { timeZone: 'Asia/Tokyo' });

detectUnit(1767225600000);  // { unit: 'milliseconds', reason: … }
```

`parseInput` returns an `interpretation` string explaining how the input was read, which the web page shows so a wrong guess is obvious rather than hidden. `render` throws a `RangeError` for values outside the representable range instead of producing an Invalid Date.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Covers each unit boundary, the Gregorian leap year rule including 1900 and 2000, ISO week numbering at the three awkward year boundaries, daylight saving in both directions for New York, a half-hour offset zone, a zone that crosses the date line, the 2038 signed 32-bit overflow moment and the moment after it, dates before 1970, and round trips through both the ISO string and the epoch value.

## Licence

MIT. See [LICENSE](./LICENSE).
