import { it, expect } from 'vitest';
import { convertMoment, findTransitions, isValidZone, TimeZoneError } from '../src/index';

/**
 * IANA tz database rule and zone lines, fetched live this session from the
 * project's own upstream source (https://raw.githubusercontent.com/eggert/tz/main/northamerica
 * and .../europe), quoted verbatim so these test vectors are grounded in the
 * published rules rather than memory:
 *
 * northamerica, line 193-194:
 *   Rule    US      2007    max     -       Mar     Sun>=8  2:00    1:00    D
 *   Rule    US      2007    max     -       Nov     Sun>=1  2:00    0       S
 * northamerica, line 346 (Zone America/New_York, current stanza):
 *   Zone America/New_York  -4:56:02 -      LMT     1883 Nov 18 17:00u
 *                          -5:00   US      E%sT
 * (the "US" rule column means the Sun>=8/Sun>=1 rule above governs every
 * spring/fall transition from 2007 onward -- 2024-03-10 is the second Sunday
 * in March, 2024-11-03 is the first Sunday in November.)
 *
 * europe, lines 590-591:
 *   Rule    EU      1981    max     -       Mar     lastSun  1:00u   1:00    S
 *   Rule    EU      1996    max     -       Oct     lastSun  1:00u   0       -
 * europe, line 522-526 (Zone Europe/London, current stanza):
 *   Zone    Europe/London  -0:01:15 -       LMT     1847 Dec  1
 *                           0:00    GB-Eire  %s      1968 Oct 27
 *                           1:00    -        BST     1971 Oct 31  2:00u
 *                           0:00    GB-Eire  %s      1996
 *                           0:00    EU       GMT/BST
 * (from 1996 the EU rule governs: last Sunday in March at 01:00 UTC BST
 * begins, last Sunday in October at 01:00 UTC it ends -- 2024-03-31 and
 * 2024-10-27 are those Sundays.)
 */

it('America/New_York springs forward at 2024-03-10 07:00 UTC from -05:00 to -04:00', () => {
  const before = convertMoment('2024-03-10T06:59:59Z', 'UTC', 'America/New_York');
  expect(before.to.wall).toBe('2024-03-10 01:59:59');
  expect(before.to.offset).toBe('-05:00');

  const after = convertMoment('2024-03-10T07:00:00Z', 'UTC', 'America/New_York');
  expect(after.to.wall).toBe('2024-03-10 03:00:00');
  expect(after.to.offset).toBe('-04:00');

  const transitions = findTransitions('America/New_York', 2024);
  const spring = transitions.find((t) => t.atUtc.startsWith('2024-03'));
  expect(spring).toBeDefined();
  expect(spring!.atUtc).toBe('2024-03-10T07:00:00.000Z');
  expect(spring!.offsetBefore).toBe('-05:00');
  expect(spring!.offsetAfter).toBe('-04:00');
});

it('America/New_York falls back at 2024-11-03 06:00 UTC from -04:00 to -05:00', () => {
  const before = convertMoment('2024-11-03T05:59:59Z', 'UTC', 'America/New_York');
  expect(before.to.wall).toBe('2024-11-03 01:59:59');
  expect(before.to.offset).toBe('-04:00');

  const after = convertMoment('2024-11-03T06:00:00Z', 'UTC', 'America/New_York');
  expect(after.to.wall).toBe('2024-11-03 01:00:00');
  expect(after.to.offset).toBe('-05:00');

  const transitions = findTransitions('America/New_York', 2024);
  const fall = transitions.find((t) => t.atUtc.startsWith('2024-11'));
  expect(fall).toBeDefined();
  expect(fall!.atUtc).toBe('2024-11-03T06:00:00.000Z');
  expect(fall!.offsetBefore).toBe('-04:00');
  expect(fall!.offsetAfter).toBe('-05:00');
});

