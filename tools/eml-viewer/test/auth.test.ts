/**
 * Authentication-Results, DKIM-Signature and ARC headers: read as claims, never checked.
 *
 * Expected values come from RFC 8601 Appendix B.1 to B.7 (the Authentication-Results examples, B.7 being the comment-heavy
 * one), RFC 6376 sections 3.2 and 3.5 and the headers of its Appendix A, and RFC 8617 sections 4.1, 4.2 and Appendix B.
 * Each literal is retyped with its RFC and section in a comment. No body hash or signature is ever computed (that would
 * need DNS), so nothing here compares a hash.
 */
import { it, expect } from 'vitest';
import { analyzeMessage, groupArc, parseAuthenticationResults, parseDkimSignature } from '../src/index';
import { build } from './helpers';

const result = (
  method: string,
  value: string,
  properties: [string, string, string][] = [],
  extra: { reason?: string; methodVersion?: string } = {},
) => ({
  method,
  methodVersion: extra.methodVersion ?? '',
  result: value,
  reason: extra.reason ?? '',
  properties: properties.map(([ptype, property, v]) => ({ ptype, property, value: v })),
});

it('the RFC 8601 Appendix B Authentication-Results examples parse to their servers, methods, results and properties', () => {
  // RFC 8601 Appendix B.2: a header with no authentication done.
  expect(parseAuthenticationResults('example.org 1; none')).toMatchObject({
    serverId: 'example.org',
    version: '1',
    noResult: true,
    results: [],
  });

  // Appendix B.3.
  expect(parseAuthenticationResults('example.com;\r\n          spf=pass smtp.mailfrom=example.net')).toMatchObject({
    serverId: 'example.com',
    version: '',
    noResult: false,
    results: [result('spf', 'pass', [['smtp', 'mailfrom', 'example.net']])],
  });

  // Appendix B.4: two header fields from one server; a comment sits after the first result.
  expect(
    parseAuthenticationResults(
      'example.com;\r\n          auth=pass (cram-md5) smtp.auth=sender@example.net;\r\n          spf=pass smtp.mailfrom=example.net',
    ),
  ).toMatchObject({
    serverId: 'example.com',
    results: [
      result('auth', 'pass', [['smtp', 'auth', 'sender@example.net']]),
      result('spf', 'pass', [['smtp', 'mailfrom', 'example.net']]),
    ],
  });
  expect(parseAuthenticationResults('example.com; iprev=pass\r\n          policy.iprev=192.0.2.200')).toMatchObject({
    serverId: 'example.com',
    results: [result('iprev', 'pass', [['policy', 'iprev', '192.0.2.200']])],
  });

  // Appendix B.5: two servers, each with its own header field.
  expect(
    parseAuthenticationResults('example.com;\r\n          dkim=pass (good signature) header.d=example.com'),
  ).toMatchObject({ serverId: 'example.com', results: [result('dkim', 'pass', [['header', 'd', 'example.com']])] });
  expect(
    parseAuthenticationResults(
      'example.com;\r\n          auth=pass (cram-md5) smtp.auth=sender@example.com;\r\n          spf=fail smtp.mailfrom=example.com',
    ),
  ).toMatchObject({
    results: [
      result('auth', 'pass', [['smtp', 'auth', 'sender@example.com']]),
      result('spf', 'fail', [['smtp', 'mailfrom', 'example.com']]),
    ],
  });

  // Appendix B.6: the reason= clause, with a quoted value, and a second server.
  expect(
    parseAuthenticationResults(
      'example.com;\r\n      dkim=pass reason="good signature"\r\n        header.i=@mail-router.example.net;\r\n      dkim=fail reason="bad signature"\r\n        header.i=@newyork.example.com',
    ),
  ).toMatchObject({
    serverId: 'example.com',
    results: [
      result('dkim', 'pass', [['header', 'i', '@mail-router.example.net']], { reason: 'good signature' }),
      result('dkim', 'fail', [['header', 'i', '@newyork.example.com']], { reason: 'bad signature' }),
    ],
  });
  expect(
    parseAuthenticationResults('example.net;\r\n      dkim=pass (good signature) header.i=@newyork.example.com'),
  ).toMatchObject({
    serverId: 'example.net',
    results: [result('dkim', 'pass', [['header', 'i', '@newyork.example.com']])],
  });

  // Appendix B.7, the comment-heavy example: foo.example.net, version 1, dkim version 1, fail, policy.expired 1362471462.
  const b7 = parseAuthenticationResults(
    "foo.example.net (foobar) 1 (baz);\r\n    dkim (Because I like it) / 1 (One yay) = (wait for it) fail\r\n      policy (A dot can go here) . (like that) expired\r\n        (this surprised me) = (as I wasn't expecting it) 1362471462",
  );
  expect(b7.serverId).toBe('foo.example.net');
  expect(b7.version).toBe('1');
  expect(b7.noResult).toBe(false);
  expect(b7.results).toEqual([result('dkim', 'fail', [['policy', 'expired', '1362471462']], { methodVersion: '1' })]);
  expect(b7.notes).toEqual([]);

  // RFC 8617 Appendix B: the payload of an ARC-Authentication-Results field after its instance, with a nested comment.
  const aar = parseAuthenticationResults(
    'clochette.example.org; spf=fail\r\n    smtp.from=jqd@d1.example; dkim=fail (512-bit key)\r\n    header.i=@d1.example; dmarc=fail; arc=pass (as.2.gmail.example=pass,\r\n    ams.2.gmail.example=pass, as.1.lists.example.org=pass,\r\n    ams.1.lists.example.org=fail (message has been altered))',
  );
  expect(aar.serverId).toBe('clochette.example.org');
  expect(aar.results.map((r) => `${r.method}=${r.result}`)).toEqual([
    'spf=fail',
    'dkim=fail',
    'dmarc=fail',
    'arc=pass',
  ]);
  expect(aar.results[0]?.properties).toEqual([{ ptype: 'smtp', property: 'from', value: 'jqd@d1.example' }]);
  expect(aar.results[2]?.properties).toEqual([]);

  // A value that holds an equals sign (a truncated signature) stays whole, and spaces around equals signs are tolerated.
  const spaced = parseAuthenticationResults('mx.example.org; dkim = pass header.b=AbCdEf==  header.d = example.com');
  expect(spaced.results).toEqual([
    result('dkim', 'pass', [
      ['header', 'b', 'AbCdEf=='],
      ['header', 'd', 'example.com'],
    ]),
  ]);

  // The server name alone, a header with no server and the no-result keyword with comments are each read plainly.
  expect(parseAuthenticationResults('mx.example.org').results).toEqual([]);
  expect(parseAuthenticationResults('mx.example.org').notes.join(' ')).toContain('no results');
  expect(parseAuthenticationResults('mx.example.org (x); (y) none (z)')).toMatchObject({ noResult: true, results: [] });
});

