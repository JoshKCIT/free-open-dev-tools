import { expect, it } from 'vitest';
import { MAX_AGE_LIMIT_SECONDS, maskValue } from '../src/index';
import { inspect, NOW, one } from './helpers';

// Expected values are worked out from draft-ietf-httpbis-rfc6265bis-22 (1 December 2025): the section is named beside
// each group. The fixed time is Tuesday 6 October 2026 12:00:00 UTC and the address is https://site.example/account/login.

const DAY = 86_400;

it('name plus value of 4,096 octets is stored and 4,097 is ignored, counted in UTF-8 octets', () => {
  // Section 5.6 step 5 and 5.7 step 4: more than 4096 octets for the name and value together ignores the cookie.
  const a = (n: number): string => 'a'.repeat(n);
  expect(one(`${a(2048)}=${a(2048)}`).decision.outcome).toBe('stored');
  const over = one(`${a(2048)}=${a(2049)}`);
  expect(over.decision.outcome).toBe('ignored');
  expect(over.octets).toBe(4097);
  expect(over.decision.failedStep).toMatchObject({ section: '5.6', step: 5 });
  expect(over.decision.reason).toContain('4,097');
  // A nameless cookie counts its value only: 4,096 is stored, 4,097 is ignored, with or without a leading equals sign.
  expect(one(`=${a(4096)}`).decision.outcome).toBe('stored');
  expect(one(`=${a(4097)}`).decision.outcome).toBe('ignored');
  expect(one(a(4096)).decision.outcome).toBe('stored');
  expect(one(a(4097)).decision.outcome).toBe('ignored');
  // The equals sign, the attributes and the spaces around the name and value do not count.
  expect(one(`${a(1)}=${a(4095)}; Path=/${a(500)}`).decision.outcome).toBe('stored');
  expect(one(`  ${a(1)}  =  ${a(4095)}  `).decision.outcome).toBe('stored');
  // Octets, not characters: a two-byte character counts 2, a three-byte one 3 and a character outside the basic plane 4.
  const twoByte = String.fromCodePoint(0xe9);
  const threeByte = String.fromCodePoint(0x20ac);
  const fourByte = String.fromCodePoint(0x1f600);
  const stored2 = one(`n=${twoByte.repeat(2047)}b`);
  expect(stored2.octets).toBe(4096);
  expect(stored2.decision.outcome).toBe('stored');
  expect(one(`n=${twoByte.repeat(2048)}`).octets).toBe(4097);
  expect(one(`n=${twoByte.repeat(2048)}`).decision.outcome).toBe('ignored');
  expect(one(`n=${threeByte.repeat(1365)}`).octets).toBe(4096);
  expect(one(`n=${threeByte.repeat(1366)}`).decision.outcome).toBe('ignored');
  expect(one(`abcd=${fourByte.repeat(1023)}`).octets).toBe(4096);
  expect(one(`abcd=${fourByte.repeat(1023)}`).decision.outcome).toBe('stored');
  expect(one(`abcde=${fourByte.repeat(1023)}`).decision.outcome).toBe('ignored');
});

it('an attribute value of 1,024 octets is used and one of 1,025 is ignored', () => {
  // Section 5.6 step 6: an attribute value longer than 1024 octets is ignored; the cookie itself is kept.
  const path1024 = `/${'p'.repeat(1023)}`;
  const used = one(`a=1; Path=${path1024}`);
  expect(used.attributes[0]).toMatchObject({ kind: 'path', use: 'used' });
  expect(used.decision.scope?.path).toBe(path1024);
  const path1025 = `${path1024}p`;
  const ignored = one(`a=1; Path=${path1025}`);
  expect(ignored.attributes[0]).toMatchObject({ kind: 'path', use: 'ignored' });
  expect(ignored.attributes[0]?.reason).toContain('1,024');
  expect(ignored.decision.outcome).toBe('stored');
  // The path of the response address (/account/login) gives the default path /account.
  expect(ignored.decision.scope?.path).toBe('/account');
  // Octets again: 1,024 octets with a two-byte character is used, 1,025 is ignored.
  const twoByte = String.fromCodePoint(0xe9);
  expect(one(`a=1; Path=/${twoByte.repeat(511)}a`).attributes[0]?.use).toBe('used');
  expect(one(`a=1; Path=/${twoByte.repeat(512)}`).attributes[0]?.use).toBe('ignored');
  // The limit applies to every attribute, a Max-Age and an unknown one included.
  expect(one(`a=1; Max-Age=${'0'.repeat(1024)}`).attributes[0]?.use).toBe('used');
  expect(one(`a=1; Max-Age=${'0'.repeat(1025)}`).attributes[0]?.use).toBe('ignored');
  expect(one(`a=1; x=${'y'.repeat(1025)}`).attributes[0]?.reason).toContain('1,024');
  // A Domain over the limit is ignored, so the cookie stays host-only.
  expect(one(`a=1; Domain=${'d'.repeat(1025)}`).decision.scope?.hostOnly).toBe(true);
});

