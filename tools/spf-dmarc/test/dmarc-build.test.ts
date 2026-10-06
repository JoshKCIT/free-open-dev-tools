import { expect, it } from 'vitest';
import {
  SpfDmarcError,
  buildDmarc,
  buildSpf,
  parseDmarc,
  readTxtRecords,
  toZoneForm,
  type DmarcFields,
} from '../src/index';

// Expected values are the literals of RFC 9989 (May 2026). The section is named where a record is taken from the text.

// A marker that stands for something a visitor pasted. No message of the package may ever hold it.
const MARK = 'zq8-MARKER-4471-zq8';

const BASE: DmarcFields = {
  policy: 'none',
  subPolicy: 'inherit',
  nonExistent: 'inherit',
  adkim: 'r',
  aspf: 'r',
  rua: '',
  ruf: '',
  fo: '0',
  test: false,
};

/** A small seeded generator (mulberry32), so every run builds the same records. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The error a call throws, or null when it does not throw. */
function refusal(call: () => unknown): SpfDmarcError | null {
  try {
    call();
    return null;
  } catch (err) {
    if (err instanceof SpfDmarcError) return err;
    throw err;
  }
}

it('a built DMARC record writes v first, never writes a retired tag and checks clean', () => {
  // RFC 9989 section 4.8: dmarc-record = dmarc-version *(dmarc-sep dmarc-tag) [dmarc-sep]; the version comes first.
  const plain = buildDmarc(BASE);
  expect(plain.record).toBe('v=DMARC1; p=none');
  expect(plain.problems).toEqual([]);
  expect(plain.report.valid).toBe(true);

  // Every tag, in the fixed order: v, p, sp, np, adkim, aspf, rua, ruf, fo, t. A bare address becomes a mailto: address.
  const full = buildDmarc({
    policy: 'quarantine',
    subPolicy: 'reject',
    nonExistent: 'none',
    adkim: 's',
    aspf: 's',
    rua: 'dmarc-feedback@example.com\nmailto:other@example.com',
    ruf: 'auth-reports@example.com',
    fo: '1:d',
    test: true,
  });
  expect(full.record).toBe(
    'v=DMARC1; p=quarantine; sp=reject; np=none; adkim=s; aspf=s; rua=mailto:dmarc-feedback@example.com,mailto:other@example.com; ruf=mailto:auth-reports@example.com; fo=1:d; t=y',
  );
  expect(full.length).toBe(full.record.length);
  expect(full.octets).toBe(full.record.length);
  expect(full.problems).toEqual([]);
  expect(full.report.valid).toBe(true);
  expect(full.report.policy).toEqual({ domain: 'quarantine', subdomains: 'reject', nonExistent: 'none' });

  // The RFC 9989 Appendix B.2.1 record, built from fields, equals the record the RFC writes.
  const b21 = buildDmarc({ ...BASE, rua: 'mailto:dmarc-feedback@example.com' });
  expect(b21.record).toBe('v=DMARC1; p=none; rua=mailto:dmarc-feedback@example.com');
  // Appendix B.2.5: p=quarantine with two aggregate addresses and t=y.
  const b25 = buildDmarc({
    ...BASE,
    policy: 'quarantine',
    rua: 'mailto:dmarc-feedback@example.com\nmailto:tld-test@thirdparty.example.net',
    test: true,
  });
  expect(b25.record).toBe(
    'v=DMARC1; p=quarantine; rua=mailto:dmarc-feedback@example.com,mailto:tld-test@thirdparty.example.net; t=y',
  );

  // Never a retired tag, and every tag of the built record reads back as ok: no unknown, invalid, repeated or retired tag.
  for (const built of [plain, full, b21, b25]) {
    expect(built.record.startsWith('v=DMARC1')).toBe(true);
    expect(built.record).not.toMatch(/(^|; )(pct|rf|ri)=/);
    const read = parseDmarc(built.record);
    expect(read.isDmarc).toBe(true);
    expect(read.tags.filter((t) => t.status !== 'ok' && t.status !== 'default-used')).toEqual([]);
    expect(read.notes).toEqual([]);
  }

  // Defaults are not written, so they are never repeated: adkim=r, aspf=r, fo=0, t=n and an inherited sp or np are left out.
  expect(buildDmarc({ ...BASE, policy: 'reject', adkim: 'r', aspf: 'r', fo: '0' }).record).toBe('v=DMARC1; p=reject');

  // An entry that is not an address is left out and listed with its field and line, never its text.
  const left = buildDmarc({
    ...BASE,
    rua: `good@example.com\nnot an address ${MARK}\n${MARK}\nmailto:also@example.com`,
  });
  expect(left.record).toBe('v=DMARC1; p=none; rua=mailto:good@example.com,mailto:also@example.com');
  expect(left.problems.map((p) => [p.field, p.line])).toEqual([
    ['rua', 2],
    ['rua', 3],
  ]);
  for (const problem of left.problems) expect(problem.message).not.toContain(MARK);
  // Entries that would break the tag (a comma or a semicolon inside) and the obsolete size suffix are left out as well.
  const broken = buildDmarc({ ...BASE, ruf: 'a@example.com;p=none\nb@example.com!10m\nc@example.com' });
  expect(broken.record).toBe('v=DMARC1; p=none; ruf=mailto:c@example.com');
  expect(broken.problems.map((p) => [p.field, p.line])).toEqual([
    ['ruf', 1],
    ['ruf', 2],
  ]);
  // An address in another scheme is kept as written and said in the advice.
  const https = buildDmarc({ ...BASE, rua: 'https://reports.example.net/dmarc' });
  expect(https.record).toBe('v=DMARC1; p=none; rua=https://reports.example.net/dmarc');
  expect(https.advice.some((a) => a.includes('receivers that do not support the scheme ignore it'))).toBe(true);

  // fo is a text field checked by the same parser: a value that does not read is left out, and fo is left out without ruf.
  const badFo = buildDmarc({ ...BASE, ruf: 'a@example.com', fo: '0:1' });
  expect(badFo.record).toBe('v=DMARC1; p=none; ruf=mailto:a@example.com');
  expect(badFo.problems.map((p) => p.field)).toEqual(['fo']);
  expect(badFo.problems[0]?.message).toContain('0 and 1 cannot be used together');
  const noRuf = buildDmarc({ ...BASE, fo: '1' });
  expect(noRuf.record).toBe('v=DMARC1; p=none');
  expect(noRuf.problems.map((p) => p.field)).toEqual(['fo']);
  expect(noRuf.problems[0]?.message).toContain('ignored without a ruf address');
  expect(buildDmarc({ ...BASE, ruf: 'a@example.com', fo: ' 1:d ' }).record).toBe(
    'v=DMARC1; p=none; ruf=mailto:a@example.com; fo=1:d',
  );

  // RFC 9989 section 7.4: p=reject is advised against for domains whose users post to mailing lists. It is advice, never a
  // problem, and it is not said for none or quarantine.
  const reject = buildDmarc({ ...BASE, policy: 'reject' });
  expect(reject.problems).toEqual([]);
  expect(reject.report.valid).toBe(true);
  expect(reject.advice.some((a) => a.includes('section 7.4') && a.includes('mailing lists'))).toBe(true);
  expect(buildDmarc(BASE).advice.some((a) => a.includes('section 7.4'))).toBe(false);
  expect(buildDmarc({ ...BASE, policy: 'quarantine' }).advice.some((a) => a.includes('section 7.4'))).toBe(false);
  // t=y has no effect on a policy of none.
  expect(buildDmarc({ ...BASE, test: true }).advice.some((a) => a.includes('no effect on a policy of none'))).toBe(
    true,
  );
  // An address in a domain other than the one the record is published for needs the other domain's record.
  const third = buildDmarc({ ...BASE, rua: 'a@thirdparty.example.net' });
  expect(third.advice.some((a) => a.includes('_report._dmarc') && a.includes('RFC 9990 section 4'))).toBe(true);
  expect(buildDmarc(BASE).advice.some((a) => a.includes('_report._dmarc'))).toBe(false);

  // A seeded run of 300 field sets: every built record reads clean, and what was asked for is what is read back.
  const next = seeded(9989);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const hosts = ['example.com', 'mail.example.org', 'thirdparty.example.net', 'a-b.example'];
  for (let i = 0; i < 300; i++) {
    const rua = Array.from({ length: Math.floor(next() * 4) }, () => `r${Math.floor(next() * 100)}@${pick(hosts)}`);
    const ruf = Array.from({ length: Math.floor(next() * 3) }, () => `f${Math.floor(next() * 100)}@${pick(hosts)}`);
    const fields: DmarcFields = {
      policy: pick(['none', 'quarantine', 'reject'] as const),
      subPolicy: pick(['inherit', 'none', 'quarantine', 'reject'] as const),
      nonExistent: pick(['inherit', 'none', 'quarantine', 'reject'] as const),
      adkim: pick(['r', 's'] as const),
      aspf: pick(['r', 's'] as const),
      rua: rua.join('\n'),
      ruf: ruf.join('\n'),
      fo: pick(['0', '1', 'd', 's', '0:d', '1:s', 'd:s', '0:d:s', '1:d:s'] as const),
      test: next() < 0.5,
    };
    const built = buildDmarc(fields);
    const read = parseDmarc(built.record);
    const where = `${i} ${built.record}`;
    expect(read.isDmarc, where).toBe(true);
    expect(
      read.tags.filter((t) => t.status !== 'ok' && t.status !== 'default-used'),
      where,
    ).toEqual([]);
    expect(read.notes, where).toEqual([]);
    expect(built.report.valid, where).toBe(true);
    expect(read.byName.get('p')?.value, where).toBe(fields.policy);
    expect(read.byName.get('sp')?.value ?? 'inherit', where).toBe(fields.subPolicy);
    expect(read.byName.get('np')?.value ?? 'inherit', where).toBe(fields.nonExistent);
    expect(built.report.addresses.filter((a) => a.tag === 'rua').length, where).toBe(rua.length);
    expect(built.report.addresses.filter((a) => a.tag === 'ruf').length, where).toBe(ruf.length);
    const subs = fields.subPolicy === 'inherit' ? fields.policy : fields.subPolicy;
    expect(built.report.policy, where).toEqual({
      domain: fields.policy,
      subdomains: subs,
      nonExistent: fields.nonExistent === 'inherit' ? subs : fields.nonExistent,
    });
    // fo is written only when it is not the default and a ruf address is there to receive the reports.
    expect(read.byName.has('fo'), where).toBe(fields.fo !== '0' && ruf.length > 0);
    expect(read.byName.has('t'), where).toBe(fields.test);
    expect(built.record, where).not.toMatch(/(^|; )(pct|rf|ri)=/);
  }
});