it('DKIM-Signature tags are read and checked against RFC 6376 rules', () => {
  // RFC 6376 section 3.5, the informative example with z=: the tags, the lookup name as text, x after t, i inside d.
  const section35 = parseDkimSignature(
    'v=1; a=rsa-sha256; d=example.net; s=brisbane;\r\n   c=simple; q=dns/txt; i=@eng.example.net;\r\n   t=1117574938; x=1118006938;\r\n   h=from:to:subject:date;\r\n   z=From:foo@eng.example.net|To:joe@example.com|\r\n    Subject:demo=20run|Date:July=205,=202005=203:44:08=20PM=20-0700;\r\n   bh=MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=;\r\n   b=dzdVyOfAKCdLXdJOc9G2q8LoXSlEniSbav+yuU4zGeeruD00lszZVoG4ZHRNiYzR',
  );
  expect(section35.wellFormed).toBe(true);
  expect(section35.issues).toEqual([]);
  expect(section35.domain).toBe('example.net');
  expect(section35.selector).toBe('brisbane');
  expect(section35.lookupName).toBe('brisbane._domainkey.example.net');
  expect(section35.identity).toBe('@eng.example.net');
  expect(section35.headersSigned).toEqual(['from', 'to', 'subject', 'date']);
  expect(section35.tags.map((row) => row.tag)).toEqual([
    'v',
    'a',
    'd',
    's',
    'c',
    'q',
    'i',
    't',
    'x',
    'h',
    'z',
    'bh',
    'b',
  ]);
  const row = (tag: string): { value: string; meaning: string; note: string } => {
    const found = section35.tags.find((r) => r.tag === tag);
    if (found === undefined) throw new Error(`no row for ${tag}`);
    return found;
  };
  // 1117574938 seconds after the epoch, worked out here by hand: 2005-05-31 21:48:58 UTC.
  expect(Date.UTC(2005, 4, 31, 21, 48, 58) / 1000).toBe(1117574938);
  expect(row('t').value).toBe('1117574938');
  expect(row('t').note).toContain('2005-05-31 21:48:58 UTC');
  expect(row('x').note).toContain('2005-06-05 21:48:58 UTC');
  // z is dkim-quoted-printable with white space removed before decoding: the =20 sequences are spaces.
  expect(row('z').note).toContain('Subject:demo run');
  expect(row('z').note).toContain('Date:July 5, 2005 3:44:08 PM -0700');

  // RFC 6376 Appendix A.2: h with spaces around the colons, an i= inside d=, b with white space inside it.
  const appendixA = parseDkimSignature(
    'v=1; a=rsa-sha256; s=brisbane; d=example.com;\r\n        c=simple/simple; q=dns/txt; i=joe@football.example.com;\r\n        h=Received : From : To : Subject : Date : Message-ID;\r\n        bh=2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=;\r\n        b=AuUoFEfDxTDkHlLXSZEpZj79LICEps6eda7W3deTVFOk4yAUoqOB\r\n        4nujc7YopdG5dWLSdNg6xNAZpOPr+kHxt1IrE+NahM6L/LbvaHut\r\n        KVdkLLkpVaVVQPzeRDI009SO2Il5Lu7rDNH6mZckBdrIx0orEtZV\r\n        4bmp/YzhwvcubU4=',
    'football.example.com',
  );
  expect(appendixA.wellFormed).toBe(true);
  expect(appendixA.issues).toEqual([]);
  expect(appendixA.headersSigned).toEqual(['received', 'from', 'to', 'subject', 'date', 'message-id']);
  expect(appendixA.fromSigned).toBe(true);
  const b = appendixA.tags.find((r) => r.tag === 'b');
  expect(b?.value).toBe(
    'AuUoFEfDxTDkHlLXSZEpZj79LICEps6eda7W3deTVFOk4yAUoqOB4nujc7YopdG5dWLSdNg6xNAZpOPr+kHxt1IrE+NahM6L/LbvaHutKVdkLLkpVaVVQPzeRDI009SO2Il5Lu7rDNH6mZckBdrIx0orEtZV4bmp/YzhwvcubU4=',
  );
  expect(appendixA.tags.find((r) => r.tag === 'bh')?.value).toBe('2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=');
  // The From domain is a subdomain of d=, and the page says that is approximate: no public suffix list is consulted.
  expect(appendixA.alignment).toContain('subdomain');
  expect(appendixA.alignment).toContain('approximate');

  // RFC 8601 Appendix B.5: the elided b= value keeps its dots once the white space is taken out, and is flagged as not Base64.
  const b5 = parseDkimSignature(
    'v=1; a=rsa-sha256; s=gatsby; d=example.com;\r\n          t=1188964191; c=simple/simple; h=From:Date:To:Subject:\r\n          Message-Id:Authentication-Results;\r\n          bh=sEuZGD/pSr7ANysbY3jtdaQ3Xv9xPQtS0m70;\r\n          b=EToRSuvUfQVP3Bkz ... rTB0t0gYnBVCM=',
  );
  expect(b5.headersSigned).toEqual(['from', 'date', 'to', 'subject', 'message-id', 'authentication-results']);
  expect(b5.tags.find((r) => r.tag === 'b')?.value).toBe('EToRSuvUfQVP3Bkz...rTB0t0gYnBVCM=');
  expect(b5.tags.find((r) => r.tag === 'b')?.note).toContain('Base64');

  // RFC 6376 section 3.2: a tag that occurs twice makes the whole tag-list invalid, and the tags are still listed.
  const repeated = parseDkimSignature('v=1; a=rsa-sha256; d=example.com; d=example.org; s=x; h=from; bh=AA==; b=AA==');
  expect(repeated.wellFormed).toBe(false);
  expect(repeated.issues.join(' ')).toContain('more than once');
  expect(repeated.tags.filter((r) => r.tag === 'd')).toHaveLength(2);

  // Section 3.2: tag names are case sensitive (D is an unknown tag and d is then missing), and unknown tags are ignored.
  const upper = parseDkimSignature('v=1; a=rsa-sha256; D=example.com; s=x; h=from; bh=AA==; b=AA==');
  expect(upper.wellFormed).toBe(true);
  expect(upper.tags.find((r) => r.tag === 'D')?.note).toContain('ignored');
  expect(upper.issues.join(' ')).toContain('The required tag d is missing');
  const unknown = parseDkimSignature('v=1; a=rsa-sha256; d=example.com; s=x; h=from; bh=AA==; b=AA==; foo=bar');
  expect(unknown.wellFormed).toBe(true);
  expect(unknown.issues).toEqual([]);
  expect(unknown.tags.find((r) => r.tag === 'foo')?.note).toContain('ignored');

  // Section 3.5: x must be greater than t; i must be d or a subdomain of it (a longer name that merely ends with it is not).
  const base = 'v=1; a=rsa-sha256; d=example.com; s=x; h=from; bh=AA==; b=AA==';
  expect(parseDkimSignature(`${base}; t=100; x=101`).issues).toEqual([]);
  expect(parseDkimSignature(`${base}; t=100; x=100`).issues.join(' ')).toContain('x is not greater than t');
  expect(parseDkimSignature(`${base}; t=100; x=99`).issues.join(' ')).toContain('x is not greater than t');
  expect(parseDkimSignature(`${base}; i=@example.com`).issues).toEqual([]);
  expect(parseDkimSignature(`${base}; i=joe@mail.example.com`).issues).toEqual([]);
  expect(parseDkimSignature(`${base}; i=@example.org`).issues.join(' ')).toContain('i is not in d');
  expect(parseDkimSignature(`${base}; i=@notexample.com`).issues.join(' ')).toContain('i is not in d');

  // Section 5.4: From must be in h (case does not matter); a signature that leaves it out is flagged.
  expect(parseDkimSignature('v=1; a=rsa-sha256; d=example.com; s=x; h=To:Subject; bh=AA==; b=AA==').fromSigned).toBe(
    false,
  );
  expect(
    parseDkimSignature('v=1; a=rsa-sha256; d=example.com; s=x; h=To:Subject; bh=AA==; b=AA==').issues.join(' '),
  ).toContain('does not list From');
  expect(parseDkimSignature('v=1; a=rsa-sha256; d=example.com; s=x; h=To:FROM; bh=AA==; b=AA==').fromSigned).toBe(true);

  // Section 3.2: a missing required tag is named, a version other than 1 is flagged, a trailing semicolon is allowed,
  // an empty tag between two semicolons and a text that is not a tag list are not well formed.
  expect(parseDkimSignature('v=1; a=rsa-sha256; d=example.com; s=x; h=from; b=AA==').issues.join(' ')).toContain(
    'The required tag bh is missing',
  );
  expect(parseDkimSignature(`${base.replace('v=1', 'v=2')}`).issues.join(' ')).toContain('v is not 1');
  expect(parseDkimSignature(`${base};`).wellFormed).toBe(true);
  expect(parseDkimSignature('v=1;; d=example.com').wellFormed).toBe(false);
  expect(parseDkimSignature('this is not a tag list').wellFormed).toBe(false);
  expect(parseDkimSignature('').wellFormed).toBe(false);

  // Section 3.5: t and x are digits, at most 12 of them.
  expect(parseDkimSignature(`${base}; t=abc`).tags.find((r) => r.tag === 't')?.note).toContain('not a number');
  expect(parseDkimSignature(`${base}; t=1234567890123`).tags.find((r) => r.tag === 't')?.note).toContain('12 digits');

  // The alignment words are approximate and never say more than the names say.
  const same = parseDkimSignature(base, 'example.com');
  expect(same.alignment).toContain('same');
  expect(parseDkimSignature(base, 'EXAMPLE.com').alignment).toContain('same');
  expect(parseDkimSignature(base, 'example.org').alignment).toContain('differ');
  expect(parseDkimSignature(base, 'mail.example.com').alignment).toContain('subdomain');
  expect(parseDkimSignature(base, '').alignment).toBe('');

  // A signature that expired before the message's own Date says it was written.
  const dated = parseDkimSignature(`${base}; t=100; x=200`, '', 1_000_000);
  expect(dated.issues.join(' ')).toContain('before the message');

  // Nothing here claims a signature, a key or a result is checked, trusted or safe.
  const everything = [section35, appendixA, b5, repeated, upper, unknown, dated].flatMap((s) => [
    s.alignment,
    s.lookupName,
    ...s.issues,
    ...s.tags.flatMap((r) => [r.meaning, r.note]),
  ]);
  for (const text of everything) expect(text).not.toMatch(/verif|trust|safe|authentic|genuine/i);

  // Header and tag names that could be keys of a plain object are plain names.
  const proto = parseDkimSignature(`${base}; __proto__=x; constructor=y; toString=z; __proto__=w`);
  expect(proto.wellFormed).toBe(false);
  const protoOnce = parseDkimSignature(`${base}; __proto__=x; constructor=y; toString=z`);
  expect(protoOnce.wellFormed).toBe(true);
  expect(protoOnce.tags.map((r) => r.tag)).toEqual([
    ...'v a d s h bh b'.split(' '),
    '__proto__',
    'constructor',
    'toString',
  ]);
  expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
});