it('Max-Age wins over Expires and the last of each attribute is used', () => {
  // Section 5.7 step 6: Max-Age sets the lifetime and Expires is not looked at when a Max-Age counts.
  const inThirtyDays = 'Thu, 05 Nov 2026 12:00:00 GMT';
  for (const line of [`a=1; Expires=${inThirtyDays}; Max-Age=60`, `a=1; Max-Age=60; Expires=${inThirtyDays}`]) {
    const row = one(line);
    expect(row.decision.lifetime).toMatchObject({ kind: 'persistent', source: 'Max-Age', seconds: 60 });
    const expires = row.attributes.find((attribute) => attribute.kind === 'expires');
    expect(expires?.use).toBe('ignored');
    expect(expires?.reason).toContain('Max-Age');
  }
  // Section 5.7 steps 6, 7, 11 and 17: of an attribute that appears twice, the last one is used.
  const maxAge = one('a=1; Max-Age=60; Max-Age=120');
  expect(maxAge.decision.lifetime?.seconds).toBe(120);
  expect(maxAge.attributes.map((attribute) => attribute.use)).toEqual(['ignored', 'used']);
  expect(maxAge.attributes[0]?.reason).toContain('later Max-Age');
  // A later attribute that is itself ignored does not replace an earlier valid one.
  const invalidLater = one('a=1; Max-Age=60; Max-Age=abc');
  expect(invalidLater.decision.lifetime?.seconds).toBe(60);
  expect(invalidLater.attributes.map((attribute) => attribute.use)).toEqual(['used', 'ignored']);
  const expiresTwice = one(`a=1; Expires=${inThirtyDays}; Expires=Wed, 07 Oct 2026 12:00:00 GMT`);
  expect(expiresTwice.decision.lifetime).toMatchObject({ source: 'Expires', seconds: DAY });
  expect(expiresTwice.attributes.map((attribute) => attribute.use)).toEqual(['ignored', 'used']);
  const expiresBad = one(`a=1; Expires=${inThirtyDays}; Expires=nonsense`);
  expect(expiresBad.decision.lifetime?.seconds).toBe(30 * DAY);
  expect(expiresBad.attributes.map((attribute) => attribute.use)).toEqual(['used', 'ignored']);
  // Domain, Path and SameSite: the last one counts.
  const domains = one('a=1; Domain=other.example; Domain=site.example');
  expect(domains.decision.scope).toMatchObject({ domain: 'site.example', hostOnly: false });
  expect(domains.attributes.map((attribute) => attribute.use)).toEqual(['ignored', 'used']);
  expect(one('a=1; Domain=site.example; Domain=other.example').decision.outcome).toBe('not-stored');
  expect(one('a=1; Path=/a; Path=/b').decision.scope?.path).toBe('/b');
  expect(one('a=1; SameSite=Strict; SameSite=None; Secure').decision.scope?.sameSite).toBe('None');
  expect(one('a=1; SameSite=None; Secure; SameSite=Lax').decision.scope?.sameSite).toBe('Lax');
  const secureTwice = one('a=1; Secure; Secure');
  expect(secureTwice.attributes.map((attribute) => attribute.use)).toEqual(['ignored', 'used']);
  expect(secureTwice.decision.scope?.secureOnly).toBe(true);
  // A Domain equal to the response host gives a domain cookie, no Domain gives a host-only cookie.
  expect(one('a=1').decision.scope).toMatchObject({ domain: 'site.example', hostOnly: true });
  expect(one('a=1; Domain=site.example').decision.scope).toMatchObject({ domain: 'site.example', hostOnly: false });
  // Section 5.6.3: one leading dot is dropped and the name is put in lower case.
  expect(one('a=1; Domain=.SITE.Example').decision.scope).toMatchObject({ domain: 'site.example', hostOnly: false });
  // An empty Domain is no Domain (section 5.7 step 10: only a non-empty domain-attribute is matched).
  expect(one('a=1; Domain=').decision.scope?.hostOnly).toBe(true);
  // Names of attributes are matched whatever their letter case, and their order is the order written.
  expect(one('a=1; mAx-AgE=5; PATH=/q; secure; httponly').decision.scope).toMatchObject({
    path: '/q',
    secureOnly: true,
    httpOnly: true,
  });
});

