import { it, expect } from 'vitest';
import {
  wallClock,
  formatStrftime,
  formatLdml,
  formatIntl,
  parseMoment,
  STRFTIME_CONVERSIONS,
  LDML_LETTERS,
  DateFormatError,
} from '../src/index';

/**
 * Oracle: GNU date (coreutils) 8.32, run live this session in Git Bash.
 * Fixed instant: 1996-07-10T15:08:56-07:00 in America/Los_Angeles, which is
 * epoch 837036536 (1996-07-10T22:08:56Z). Verified the epoch itself:
 *
 *   $ LC_ALL=C TZ=PST8PDT date -d @837036536 '+%Y-%m-%d %H:%M:%S %z'
 *   1996-07-10 15:08:56 -0700
 *
 * Every conversion below was read from a single combined command run against
 * that same instant and zone:
 *
 *   $ LC_ALL=C TZ=PST8PDT date -d @837036536 '+a=%a A=%A b=%b B=%B c=[%c] C=%C d=%d D=%D e=[%e] F=%F g=%g G=%G h=%h H=%H I=%I j=%j m=%m M=%M n=[%n] p=%p r=%r R=%R S=%S t=[%t] T=%T u=%u U=%U V=%V w=%w W=%W x=%x X=%X y=%y Y=%Y z=%z Z=%Z pct=%%'
 *   a=Wed A=Wednesday b=Jul B=July c=[Wed Jul 10 15:08:56 1996] C=19 d=10
 *   D=07/10/96 e=[10] F=1996-07-10 g=96 G=1996 h=Jul H=15 I=03 j=192 m=07
 *   M=08 n=[<newline>] p=PM r=03:08:56 PM R=15:08 S=56 t=[<tab>] T=15:08:56
 *   u=3 U=27 V=28 w=3 W=28 x=07/10/96 X=15:08:56 y=96 Y=1996 z=-0700 Z=PDT
 *   pct=%
 */
const wall = wallClock(new Date('1996-07-10T22:08:56.000Z'), 'America/Los_Angeles');

it('POSIX strftime conversions in the C locale match GNU date for a fixed instant', () => {
  expect(formatStrftime('%a', wall)).toBe('Wed');
  expect(formatStrftime('%A', wall)).toBe('Wednesday');
  expect(formatStrftime('%b', wall)).toBe('Jul');
  expect(formatStrftime('%B', wall)).toBe('July');
  expect(formatStrftime('%h', wall)).toBe('Jul');
  expect(formatStrftime('%c', wall)).toBe('Wed Jul 10 15:08:56 1996');
  expect(formatStrftime('%C', wall)).toBe('19');
  expect(formatStrftime('%d', wall)).toBe('10');
  expect(formatStrftime('%D', wall)).toBe('07/10/96');
  expect(formatStrftime('%e', wall)).toBe('10');
  expect(formatStrftime('%F', wall)).toBe('1996-07-10');
  expect(formatStrftime('%g', wall)).toBe('96');
  expect(formatStrftime('%G', wall)).toBe('1996');
  expect(formatStrftime('%H', wall)).toBe('15');
  expect(formatStrftime('%I', wall)).toBe('03');
  expect(formatStrftime('%j', wall)).toBe('192');
  expect(formatStrftime('%m', wall)).toBe('07');
  expect(formatStrftime('%M', wall)).toBe('08');
  expect(formatStrftime('%n', wall)).toBe('\n');
  expect(formatStrftime('%p', wall)).toBe('PM');
  expect(formatStrftime('%r', wall)).toBe('03:08:56 PM');
  expect(formatStrftime('%R', wall)).toBe('15:08');
  expect(formatStrftime('%S', wall)).toBe('56');
  expect(formatStrftime('%t', wall)).toBe('\t');
  expect(formatStrftime('%T', wall)).toBe('15:08:56');
  expect(formatStrftime('%u', wall)).toBe('3');
  expect(formatStrftime('%U', wall)).toBe('27');
  expect(formatStrftime('%V', wall)).toBe('28');
  expect(formatStrftime('%w', wall)).toBe('3');
  expect(formatStrftime('%W', wall)).toBe('28');
  expect(formatStrftime('%x', wall)).toBe('07/10/96');
  expect(formatStrftime('%X', wall)).toBe('15:08:56');
  expect(formatStrftime('%y', wall)).toBe('96');
  expect(formatStrftime('%Y', wall)).toBe('1996');
  expect(formatStrftime('%z', wall)).toBe('-0700');
  expect(formatStrftime('%Z', wall)).toBe('PDT');
  expect(formatStrftime('%%', wall)).toBe('%');
  // A combined pattern round-trips the same as each conversion checked alone.
  expect(formatStrftime('%Y-%m-%d %H:%M:%S %z', wall)).toBe('1996-07-10 15:08:56 -0700');
});