it('the zone form splits strings at 255 octets and reads back to the same record', () => {
  // RFC 9989 section 4.5: "Where this is the case, the module performing DMARC evaluation MUST concatenate these strings by
  // joining together the objects in order." A character-string holds at most 255 octets (RFC 1035 section 3.3, RFC 7208
  // section 3.3), so a longer record is written as several strings that join with no space.
  expect(toZoneForm('_dmarc', 'v=DMARC1; p=none')).toBe('_dmarc IN TXT "v=DMARC1; p=none"');
  expect(toZoneForm('@', 'v=spf1 -all')).toBe('@ IN TXT "v=spf1 -all"');

  // The boundaries: 255 octets are one string, 256 are two, 510 are two, 511 are three.
  const record = (octets: number): string => 'v=DMARC1; ' + 'a'.repeat(octets - 10);
  for (const [octets, strings] of [
    [255, 1],
    [256, 2],
    [510, 2],
    [511, 3],
  ] as const) {
    const text = record(octets);
    const zone = toZoneForm('_dmarc', text);
    const read = readTxtRecords(zone, 'dmarc');
    expect(read.length, `${octets}`).toBe(1);
    expect(read[0]?.text, `${octets}`).toBe(text);
    expect(read[0]?.label, `${octets}`).toBe('_dmarc');
    expect(read[0]?.strings.length, `${octets}`).toBe(strings);
    for (const s of read[0]?.strings ?? [])
      expect(new TextEncoder().encode(s).length, `${octets}`).toBeLessThanOrEqual(255);
    expect(zone.includes('\n'), `${octets}`).toBe(strings > 1);
  }

  // Several strings are written one per line inside parentheses, the way RFC 9989 Appendix B writes them.
  const lines = toZoneForm('_dmarc', record(300)).split('\n');
  expect(lines[0]).toBe('_dmarc IN TXT (');
  expect(lines[lines.length - 1]?.endsWith('" )')).toBe(true);

  // A quote and a backslash are escaped and count as one octet each; a split never falls inside a character.
  const tricky =
    'v=DMARC1; ' +
    '"\\'.repeat(200) +
    String.fromCodePoint(0xe9).repeat(200) +
    String.fromCodePoint(0x1f600).repeat(30);
  const back = readTxtRecords(toZoneForm('_dmarc', tricky), 'dmarc');
  expect(back.length).toBe(1);
  expect(back[0]?.text).toBe(tricky);
  for (const s of back[0]?.strings ?? []) expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(255);
  expect(back[0]?.strings.join('')).toBe(tricky);

  // Both builders show the zone form, and it reads back to the record they built.
  const dmarc = buildDmarc({ ...BASE, rua: Array.from({ length: 12 }, (_, i) => `r${i}@example.com`).join('\n') });
  expect(dmarc.record.length).toBeGreaterThan(255);
  const dmarcBack = readTxtRecords(toZoneForm('_dmarc', dmarc.record), 'dmarc');
  expect(dmarcBack[0]?.text).toBe(dmarc.record);
  expect(dmarcBack[0]?.strings.length).toBe(2);
  const spf = buildSpf({
    ip4: Array.from({ length: 30 }, (_, i) => `192.0.2.${i + 1}`).join('\n'),
    ip6: '',
    includes: '',
    a: false,
    mx: true,
    ending: '-all',
    redirect: '',
  });
  const spfBack = readTxtRecords(toZoneForm('@', spf.record), 'spf');
  expect(spfBack[0]?.text).toBe(spf.record);
  expect(spfBack[0]?.strings.length).toBe(spf.report.stringsNeeded);
});

