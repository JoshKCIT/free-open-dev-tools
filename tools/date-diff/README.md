# Date & Duration Calculator

Measure the gap between two moments and add or subtract durations.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Measures the gap between two moments, both as an exact elapsed time and as a calendar breakdown of years, months and days, and adds or subtracts an ISO 8601 duration from a moment. Calendar-month arithmetic has no single right answer once you add a month to the 31st, so this tool states its choice plainly instead of hiding it in the result.

## Supported

- ISO 8601 / RFC 3339 dates and date-times, with or without a time and with or without a UTC offset
- RFC 3339 Appendix A durations in the combined PnYnMnDTnHnMnS form and the PnW week form
- An exact elapsed time in days, hours, minutes, seconds and total seconds
- A calendar breakdown (years, months, days, hours, minutes, seconds) of the same gap
- Adding or subtracting a duration from a moment, with calendar-month/year steps clamped to the last valid day of the target month
- Years 0001 through 9999, with a year below 100 read exactly as written rather than shifted into the 1900s

## Limits

- A moment with no UTC offset is read as UTC, not as any local time zone. The difference between two zone-less moments is real elapsed time only if both were meant to be read the same way.
- Calendar leap seconds do not exist here; every day is treated as exactly 86,400 seconds.
- Dates before 1582 are on the proleptic Gregorian calendar, which is not what was in use at the time.
- Fractional seconds in a duration or a moment are not accepted.

## Ambiguous cases, and what this does about them

- Adding a calendar month or year has no universally right answer once the result would land on a day that month does not have -- 2024-01-31 plus one month has no date that is both "the 31st" and a real day in February. This tool clamps to the last valid day of the target month (2024-01-31 + P1M = 2024-02-29; 2023-01-31 + P1M = 2023-02-28), the more common convention among mature date libraries, rather than overflowing into March.
- The calendar breakdown between two moments is computed the same way: it counts whole years, then whole months (each step using the clamped-day rule above), then the exact remaining days, hours, minutes and seconds -- so it agrees with what adding that same breakdown back to the earlier moment would produce.
- A moment with no stated UTC offset is read as UTC. This is a deliberate, stated choice, not a detection of your local time zone.

## Defined by

- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339)
- [ISO 8601-1:2019 — Date and time representations](https://www.iso.org/iso-8601-date-and-time-format.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/date-diff date-diff
cd date-diff
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/date-diff
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseMoment, parseDuration, diffMoments, addDuration, formatIsoDuration } from '@fodt/date-diff';

const a = parseMoment('2024-01-31');
const b = parseMoment('2024-03-01');
diffMoments(a, b);
// { sign: 1, totalSeconds: 2592000, exact: { days: 30, hours: 0, … }, calendar: { years: 0, months: 1, days: 1, … } }

addDuration(a, parseDuration('P1M'), 1);  // 2024-02-29, clamped
formatIsoDuration({ years: 0, months: 1, days: 1, hours: 0, minutes: 0, seconds: 0 });  // 'P1M1D'
```

`parseMoment` and `addDuration` both work in plain epoch milliseconds (UTC); `parseMoment` throws `DateDiffError` for anything that is not a valid ISO 8601 date or date-time, and `parseDuration` throws the same error class for anything that is not a valid RFC 3339 Appendix A duration. `diffMoments` always computes its calendar breakdown from the earlier of the two moments forward, and reports which one came first in `sign`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Tests cite RFC 3339 Appendix A's duration ABNF directly (fetched live) for what a duration string must look like, and RFC 3339's own note that this grammar is informational and may itself contain errors -- the combined PnYnMnDTnHnMnS form this tool accepts is the wider ISO 8601-1:2019 grammar, cited alongside RFC 3339 for that reason. The end-of-month clamping choice has no standard to test against, since none exists for calendar duration arithmetic (03-RESEARCH.md pitfall 4); the January-31 and February-29 cases are tested directly against the stated convention instead.

## Licence

MIT. See [LICENSE](./LICENSE).