it('ARC headers are grouped by instance number', async () => {
  // RFC 8617 Appendix B: three ARC sets in a message, newest (instance 3) at the top, as a mail system writes them.
  const arcHeaders = [
    [
      'ARC-Seal',
      'i=3; a=rsa-sha256; cv=pass; d=clochette.example.org; s=\r\n        clochette; t=12345; b=CU87XzXlNlk5X/yW4l73UvPUcP9ivwYWxyBWcVrRs7\r\n        +HPx3K05nJhny2fvymbReAmOA9GTH/y+k9kEc59hAKVg==',
    ],
    [
      'ARC-Message-Signature',
      'i=3; a=rsa-sha256; c=relaxed/relaxed; d=\r\n        clochette.example.org; h=message-id:date:from:to:subject; s=\r\n        clochette; t=12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZY\r\n        LQ=; b=o71vwyLsK+Wm4cOSlirXoRwzEvi0vqIjd/2/GkYFYlSd/GGfKzkAgPqxf\r\n        K7ccBMP7Zjb/mpeggswHjEMS8x5NQ==',
    ],
    [
      'ARC-Authentication-Results',
      'i=3; clochette.example.org; spf=fail\r\n    smtp.from=jqd@d1.example; dkim=fail (512-bit key)\r\n    header.i=@d1.example; dmarc=fail; arc=pass (as.2.gmail.example=pass,\r\n    ams.2.gmail.example=pass, as.1.lists.example.org=pass,\r\n    ams.1.lists.example.org=fail (message has been altered))',
    ],
    ['Authentication-Results', 'clochette.example.org; spf=fail smtp.from=jqd@d1.example'],
    [
      'ARC-Seal',
      'i=2; a=rsa-sha256; cv=pass; d=gmail.example; s=20120806; t=\r\n        12345; b=Zpukh/kJL4Q7Kv391FKwTepgS56dgHIcdhhJZjsalhqkFIQQAJ4T9BE\r\n        8jjLXWpRNuh81yqnT1/jHn086RwezGw==',
    ],
    [
      'ARC-Message-Signature',
      'i=2; a=rsa-sha256; c=relaxed/relaxed; d=\r\n        gmail.example; h=message-id:date:from:to:subject; s=20120806; t=\r\n        12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZYLQ=; b=CVoG44\r\n        cVZvoSs2mMig2wwqPaJ4OZS5XGMCegWqQs1wvRZJS894tJM0xO1RJLgCPsBOxdA5\r\n\r\n        9WSqI9s9DfyKDfWg==',
    ],
    [
      'ARC-Authentication-Results',
      'i=2; gmail.example; spf=fail\r\n    smtp.from=jqd@d1.example; dkim=fail (512-bit key)\r\n    header.i=@example.org; dmarc=fail; arc=pass\r\n    (as.1.lists.example.org=pass, ams.1.lists.example.org=pass)',
    ],
    [
      'ARC-Seal',
      'i=1; a=rsa-sha256; cv=none; d=lists.example.org; s=dk-lists;\r\n         t=12345; b=TlCCKzgk3TrAa+G77gYYO8Fxk4q/Ml0biqduZJeOYh6+0zhwQ8u/\r\n        lHxLi21pxu347isLSuNtvIagIvAQna9a5A==',
    ],
    [
      'ARC-Message-Signature',
      'i=1; a=rsa-sha256; c=relaxed/relaxed; d=\r\n        lists.example.org; h=message-id:date:from:to:subject; s=\r\n        dk-lists; t=12345; bh=KWSe46TZKCcDbH4klJPo+tjk5LWJnVRlP5pvjXFZYL\r\n        Q=; b=DsoD3n3hiwlrN1ma8IZQFgZx8EDO7Wah3hUjIEsYKuShRKYB4LwGUiKD5Y\r\n        yHgcIwGHhSc/4+ewYqHMWDnuFxiQ==',
    ],
    [
      'ARC-Authentication-Results',
      'i=1; lists.example.org; spf=pass\r\n    smtp.mfrom=jqd@d1.example; dkim=pass (512-bit key)\r\n    header.i=@d1.example; dmarc=pass',
    ],
    ['DKIM-Signature', 'v=1; a=rsa-sha1; c=relaxed/relaxed; d=d1.example; s=origin2015'],
  ].map(([name, value], i) => ({ index: i + 1, name: name ?? '', value: value ?? '' }));

  const grouped = groupArc(arcHeaders);
  expect(grouped.notes).toEqual([]);
  expect(grouped.sets.map((set) => set.instance)).toEqual([1, 2, 3]);
  for (const set of grouped.sets) {
    expect(set.seal).not.toBeNull();
    expect(set.signature).not.toBeNull();
    expect(set.authResults).not.toBeNull();
    expect(set.issues).toEqual([]);
  }
  const [one, two, three] = grouped.sets;
  expect(one?.seal).toMatchObject({ header: 8, domain: 'lists.example.org', selector: 'dk-lists', cv: 'none' });
  expect(two?.seal).toMatchObject({ header: 5, domain: 'gmail.example', selector: '20120806', cv: 'pass' });
  expect(three?.seal).toMatchObject({ header: 1, domain: 'clochette.example.org', selector: 'clochette', cv: 'pass' });
  expect(one?.signature).toMatchObject({ header: 9, domain: 'lists.example.org', selector: 'dk-lists' });
  expect(one?.signature?.signedHeaders).toEqual(['message-id', 'date', 'from', 'to', 'subject']);
  expect(one?.authResults?.serverId).toBe('lists.example.org');
  expect(one?.authResults?.results.map((r) => `${r.method}=${r.result}`)).toEqual([
    'spf=pass',
    'dkim=pass',
    'dmarc=pass',
  ]);
  expect(three?.authResults?.results.map((r) => `${r.method}=${r.result}`)).toEqual([
    'spf=fail',
    'dkim=fail',
    'dmarc=fail',
    'arc=pass',
  ]);
  // The summary says what the servers wrote and that these are claims.
  expect(one?.summary).toContain('lists.example.org');
  expect(one?.summary).toContain('cv=none');
  expect(three?.summary).toContain('spf=fail');

  // The header called Authentication-Results and the DKIM signature are not ARC headers.
  expect(
    grouped.sets.flatMap((set) => [set.seal?.header, set.signature?.header, set.authResults?.header]),
  ).not.toContain(4);
  expect(
    grouped.sets.flatMap((set) => [set.seal?.header, set.signature?.header, set.authResults?.header]),
  ).not.toContain(11);

  // Names are matched without regard to letter case, and no ARC headers give no sets.
  expect(
    groupArc([{ index: 1, name: 'arc-seal', value: 'i=1; a=rsa-sha256; cv=none; d=a.example; s=s1' }]).sets,
  ).toHaveLength(1);
  expect(groupArc([{ index: 1, name: 'Subject', value: 'hello' }])).toEqual({ sets: [], notes: [] });

  // RFC 8617 section 4.2: a valid set has exactly one of each header. A missing header, a repeated one, a gap in the
  // numbers, an instance outside 1 to 50, an ARC-Seal with an h tag and a last seal with cv=fail are each said.
  const partial = groupArc([
    { index: 1, name: 'ARC-Seal', value: 'i=2; a=rsa-sha256; cv=pass; d=a.example; s=s1' },
    { index: 2, name: 'ARC-Seal', value: 'i=2; a=rsa-sha256; cv=pass; d=b.example; s=s2' },
    { index: 3, name: 'ARC-Message-Signature', value: 'i=4; a=rsa-sha256; d=a.example; s=s1; h=from' },
    { index: 4, name: 'ARC-Authentication-Results', value: 'i=51; a.example; none' },
    { index: 5, name: 'ARC-Seal', value: 'a=rsa-sha256; cv=none; d=a.example; s=s1' },
  ]);
  expect(partial.sets.map((set) => set.instance)).toEqual([2, 4, 51]);
  expect(partial.sets[0]?.issues.join(' ')).toContain('more than one ARC-Seal');
  expect(partial.sets[0]?.issues.join(' ')).toContain('no ARC-Message-Signature');
  expect(partial.sets[1]?.issues.join(' ')).toContain('no ARC-Seal');
  expect(partial.sets[2]?.issues.join(' ')).toContain('between 1 and 50');
  expect(partial.notes.join(' ')).toContain('not consecutive');
  expect(partial.notes.join(' ')).toContain('no readable instance number');
  const withH = groupArc([
    { index: 1, name: 'ARC-Seal', value: 'i=1; a=rsa-sha256; cv=none; d=a.example; s=s1; h=from' },
  ]);
  expect(withH.sets[0]?.issues.join(' ')).toContain('h tag');
  const failed = groupArc([
    { index: 1, name: 'ARC-Seal', value: 'i=1; a=rsa-sha256; cv=fail; d=a.example; s=s1' },
    { index: 2, name: 'ARC-Message-Signature', value: 'i=1; a=rsa-sha256; d=a.example; s=s1; h=from' },
    { index: 3, name: 'ARC-Authentication-Results', value: 'i=1; a.example; none' },
  ]);
  expect(failed.sets[0]?.issues.join(' ')).toContain('cv=fail');

  // Through the whole message: the sets come out of analyzeMessage, and so do the Authentication-Results rows.
  const analysis = await analyzeMessage(
    build(
      [
        ...arcHeaders.map((h) => `${h.name}: ${h.value.replace(/\r\n\s*/g, ' ')}`),
        'From: John Q Doe <jqd@d1.example>',
        'Date: Thu, 14 Jan 2015 15:00:01 -0800',
      ],
      'Hello.',
    ),
  );
  expect(analysis.arc.map((set) => set.instance)).toEqual([1, 2, 3]);
  expect(analysis.authResults.some((row) => row.method === 'spf' && row.result === 'fail')).toBe(true);
});