it('a lifetime is clamped to 400 days whatever the size of Max-Age or Expires', () => {
  // Section 5.5: a lifetime longer than 400 days (34,560,000 seconds) MUST be reduced to the limit.
  expect(MAX_AGE_LIMIT_SECONDS).toBe(34_560_000);
  const exact = one('a=1; Max-Age=34560000');
  expect(exact.decision.lifetime).toMatchObject({ seconds: 34_560_000, clamped: false });
  const over = one('a=1; Max-Age=34560001');
  expect(over.decision.lifetime).toMatchObject({ seconds: 34_560_000, clamped: true });
  expect(over.decision.lifetime?.expiresAtMs).toBe(NOW + 34_560_000_000);
  // Max-Age is compared as text before a number exists: thirty digits clamp with no overflow, leading zeros do not count.
  expect(one(`a=1; Max-Age=${'9'.repeat(30)}`).decision.lifetime).toMatchObject({ seconds: 34_560_000, clamped: true });
  expect(one(`a=1; Max-Age=${'0'.repeat(30)}34560000`).decision.lifetime).toMatchObject({
    seconds: 34_560_000,
    clamped: false,
  });
  expect(one(`a=1; Max-Age=${'0'.repeat(30)}7`).decision.lifetime).toMatchObject({ seconds: 7, clamped: false });
  // Section 5.6.2 step 7: zero or negative, of any length, deletes the cookie at once.
  for (const value of ['0', '-0', '-1', '-20', `-${'9'.repeat(30)}`, '0'.repeat(40)]) {
    const row = one(`a=1; Max-Age=${value}`);
    expect(row.decision.outcome).toBe('stored-then-deleted');
    expect(row.decision.lifetime?.kind).toBe('deleted');
  }
  // Expires exactly 400 days after the fixed time is kept; one second more is reduced to 400 days.
  const exactly = one('a=1; Expires=Wed, 10 Nov 2027 12:00:00 GMT');
  expect(exactly.decision.lifetime).toMatchObject({ seconds: 34_560_000, clamped: false });
  const oneMore = one('a=1; Expires=Wed, 10 Nov 2027 12:00:01 GMT');
  expect(oneMore.decision.lifetime).toMatchObject({ seconds: 34_560_000, clamped: true });
  expect(oneMore.decision.lifetime?.expiresAtMs).toBe(NOW + 34_560_000_000);
  expect(one('a=1; Expires=Fri, 31 Dec 9999 23:59:59 GMT').decision.lifetime).toMatchObject({
    seconds: 34_560_000,
    clamped: true,
  });
  // An Expires in the past, or at the fixed time, reads Stored, then deleted at once.
  expect(one('a=1; Expires=Sun, 06 Nov 1994 08:49:37 GMT').decision.outcome).toBe('stored-then-deleted');
  expect(one('a=1; Expires=Tue, 06 Oct 2026 12:00:00 GMT').decision.outcome).toBe('stored-then-deleted');
  // A lifetime is whole seconds from the chosen time: one second ahead is a lifetime of 1.
  expect(one('a=1; Expires=Tue, 06 Oct 2026 12:00:01 GMT').decision.lifetime?.seconds).toBe(1);
  // No Max-Age and no Expires: a session cookie.
  expect(one('a=1').decision.lifetime).toMatchObject({ kind: 'session', source: 'none', seconds: null });
});