it('a builder refuses too many entries and too long a record with a fixed sentence', () => {
  // 100 entries are the most one field holds; the 101st is refused naming the field and never repeating the text.
  const hundred = Array.from({ length: 100 }, (_, i) => `a${i}@example.com`).join('\n');
  expect(refusal(() => buildDmarc({ ...BASE, rua: hundred }))).toBeNull();
  const tooMany = refusal(() => buildDmarc({ ...BASE, rua: hundred + `\n${MARK}@example.com` }));
  expect(tooMany?.part).toBe('builder');
  expect(tooMany?.message).toContain('rua');
  expect(tooMany?.message).not.toContain(MARK);
  // A record over 16,384 characters is refused.
  const long = Array.from({ length: 100 }, (_, i) => `${'x'.repeat(190)}${i}@example.com`).join('\n');
  const tooLong = refusal(() => buildDmarc({ ...BASE, rua: long }));
  expect(tooLong?.part).toBe('builder');
  expect(tooLong?.message).not.toContain(MARK);
  // A field over the paste limit is refused before any work.
  const huge = refusal(() => buildDmarc({ ...BASE, rua: MARK + 'a'.repeat(65_536) }));
  expect(huge?.part).toBe('builder');
  expect(huge?.message).not.toContain(MARK);
});