/**
 * Oracle: GNU date, run live this session for the two January-boundary
 * dates in UTC (the week-numbering rules only depend on the calendar date,
 * not a zone or a time of day):
 *
 *   $ LC_ALL=C TZ=UTC0 date -d '2021-01-01' '+U=%U W=%W V=%V G=%G'
 *   U=00 W=00 V=53 G=2020
 *   $ LC_ALL=C TZ=UTC0 date -d '2024-12-30' '+U=%U W=%W V=%V G=%G'
 *   U=52 W=53 V=01 G=2025
 *
 * %U/%W (Sunday/Monday-first, days before the first such day are week 0) and
 * %V/%G (ISO 8601 week-based year, Monday-first, week 1 owns the first
 * Thursday of January) disagree with each other at this boundary by design:
 * that disagreement is exactly what this test proves is handled correctly,
 * not papered over.
 */
it('strftime week numbers U, W, V and G handle the first days of January', () => {
  const jan1_2021 = wallClock(new Date('2021-01-01T00:00:00.000Z'), 'UTC');
  expect(formatStrftime('%U', jan1_2021)).toBe('00');
  expect(formatStrftime('%W', jan1_2021)).toBe('00');
  expect(formatStrftime('%V', jan1_2021)).toBe('53');
  expect(formatStrftime('%G', jan1_2021)).toBe('2020');

  const dec30_2024 = wallClock(new Date('2024-12-30T00:00:00.000Z'), 'UTC');
  expect(formatStrftime('%V', dec30_2024)).toBe('01');
  expect(formatStrftime('%G', dec30_2024)).toBe('2025');
});

it('strftime E and O modifiers are accepted and flags or field widths are rejected by name', () => {
  // POSIX: "If the alternative format or specification does not exist for
  // the current locale... the behavior shall be as if the unmodified
  // conversion specification were used." The POSIX (C) locale has none, so
  // %EY and %OH fall back to their unmodified conversions.
  expect(formatStrftime('%EY', wall)).toBe(formatStrftime('%Y', wall));
  expect(formatStrftime('%Ec', wall)).toBe(formatStrftime('%c', wall));
  expect(formatStrftime('%OH', wall)).toBe(formatStrftime('%H', wall));
  expect(formatStrftime('%Od', wall)).toBe(formatStrftime('%d', wall));

  // A flag or a minimum field width -- POSIX extensions this tool does not
  // implement -- is rejected by name, naming the exact specifier text.
  expect(() => formatStrftime('%+4Y', wall)).toThrow(DateFormatError);
  expect(() => formatStrftime('%+4Y', wall)).toThrow('%+4Y');
  expect(() => formatStrftime('%04Y', wall)).toThrow(DateFormatError);
  expect(() => formatStrftime('%04Y', wall)).toThrow('%04Y');
});

it('an unknown strftime conversion is rejected by name', () => {
  expect(() => formatStrftime('%Q', wall)).toThrow(DateFormatError);
  expect(() => formatStrftime('%Q', wall)).toThrow('%Q');
  expect(() => formatStrftime('%', wall)).toThrow(DateFormatError);
  // Every letter STRFTIME_CONVERSIONS claims to support actually renders
  // without throwing, for the same fixed instant.
  for (const letter of Object.keys(STRFTIME_CONVERSIONS)) {
    expect(() => formatStrftime(`%${letter}`, wall)).not.toThrow();
  }
});

it('ECMA-402 Intl column uses the chosen locale, zone and styles', () => {
  const moment = parseMoment('1996-07-10T15:08:56-07:00');
  // Node's own Intl.DateTimeFormat('en-US', { dateStyle: 'full' }) for this
  // moment and zone -- the exact behaviour quoted in the plan's own text,
  // independently confirmed against a direct Intl call this session.
  expect(formatIntl(moment, { locale: 'en-US', zone: 'America/Los_Angeles', dateStyle: 'full' })).toBe(
    'Wednesday, July 10, 1996',
  );
  // Changing the locale changes the rendering.
  expect(formatIntl(moment, { locale: 'de-DE', zone: 'America/Los_Angeles', dateStyle: 'full' })).toContain('1996');
  // Both styles 'none' renders the locale's own bare default (no dateStyle/timeStyle passed to Intl at all).
  const bare = formatIntl(moment, { locale: 'en-US', zone: 'UTC' });
  expect(bare.length).toBeGreaterThan(0);
  expect(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(moment)).toBe(bare);
});

it('a bare local time with no zone qualifier is rejected, and an explicit offset or Z is accepted', () => {
  expect(() => parseMoment('1996-07-10T15:08:56')).toThrow(DateFormatError);
  expect(() => parseMoment('1996-07-10T15:08:56')).toThrow('explicit Z or UTC offset');
  expect(parseMoment('1996-07-10T22:08:56Z').getTime()).toBe(837036536000);
  expect(parseMoment('1996-07-10T15:08:56-07:00').getTime()).toBe(837036536000);
});

