/**
 * Delivery hops and mail dates.
 *
 * Expected values come from RFC 5322 (the date-time grammar of section 3.3, the obsolete forms of section 4.3, Appendix A.1.1,
 * A.1.3, A.4, A.5, A.6.2 and A.6.3), RFC 5321 section 4.4 (the trace fields) and RFC 8601 Appendix B.1 (a Received date
 * written with the month before the day). Every expected instant is an ISO 8601 text read by Date.parse, which shares no
 * code with the package.
 */
import { it, expect } from 'vitest';
import { analyzeMessage, parseMailDate, parseReceived, readMailDate } from '../src/index';
import { build, bytesOf, messageText } from './helpers';

const at = (iso: string): number => Date.parse(iso);

/** A message made of Received lines (newest first, as a mail system writes them) and a short body. */
function withReceived(lines: string[]): Uint8Array {
  return build([...lines, 'From: a@example.com', 'Date: Tue, 06 Oct 2026 09:59:58 +0000'], 'Hello.');
}

it('Received lines are listed oldest first with the delay between their stated dates', async () => {
  // RFC 5322 Appendix A.4 (trace fields in the form RFC 5321 section 4.4 gives): the folded line is the newer one.
  const trace = await analyzeMessage(
    build(
      [
        'Received: from x.y.test',
        '   by example.net',
        '   via TCP',
        '   with ESMTP',
        '   id ABC12345',
        '   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600',
        'Received: from node.example by x.y.test; 21 Nov 1997 10:01:22 -0600',
        'From: John Doe <jdoe@node.example>',
        'To: Mary Smith <mary@example.net>',
        'Subject: Saying Hello',
        'Date: Fri, 21 Nov 1997 09:55:06 -0600',
        'Message-ID: <1234@local.node.example>',
      ],
      'This is a message just to say hello.\r\nSo, "Hello".\r\n',
    ),
  );
  expect(trace.hops).toHaveLength(2);
  const [first, second] = trace.hops;
  expect(first).toMatchObject({ index: 1, from: 'node.example', by: 'x.y.test', delay: '', delaySeconds: null });
  expect(first?.timeMs).toBe(at('1997-11-21T16:01:22Z'));
  expect(first?.time).toBe('1997-11-21 16:01:22');
  expect(second).toMatchObject({
    index: 2,
    from: 'x.y.test',
    by: 'example.net',
    via: 'TCP',
    with: 'ESMTP',
    id: 'ABC12345',
    for: '<mary@example.net>',
    time: '1997-11-21 16:05:43',
    delay: '4 min 21 s',
    delaySeconds: 261,
  });

  // The welcome message: the line at the bottom is the first hop, and the two stated dates are 6 seconds apart.
  const welcome = await analyzeMessage(bytesOf(messageText('welcome')));
  expect(welcome.hops.map((hop) => hop.from)).toEqual(['sender.example.com', 'relay.example.net']);
  expect(welcome.hops.map((hop) => hop.by)).toEqual(['relay.example.net', 'mx.example.org']);
  expect(welcome.hops[0]?.fromComment).toBe('sender.example.com [192.0.2.10]');
  expect(welcome.hops[1]?.delay).toBe('6 s');
  expect(welcome.hops[1]?.with).toBe('ESMTPS');
  expect(welcome.hops[1]?.id).toBe('abc123');

  // A -0800 date against a +0000 date: delays are measured after each zone is applied (17:19:07 -0800 is 01:19:07 UTC).
  const zones = await analyzeMessage(
    withReceived([
      'Received: from b.example by c.example; Sat, 16 Feb 2002 01:19:12 +0000',
      'Received: from a.example by b.example; Fri, 15 Feb 2002 17:19:07 -0800',
    ]),
  );
  expect(zones.hops.map((hop) => hop.time)).toEqual(['2002-02-16 01:19:07', '2002-02-16 01:19:12']);
  expect(zones.hops[1]?.delay).toBe('5 s');

  // The same stated date twice reads 0 s; the two forms of a delay are N s and N min N s.
  const stated = (ms: number): string => {
    const d = new Date(ms);
    const two = (n: number): string => String(n).padStart(2, '0');
    return `${d.getUTCDate()} Oct 2026 ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
  };
  const delays = async (seconds: number): Promise<string | undefined> => {
    const start = Date.UTC(2026, 9, 6, 10, 0, 0);
    const analysis = await analyzeMessage(
      withReceived([
        `Received: from b.example by c.example; ${stated(start + seconds * 1000)}`,
        `Received: from a.example by b.example; ${stated(start)}`,
      ]),
    );
    return analysis.hops[1]?.delay;
  };
  expect(await delays(0)).toBe('0 s');
  expect(await delays(59)).toBe('59 s');
  expect(await delays(60)).toBe('1 min 0 s');
  expect(await delays(125)).toBe('2 min 5 s');
  expect(await delays(3661)).toBe('61 min 1 s');

  // RFC 8601 Appendix B.1: the date has the month before the day. It is read, and the hop says so.
  const lenient = await analyzeMessage(
    withReceived([
      'Received: from mail-router.example.com',
      '              (mail-router.example.com [192.0.2.1])',
      '          by server.example.org (8.11.6/8.11.6)',
      '              with ESMTP id g1G0r1kA003489;',
      '          Fri, Feb 15 2002 17:19:07 -0800',
    ]),
  );
  expect(lenient.hops).toHaveLength(1);
  expect(lenient.hops[0]).toMatchObject({
    from: 'mail-router.example.com',
    by: 'server.example.org',
    with: 'ESMTP',
    id: 'g1G0r1kA003489',
    time: '2002-02-16 01:19:07',
  });
  expect(lenient.hops[0]?.note).toContain('month before the day');

  // Pasted headers with no blank line and no body give the same hops.
  const headersOnly = await analyzeMessage(
    bytesOf(
      [
        'Received: from relay.example.net (relay.example.net [192.0.2.25])',
        '        by mx.example.org with ESMTPS id abc123',
        '        for <alice@example.org>; Tue, 06 Oct 2026 10:00:09 +0000',
        'Received: from sender.example.com (sender.example.com [192.0.2.10])',
        '        by relay.example.net with ESMTP id r1',
        '        for <alice@example.org>; Tue, 06 Oct 2026 10:00:03 +0000',
        'Subject: x',
      ].join('\n'),
    ),
  );
  expect(headersOnly.hops.map((hop) => hop.from)).toEqual(['sender.example.com', 'relay.example.net']);
  expect(headersOnly.hops[1]?.delay).toBe('6 s');

  // The clause reader on its own: clauses inside a comment are not clauses.
  const parsed = parseReceived(
    'from a.example (from b.example by c.example) by d.example with SMTP; 21 Nov 1997 10:01:22 -0600',
  );
  expect(parsed.from).toBe('a.example');
  expect(parsed.by).toBe('d.example');
  expect(parsed.with).toBe('SMTP');
  expect(parsed.date?.ms).toBe(at('1997-11-21T16:01:22Z'));
});

it('RFC 5322 dates read obsolete zones and two-digit years as section 4.3 says', () => {
  // RFC 5322 Appendix A.1.1, A.1.3 and A.2: the plain form, with its zone applied.
  expect(parseMailDate('Fri, 21 Nov 1997 09:55:06 -0600')).toBe(at('1997-11-21T15:55:06Z'));
  expect(parseMailDate('Tue, 1 Jul 2003 10:52:37 +0200')).toBe(at('2003-07-01T08:52:37Z'));
  expect(parseMailDate('Thu, 13 Feb 1969 23:32:54 -0330')).toBe(at('1969-02-14T03:02:54Z'));

  // Appendix A.5: white space between every token, no seconds, and a comment at the end.
  expect(
    parseMailDate(
      'Thu,         13           Feb             1969         23:32                  -0330 (Newfoundland Time)',
    ),
  ).toBe(at('1969-02-14T03:02:00Z'));
  // Appendix A.6.3: a comment and white space around the colons.
  expect(parseMailDate('Fri, 21 Nov 1997 09(comment):   55  :  06 -0600')).toBe(at('1997-11-21T15:55:06Z'));
  // Appendix A.6.2: no day of week, a two digit year and GMT.
  expect(parseMailDate('21 Nov 97 09:55:06 GMT')).toBe(at('1997-11-21T09:55:06Z'));
  // RFC 6376 Appendix A.1: a numeric zone followed by a zone name in a comment.
  expect(parseMailDate('Fri, 11 Jul 2003 21:00:37 -0700 (PDT)')).toBe(at('2003-07-12T04:00:37Z'));

  // Section 4.3: the obsolete zones (EDT -0400, EST -0500, CDT -0500, CST -0600, MDT -0600, MST -0700, PDT -0700, PST -0800).
  const zone = (name: string): number | null => parseMailDate(`1 Jan 2000 12:00:00 ${name}`);
  expect(zone('UT')).toBe(at('2000-01-01T12:00:00Z'));
  expect(zone('GMT')).toBe(at('2000-01-01T12:00:00Z'));
  expect(zone('EDT')).toBe(at('2000-01-01T16:00:00Z'));
  expect(zone('EST')).toBe(at('2000-01-01T17:00:00Z'));
  expect(zone('CDT')).toBe(at('2000-01-01T17:00:00Z'));
  expect(zone('CST')).toBe(at('2000-01-01T18:00:00Z'));
  expect(zone('MDT')).toBe(at('2000-01-01T18:00:00Z'));
  expect(zone('MST')).toBe(at('2000-01-01T19:00:00Z'));
  expect(zone('PDT')).toBe(at('2000-01-01T19:00:00Z'));
  expect(zone('PST')).toBe(at('2000-01-01T20:00:00Z'));
  expect(zone('est')).toBe(at('2000-01-01T17:00:00Z'));
  // Section 4.3: the military letters (every one but J) and any other alphabetic zone are read as -0000.
  for (const letter of ['A', 'M', 'N', 'Y', 'Z', 'z']) expect(zone(letter)).toBe(at('2000-01-01T12:00:00Z'));
  expect(zone('UTC')).toBe(at('2000-01-01T12:00:00Z'));
  expect(zone('-0000')).toBe(at('2000-01-01T12:00:00Z'));

  // Section 4.3: 00 to 49 are 20xx, 50 to 99 are 19xx, and any three digit year has 1900 added. Never the cookie rule.
  const year = (digits: string): number | null => parseMailDate(`1 Jan ${digits} 00:00:00 +0000`);
  expect(year('00')).toBe(at('2000-01-01T00:00:00Z'));
  expect(year('49')).toBe(at('2049-01-01T00:00:00Z'));
  expect(year('50')).toBe(at('1950-01-01T00:00:00Z'));
  expect(year('69')).toBe(at('1969-01-01T00:00:00Z'));
  expect(year('70')).toBe(at('1970-01-01T00:00:00Z'));
  expect(year('99')).toBe(at('1999-01-01T00:00:00Z'));
  expect(year('100')).toBe(at('2000-01-01T00:00:00Z'));
  expect(year('099')).toBe(at('1999-01-01T00:00:00Z'));
  expect(year('1900')).toBe(at('1900-01-01T00:00:00Z'));

  // Section 3.3: a year under 1900 in four digits, a day past the month, a minute of 60 and an hour of 24 are not dates.
  expect(year('1899')).toBeNull();
  expect(year('12345')).toBeNull();
  expect(parseMailDate('31 Feb 2000 00:00:00 +0000')).toBeNull();
  expect(parseMailDate('29 Feb 2000 00:00:00 +0000')).toBe(at('2000-02-29T00:00:00Z'));
  expect(parseMailDate('29 Feb 1900 00:00:00 +0000')).toBeNull();
  expect(parseMailDate('32 Jan 2000 00:00:00 +0000')).toBeNull();
  expect(parseMailDate('1 Jan 2000 24:00:00 +0000')).toBeNull();
  expect(parseMailDate('1 Jan 2000 00:60:00 +0000')).toBeNull();
  expect(parseMailDate('1 Jan 2000 00:00:00 +0060')).toBeNull();
  expect(parseMailDate('1 Jan 2000 00:00:00')).toBeNull();
  expect(parseMailDate('1 Jan 2000 00:00:00 +0000 extra')).toBeNull();
  expect(parseMailDate('')).toBeNull();
  expect(parseMailDate('not a date')).toBeNull();

  // The lenient order RFC 8601 Appendix B.1 uses (month before day) is read, and the result says it was lenient.
  const lenient = readMailDate('Fri, Feb 15 2002 17:19:07 -0800');
  expect(lenient?.ms).toBe(at('2002-02-16T01:19:07Z'));
  expect(lenient?.lenient).toBe(true);
  expect(lenient?.notes.join(' ')).toContain('month before the day');
  expect(readMailDate('Fri, 15 Feb 2002 17:19:07 -0800')?.lenient).toBe(false);

  // What was assumed is said: the obsolete zone, the military letter and the two digit year.
  expect(readMailDate('1 Jan 49 12:00:00 EST')?.notes.join(' ')).toMatch(/EST.*-0500/);
  expect(readMailDate('1 Jan 49 12:00:00 EST')?.notes.join(' ')).toContain('2049');
  expect(readMailDate('1 Jan 2000 12:00:00 Z')?.notes.join(' ')).toContain('-0000');
});

it('a negative delay is shown as a clock note, not an error', async () => {
  // RFC 8617 Appendix B: four Received lines whose stated times do not run in order. The line at the bottom (clochette) is
  // the first hop, at 15:03:15, and the line before it in the list (segv) states 15:00:01, which is 194 seconds earlier.
  const analysis = await analyzeMessage(
    build(
      [
        'Return-Path: <jqd@d1.example>',
        'Received: from example.org (example.org [208.69.40.157])',
        '    by gmail.example with ESMTP id d200mr22663000ykb.93.1421363207',
        '    for <fmartin@example.com>; Thu, 14 Jan 2015 15:02:40 -0800 (PST)',
        'Received: from segv.d1.example (segv.d1.example [72.52.75.15])',
        '    by lists.example.org (8.14.5/8.14.5) with ESMTP id t0EKaNU9010123',
        '    for <arc@example.org>; Thu, 14 Jan 2015 15:01:30 -0800 (PST)',
        '    (envelope-from jqd@d1.example)',
        'Received: from [2001:DB8::1A] (w-x-y-z.dsl.static.isp.example [w.x.y.z])',
        '    (authenticated bits=0)',
        '    by segv.d1.example with ESMTP id t0FN4a8O084569;',
        '    Thu, 14 Jan 2015 15:00:01 -0800 (PST)',
        '    (envelope-from jqd@d1.example)',
        'Received: from mail-ob0-f188.google.example',
        '    (mail-ob0-f188.google.example [208.69.40.157]) by',
        '    clochette.example.org with ESMTP id d200mr22663000ykb.93.1421363268',
        '    for <fmartin@example.org>; Thu, 14 Jan 2015 15:03:15 -0800 (PST)',
        'Date: Thu, 14 Jan 2015 15:00:01 -0800',
        'From: John Q Doe <jqd@d1.example>',
        'To: arc@dmarc.example',
        'Subject: [List 2] Example 1',
      ],
      'Hey gang,\r\nThis is a test message.\r\n--J.\r\n',
    ),
  );
  expect(analysis.hops.map((hop) => hop.from)).toEqual([
    'mail-ob0-f188.google.example',
    '[2001:DB8::1A]',
    'segv.d1.example',
    'example.org',
  ]);
  expect(analysis.hops.map((hop) => hop.time)).toEqual([
    '2015-01-14 23:03:15',
    '2015-01-14 23:00:01',
    '2015-01-14 23:01:30',
    '2015-01-14 23:02:40',
  ]);
  expect(analysis.hops.map((hop) => hop.delaySeconds)).toEqual([null, -194, 89, 70]);
  expect(analysis.hops.map((hop) => hop.delay)).toEqual(['', '-3 min 14 s', '1 min 29 s', '1 min 10 s']);
  // The negative delay is a note on that hop and in the list of observations; nothing is thrown and nothing is called wrong.
  expect(analysis.hops[1]?.note).toContain('clocks');
  expect(analysis.hops[0]?.note).toBe('');
  expect(analysis.hops[2]?.note).toBe('');
  expect(analysis.observations.join(' ')).toContain('earlier than the line before it');
  for (const text of [...analysis.hops.map((h) => h.note), ...analysis.observations]) {
    expect(text).not.toMatch(/error|forged|fake|spoof|unsafe|safe|verified|trusted/i);
  }
  // The same clock note appears for a hop with no stated date, which has no delay at all.
  const missing = await analyzeMessage(
    build(
      [
        'Received: from b.example by c.example; 21 Nov 1997 10:05:43 -0600',
        'Received: from a.example by b.example',
        'From: a@example.com',
      ],
      'x',
    ),
  );
  expect(missing.hops.map((hop) => hop.delay)).toEqual(['', '']);
  expect(missing.hops[0]?.note).toContain('no date');
});

it('observations name what differs and never call a message safe or unsafe', async () => {
  // A message with a different Return-Path domain, a Reply-To elsewhere, two Subject lines, no Message-ID, a DKIM signature
  // that leaves From out of h, and a Date three days after the oldest Received line.
  const analysis = await analyzeMessage(
    build(
      [
        'Return-Path: <bounce@mailer.example.net>',
        'Received: from a.example by b.example; Tue, 06 Oct 2026 10:00:00 +0000',
        'DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel1; h=to:subject; bh=AA==; b=AA==',
        'From: Jo <jo@example.com>',
        'Reply-To: Jo Elsewhere <jo@elsewhere.example>',
        'To: Alice <alice@example.org>',
        'Subject: one',
        'Subject: two',
        'Date: Fri, 09 Oct 2026 10:00:00 +0000',
      ],
      'Hello.',
    ),
  );
  const text = analysis.observations.join('\n');
  expect(text).toContain(
    'The From address is at example.com and the Return-Path address is at mailer.example.net: the domains differ.',
  );
  expect(text).toContain('Reply-To names jo@elsewhere.example, which is not the From address');
  expect(text).toContain('The message has no Message-ID header.');
  expect(text).toContain('The Subject header appears 2 times, and RFC 5322 section 3.6 allows it once.');
  expect(text).toContain('does not list From in h=');
  expect(text).toContain('state times about 72 hours apart, more than 24 hours');
  expect(text).not.toContain('The message has no Date header.');
  // Never a verdict, and never a word that says a claim was checked.
  expect(text).not.toMatch(/\b(safe|unsafe|trusted|verified|forged|fake|spoof\w*|phish\w*|genuine|authentic)\b/i);

  // A plain message gives nothing to look at, and the checks are about the headers, so a missing Date is one observation.
  const plain = await analyzeMessage(
    build(
      [
        'From: Jo <jo@example.com>',
        'Return-Path: <jo@example.com>',
        'Reply-To: Jo <JO@example.com>',
        'Message-ID: <m@example.com>',
        'Date: Tue, 06 Oct 2026 10:00:00 +0000',
      ],
      'Hello.',
    ),
  );
  expect(plain.observations).toEqual([]);
  const noDate = await analyzeMessage(build(['From: Jo <jo@example.com>', 'Message-ID: <m@example.com>'], 'Hello.'));
  expect(noDate.observations).toEqual(['The message has no Date header.']);

  // A Date within 24 hours of the oldest hop is not remarked on, and one 24 hours and a second away is.
  const near = async (offsetSeconds: number): Promise<string[]> => {
    const date = new Date(Date.UTC(2026, 9, 6, 10, 0, 0) + offsetSeconds * 1000);
    const two = (n: number): string => String(n).padStart(2, '0');
    const stated = `${date.getUTCDate()} Oct 2026 ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`;
    const result = await analyzeMessage(
      build(
        [
          'Received: from a.example by b.example; 6 Oct 2026 10:00:00 +0000',
          'From: Jo <jo@example.com>',
          'Message-ID: <m@example.com>',
          `Date: ${stated}`,
        ],
        'x',
      ),
    );
    return result.observations;
  };
  expect(await near(86_400)).toEqual([]);
  expect((await near(86_401)).join(' ')).toContain('more than 24 hours');
  expect((await near(-86_401)).join(' ')).toContain('more than 24 hours');
});