it('Europe/London springs forward at 2024-03-31 01:00 UTC and falls back at 2024-10-27 01:00 UTC', () => {
  const springBefore = convertMoment('2024-03-31T00:59:59Z', 'UTC', 'Europe/London');
  expect(springBefore.to.offset).toBe('+00:00');
  const springAfter = convertMoment('2024-03-31T01:00:00Z', 'UTC', 'Europe/London');
  expect(springAfter.to.offset).toBe('+01:00');

  const fallBefore = convertMoment('2024-10-27T00:59:59Z', 'UTC', 'Europe/London');
  expect(fallBefore.to.offset).toBe('+01:00');
  const fallAfter = convertMoment('2024-10-27T01:00:00Z', 'UTC', 'Europe/London');
  expect(fallAfter.to.offset).toBe('+00:00');

  const transitions = findTransitions('Europe/London', 2024);
  expect(transitions).toHaveLength(2);
  expect(transitions[0]!.atUtc).toBe('2024-03-31T01:00:00.000Z');
  expect(transitions[0]!.offsetBefore).toBe('+00:00');
  expect(transitions[0]!.offsetAfter).toBe('+01:00');
  expect(transitions[1]!.atUtc).toBe('2024-10-27T01:00:00.000Z');
  expect(transitions[1]!.offsetBefore).toBe('+01:00');
  expect(transitions[1]!.offsetAfter).toBe('+00:00');
});

it('RFC 5545 section 3.3.5 a nonexistent local time in the spring gap is read with the offset before the gap', () => {
  // RFC 5545 section 3.3.5, quoted verbatim (fetched live this session,
  // https://www.rfc-editor.org/rfc/rfc5545.txt): "If the local time
  // described does not occur (when changing from standard to daylight
  // time), the DATE-TIME value is interpreted using the UTC offset before
  // the gap in local times. Thus, TZID=America/New_York:20070311T023000
  // indicates March 11, 2007 at 3:30 A.M. EDT (UTC-04:00), one hour after
  // 1:30 A.M. EST (UTC-05:00)."
  const result = convertMoment('2007-03-11T02:30', 'America/New_York', 'America/New_York');
  expect(result.to.wall).toBe('2007-03-11 03:30:00');
  expect(result.to.offset).toBe('-04:00');
  expect(result.to.abbreviation).toBe('EDT');
  expect(result.note).toContain('does not exist');
  expect(result.alternative).toBeUndefined();
});

it('RFC 5545 section 3.3.5 an ambiguous local time in the fall overlap resolves to the first occurrence and both are reported', () => {
  // RFC 5545 section 3.3.5, quoted verbatim: "If, based on the definition
  // of the referenced time zone, the local time described occurs more
  // than once (when changing from daylight to standard time), the
  // DATE-TIME value refers to the first occurrence of the referenced
  // time. Thus, TZID=America/New_York:20071104T013000 indicates November
  // 4, 2007 at 1:30 A.M. EDT (UTC-04:00)."
  const result = convertMoment('2007-11-04T01:30', 'America/New_York', 'America/New_York');
  expect(result.to.wall).toBe('2007-11-04 01:30:00');
  expect(result.to.offset).toBe('-04:00');
  expect(result.to.abbreviation).toBe('EDT');
  expect(result.note).toContain('twice');
  expect(result.alternative).toBeDefined();
  expect(result.alternative!.wall).toBe('2007-11-04 01:30:00');
  expect(result.alternative!.offset).toBe('-05:00');
  expect(result.alternative!.abbreviation).toBe('EST');
});

it('a half-hour zone such as Asia/Kolkata converts with a +05:30 offset', () => {
  const result = convertMoment('2024-06-15T12:00:00', 'Asia/Kolkata', 'Asia/Kolkata');
  expect(result.from.offset).toBe('+05:30');
  expect(result.to.offset).toBe('+05:30');
  expect(result.note).toBeUndefined();
});

it('an unknown zone name or unparsable moment is rejected', () => {
  expect(() => convertMoment('not a moment', 'UTC', 'UTC')).toThrow(TimeZoneError);
  expect(() => convertMoment('2024-01-01T00:00', 'Not/AZone', 'UTC')).toThrow(TimeZoneError);
  expect(() => convertMoment('2024-01-01T00:00', 'UTC', 'Not/AZone')).toThrow(TimeZoneError);
  expect(() => findTransitions('Not/AZone', 2024)).toThrow(TimeZoneError);
  expect(isValidZone('Not/AZone')).toBe(false);
  expect(isValidZone('America/New_York')).toBe(true);
});