/**
 * Oracle: UTS #35 Part 4 "Date Format Patterns", section "Date Format
 * Pattern Examples", fetched live this session
 * (https://www.unicode.org/reports/tr35/tr35-dates.html). The table's six
 * rows, quoted verbatim from the fetched page:
 *
 *   yyyy.MM.dd G 'at' HH:mm:ss zzz        | 1996.07.10 AD at 15:08:56 PDT
 *   EEE, MMM d, ''yy                      | Wed, July 10, '96
 *   h:mm a                                | 12:08 PM
 *   hh 'o''clock' a, zzzz                 | 12 o'clock PM, Pacific Daylight Time
 *   K:mm a, z                             | 0:00 PM, PST
 *   yyyyy.MMMM.dd GGG hh:mm aaa           | 01996.July.10 AD 12:08 PM
 *
 * Row 1, 3, 4 and 6 are for "a particular locale" the table does not name
 * further, but its own captions state the moments used: 15:08:56 PDT for
 * row 1, and 12:08:56 PDT for rows 3, 4 and 6 (the row-5 "winter 12:00 PST"
 * moment is stated directly in the surrounding prose the plan already
 * quotes). Row 2's own result ("Wed, July 10, '96") is the one place the
 * examples table disagrees with its own Date Field Symbol Table, which
 * defines MMM as "Abbreviated" -- see the next test, which asserts this
 * tool follows the field table (giving "Jul"), not the inconsistent example.
 */
it('UTS #35 date format pattern examples render exactly as documented', () => {
  const afternoon = wallClock(new Date('1996-07-10T22:08:56.000Z'), 'America/Los_Angeles'); // 15:08:56 PDT
  expect(formatLdml("yyyy.MM.dd G 'at' HH:mm:ss zzz", afternoon)).toBe('1996.07.10 AD at 15:08:56 PDT');

  const noon = wallClock(new Date('1996-07-10T19:08:56.000Z'), 'America/Los_Angeles'); // 12:08:56 PDT
  expect(formatLdml('h:mm a', noon)).toBe('12:08 PM');
  expect(formatLdml("hh 'o''clock' a, zzzz", noon)).toBe("12 o'clock PM, Pacific Daylight Time");
  expect(formatLdml('yyyyy.MMMM.dd GGG hh:mm aaa', noon)).toBe('01996.July.10 AD 12:08 PM');

  const winterNoon = wallClock(new Date('1996-01-10T20:00:00.000Z'), 'America/Los_Angeles'); // 12:00 PST
  expect(formatLdml('K:mm a, z', winterNoon)).toBe('0:00 PM, PST');
});

it('the UTS #35 example with MMM follows the field table and gives Jul', () => {
  // Date Field Symbol Table, month row: "MMM | Sep | Abbreviated". The
  // examples table's own row 2 result ("Wed, July 10, '96") uses the full
  // month name for MMM instead, which contradicts that field definition --
  // this tool follows the field table, not the inconsistent example.
  const afternoon = wallClock(new Date('1996-07-10T22:08:56.000Z'), 'America/Los_Angeles');
  expect(formatLdml("EEE, MMM d, ''yy", afternoon)).toBe("Wed, Jul 10, '96");
});

it('LDML k shows hour 0 as 24 and K shows hour 12 as 0, unlike strftime H and I', () => {
  const midnight = wallClock(new Date('1996-07-10T00:00:00.000Z'), 'UTC'); // hour 0
  expect(formatLdml('k', midnight)).toBe('24');
  expect(formatLdml('kk', midnight)).toBe('24');
  expect(formatStrftime('%H', midnight)).toBe('00');

  const noon = wallClock(new Date('1996-07-10T12:00:00.000Z'), 'UTC'); // hour 12
  expect(formatLdml('K', noon)).toBe('0');
  expect(formatLdml('KK', noon)).toBe('00');
  expect(formatStrftime('%I', noon)).toBe('12');
});

it('LDML quoted literals and doubled apostrophes render as literal text', () => {
  expect(formatLdml("'yyyy'", wall)).toBe('yyyy');
  expect(formatLdml("''", wall)).toBe("'");
  expect(formatLdml("yyyy''MM", wall)).toBe("1996'07");
  expect(() => formatLdml("'unterminated", wall)).toThrow(DateFormatError);
});

it('an unsupported LDML pattern letter is rejected by name', () => {
  expect(() => formatLdml('YYYY', wall)).toThrow(DateFormatError);
  expect(() => formatLdml('YYYY', wall)).toThrow('YYYY');
  expect(() => formatLdml('www', wall)).toThrow(DateFormatError);
  expect(() => formatLdml('ee', wall)).toThrow(DateFormatError);
  expect(() => formatLdml('cc', wall)).toThrow(DateFormatError);
  expect(() => formatLdml('P', wall)).toThrow(DateFormatError);
  for (const letter of Object.keys(LDML_LETTERS)) {
    expect(() => formatLdml(letter, wall)).not.toThrow();
  }
});