it('Max-Age is ignored when it is empty, signed with a plus sign, in exponent form or holds a comma or a dot', () => {
  // Section 5.6.2 steps 1 to 3.
  for (const value of ['', '+5', '1e3', '50,399', '2.63,', '1 2', 'abc', '-', '--1', '- 1', '0x10']) {
    const row = one(`a=1; Max-Age=${value}`);
    expect(row.attributes[0]).toMatchObject({ kind: 'max-age', use: 'ignored' });
    expect(row.decision.lifetime?.kind).toBe('session');
  }
  // Spaces around the value are stripped first.
  expect(one('a=1; Max-Age= 30 ').decision.lifetime?.seconds).toBe(30);
  expect(one('a=1; Max-Age').attributes[0]).toMatchObject({ kind: 'max-age', use: 'ignored' });
});

it('an empty or relative Path gives the default path and a Path that starts with a slash is used', () => {
  // Section 5.6.4 and 5.1.4: an empty value or one not starting with / gives the default path of the response address.
  const path = (line: string, url: string): string | undefined => one(line, { url }).decision.scope?.path;
  expect(path('a=1', 'https://site.example/a/b/c')).toBe('/a/b');
  expect(path('a=1', 'https://site.example/a')).toBe('/');
  expect(path('a=1', 'https://site.example/')).toBe('/');
  expect(path('a=1', 'https://site.example')).toBe('/');
  expect(path('a=1; Path=', 'https://site.example/a/b/c')).toBe('/a/b');
  expect(path('a=1; Path=x', 'https://site.example/a/b/c')).toBe('/a/b');
  expect(path('a=1; Path', 'https://site.example/a/b/c')).toBe('/a/b');
  expect(path('a=1; Path=/x/y/', 'https://site.example/a/b/c')).toBe('/x/y/');
  expect(path('a=1; Path=/', 'https://site.example/a/b/c')).toBe('/');
  // The query is not part of the path.
  expect(path('a=1', 'https://site.example/a/b/c?next=/x/y/z')).toBe('/a/b');
});

it('values are masked to their first characters and their length unless revealed', () => {
  // The rule: keep min(4, floor(length / 4)) characters, counted as code points, then the length.
  expect(maskValue('')).toBe('');
  expect(maskValue('abc')).toBe('… (3 characters)');
  expect(maskValue('abcd')).toBe('a… (4 characters)');
  expect(maskValue('abcdefg')).toBe('a… (7 characters)');
  expect(maskValue('abcdefgh')).toBe('ab… (8 characters)');
  expect(maskValue('abcdefghijkl')).toBe('abc… (12 characters)');
  expect(maskValue('abcdefghijklmnop')).toBe('abcd… (16 characters)');
  expect(maskValue('abcdefghijklmnopqrst')).toBe('abcd… (20 characters)');
  const face = String.fromCodePoint(0x1f600);
  expect(maskValue(`a${face}bc`)).toBe('a… (4 characters)');
  expect(maskValue(face.repeat(8))).toBe(`${face}${face}… (8 characters)`);
  // The rows carry the masked value, and the real one only when it is asked for.
  const secret = 'qwertyuiopasdfghjkl';
  const hidden = one(`sid=${secret}; x=${secret}`, { reveal: false });
  expect(hidden.valueShown).toBe('qwer… (19 characters)');
  expect(hidden.value).toBe(secret);
  expect(hidden.attributes[0]?.valueShown).toBe('qwer… (19 characters)');
  expect(JSON.stringify(hidden.decision)).not.toContain(secret);
  expect(hidden.attributes[0]?.name).toBe('x');
  const shown = one(`sid=${secret}; x=${secret}`, { reveal: true });
  expect(shown.valueShown).toBe(secret);
  expect(shown.attributes[0]?.valueShown).toBe(secret);
  // The attributes that carry a setting (a path, a domain, a lifetime) are shown as they are either way.
  expect(hidden.attributes.length).toBe(1);
  expect(one('sid=abcdefgh; Path=/private/area', { reveal: false }).attributes[0]?.valueShown).toBe('/private/area');
});

