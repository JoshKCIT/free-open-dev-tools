# Time Zone Converter

Convert a moment between IANA time zones, showing offsets and DST transitions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a moment between IANA time zones and shows the offset and abbreviation each zone uses at that instant. A wall-clock time typed without a zone is read in the zone you choose, including the two awkward cases every DST-observing zone has once a year: a local time that never happens because clocks jump forward past it, and a local time that happens twice because clocks fall back through it. Both are resolved by the same rule iCalendar uses, and the table below shows every clock change in the chosen zones for the year in view.

## Supported

- Any IANA time zone name your browser knows, not just the shortlist offered in the select boxes
- A moment given with an explicit UTC offset or Z, which is read exactly as written
- A wall-clock moment with no offset, read as local time in the zone you pick
- A local time that does not exist (spring-forward gap), resolved with the offset in force just before the gap
- A local time that happens twice (fall-back overlap), with both readings shown and the first chosen by default
- Half-hour and 45-minute offset zones, such as Asia/Kolkata and Australia/Lord_Howe
- A table of every offset change in the selected zones for the year the moment falls in

## Limits

- Answers come from this browser's built-in time zone data; a browser with older data can differ for recently changed zones.
- No tz database ships with this tool. If your browser has not been updated since a zone's rules last changed, the answer reflects the old rules.
- The transitions table only looks one calendar year ahead from the moment's own year; a zone that changes rules again the following year is not shown.
- Historical zone abbreviations before a browser's own data begins are whatever that browser reports, which is not always the name used at the time.

## Ambiguous cases, and what this does about them

- A local time in a spring-forward gap (for example 2024-03-10 02:30 in America/New_York) is not a real moment. This tool reads it using the offset that was in force just before the gap, exactly as RFC 5545 section 3.3.5 specifies for iCalendar's own DATE-TIME value, so the result lands one hour later than the typed clock face.
- A local time in a fall-back overlap happens twice, once at each offset. This tool reports the first occurrence (the offset in force before the change) as the primary answer and shows the second occurrence alongside it, again matching RFC 5545 section 3.3.5's own worked example.

## Defined by

- [IANA Time Zone Database](https://www.iana.org/time-zones)
- [RFC 5545 section 3.3.5 — iCalendar DATE-TIME](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5)
- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/timezone-converter timezone-converter
cd timezone-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/timezone-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertMoment, findTransitions } from '@fodt/timezone-converter';

convertMoment('2024-11-03T01:30', 'America/New_York', 'UTC');
// { instantUtc: '2024-11-03T05:30:00.000Z', from: { wall: '2024-11-03 01:30:00', offset: '-04:00', abbreviation: 'EDT' }, to: {...}, note: '…', alternative: {...} }

findTransitions('America/New_York', 2024);
// [{ atUtc: '2024-03-10T07:00:00.000Z', offsetBefore: '-05:00', offsetAfter: '-04:00', … }, …]
```

`convertMoment` throws `TimeZoneError` for a moment it cannot parse or a zone name your browser does not recognise. `from`/`to` in its return value are always the zone's actual reading at the resolved instant; `alternative` is present only for a fall-back overlap. `findTransitions` throws the same error for an unknown zone and otherwise never fails, returning an empty array for a year with no offset change.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Pins DST transitions for America/New_York and Europe/London against the IANA tz database's own northamerica and europe rule files (Rule US 2007 max, Rule EU 1981 max, Rule EU 1996 max), and the two RFC 5545 section 3.3.5 worked examples (the 2007-03-11 gap and the 2007-11-04 overlap) directly from the RFC's own text.

## Licence

MIT. See [LICENSE](./LICENSE).