it('rows follow the pasted line order and attributes keep their written order', () => {
  // Blank lines are skipped and the numbers keep counting them; CR, LF and CRLF all end a line.
  const paste = '\n\nb=2; Path=/account/login; Secure; HttpOnly; SameSite=Lax\r\n   \na=1; Path=/\rc=3';
  const report = inspect(paste);
  expect(report.cookies.map((row) => row.line)).toEqual([3, 5, 6]);
  expect(report.cookies.map((row) => row.name)).toEqual(['b', 'a', 'c']);
  expect(report.cookies[0]?.attributes.map((attribute) => attribute.name)).toEqual([
    'Path',
    'Secure',
    'HttpOnly',
    'SameSite',
  ]);
  expect(report.cookies[0]?.attributes.map((attribute) => attribute.value)).toEqual(['/account/login', '', '', 'Lax']);
  // Section 5.8.3 step 4: cookies with longer paths are listed before cookies with shorter paths; among equal lengths the
  // earlier one comes first. b has /account/login, c has the default path /account, a has /.
  expect(report.sendOrder).toEqual([3, 6, 5]);
  // A cookie that is not stored, or that is deleted at once, is never sent.
  const mixed = inspect('a=1\nb=2; Max-Age=0\nc=3; Secure; Domain=other.example\nd=4; Path=/zzz');
  expect(mixed.sendOrder).toEqual([1]);
  // A Domain cookie and a host-only cookie are both sent back to the host that set them.
  expect(inspect('a=1; Domain=site.example\nb=2').sendOrder).toEqual([1, 2]);
});

it('the section 3.1 and 5.1.4 examples of the draft give the cookies and paths the draft shows', () => {
  // Section 3.1: Set-Cookie: SID=31d4d96e407aad42 gives Cookie: SID=31d4d96e407aad42.
  const first = one('Set-Cookie: SID=31d4d96e407aad42');
  expect(first.name).toBe('SID');
  expect(first.value).toBe('31d4d96e407aad42');
  expect(first.decision.outcome).toBe('stored');
  // Section 3.1: Path=/; Domain=site.example returns the cookie to every path and every subdomain of site.example.
  const scoped = one('Set-Cookie: SID=31d4d96e407aad42; Path=/; Domain=site.example');
  expect(scoped.decision.scope).toMatchObject({ domain: 'site.example', hostOnly: false, path: '/' });
  expect(scoped.sentTo).toContain('subdomains');
  // Section 3.1: two cookies, a session identifier and a language, are both sent back.
  const two = inspect(
    'Set-Cookie: SID=31d4d96e407aad42; Path=/; Secure; HttpOnly\nSet-Cookie: lang=en-US; Path=/; Domain=site.example',
  );
  expect(two.sendOrder).toEqual([1, 2]);
  // Section 3.1: names are case-sensitive, so SID and sid are two cookies.
  const cases = inspect('Set-Cookie: SID=31d4d96e407aad42\nSet-Cookie: sid=31d4d96e407aad42');
  expect(cases.cookies.map((row) => row.name)).toEqual(['SID', 'sid']);
  expect(cases.sendOrder).toEqual([1, 2]);
  // Section 3.1: an Expires of Wed, 09 Jun 2026 10:18:14 GMT, counted from 1 June 2026 00:00:00 UTC, is 8 days, 10 hours,
  // 18 minutes and 14 seconds: 8 x 86400 + 10 x 3600 + 18 x 60 + 14 = 728,294 seconds.
  const persistent = one('Set-Cookie: lang=en-US; Expires=Wed, 09 Jun 2026 10:18:14 GMT', {
    nowMs: Date.UTC(2026, 5, 1, 0, 0, 0),
  });
  expect(persistent.decision.lifetime?.seconds).toBe(728_294);
  // Section 3.1: removing a cookie takes an Expires in the past.
  const removed = one('Set-Cookie: lang=; Expires=Sun, 06 Nov 1994 08:49:37 GMT');
  expect(removed.decision.outcome).toBe('stored-then-deleted');
  expect(removed.value).toBe('');
});
