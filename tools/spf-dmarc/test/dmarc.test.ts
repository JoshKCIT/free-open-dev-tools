import { expect, it } from 'vitest';
import { SpfDmarcError, checkDmarc, parseDmarc, pickDmarcRecord, readTxtRecords } from '../src/index';
import type { DmarcRecord, DmarcReport } from '../src/index';

// Expected values are the literals of RFC 9989 (May 2026). The section is named where a record is taken from the text.

// A marker that stands for something a visitor pasted. No message of the package may ever hold it.
const MARK = 'zq8-MARKER-4471-zq8';

/** True when some note of the report holds the text. */
function said(report: DmarcReport, text: string): boolean {
  return report.notes.some((note) => note.message.includes(text));
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

/** The statuses of the tags of a record, by name, for the tags that are in the record text. */
function statuses(record: DmarcRecord): Array<[string, string]> {
  return record.tags.filter((t) => t.status !== 'default-used').map((t) => [t.name, t.status]);
}

/** The names of the tags of a record, in the order the table shows them. */
function names(text: string): string[] {
  return parseDmarc(text).tags.map((tag) => tag.name);
}

/** The first record of a zone-file box, as the page reads it. */
function firstRecord(box: string): string {
  const records = readTxtRecords(box, 'dmarc');
  expect(records.length).toBe(1);
  return records[0]?.text ?? '';
}

// RFC 9989 Table 2 lists the tags p, t, psd, np, sp, adkim, aspf, rua, ruf, fo; the version tag v always comes first.
const TABLE_2 = ['p', 't', 'psd', 'np', 'sp', 'adkim', 'aspf', 'rua', 'ruf', 'fo'];

// RFC 9989 sections 4.7 and 4.8, the default of each tag as the Default column shows it.
const DEFAULTS: Record<string, string> = {
  p: 'none',
  t: 'n',
  psd: 'u',
  np: 'sp, then p',
  sp: 'p',
  adkim: 'r',
  aspf: 'r',
  rua: 'none (no reports requested)',
  ruf: 'none (no reports requested)',
  fo: '0',
};

it('the RFC 9989 Appendix B records are read from their zone form with every tag and default', () => {
  // RFC 9989 Appendix B.2.1: monitoring mode with an aggregate report address.
  const b21 = `     ; DMARC Policy Record for the domain example.com
     _dmarc  IN TXT ( "v=DMARC1; p=none; "
                      "rua=mailto:dmarc-feedback@example.com" )`;
  expect(firstRecord(b21)).toBe('v=DMARC1; p=none; rua=mailto:dmarc-feedback@example.com');
  const one = parseDmarc(firstRecord(b21));
  expect(one.isDmarc).toBe(true);
  expect(one.tags.map((t) => [t.name, t.value, t.status])).toEqual([
    ['v', 'DMARC1', 'ok'],
    ['p', 'none', 'ok'],
    ['rua', 'mailto:dmarc-feedback@example.com', 'ok'],
    ['t', null, 'default-used'],
    ['psd', null, 'default-used'],
    ['np', null, 'default-used'],
    ['sp', null, 'default-used'],
    ['adkim', null, 'default-used'],
    ['aspf', null, 'default-used'],
    ['ruf', null, 'default-used'],
    ['fo', null, 'default-used'],
  ]);

  // RFC 9989 Appendix B.2.2: the same record with a failure report address, the example of the live fixture.
  const b22 = `     ; DMARC Policy Record for the domain example.com
     _dmarc  IN TXT ( "v=DMARC1; p=none; "
                      "rua=mailto:dmarc-feedback@example.com; "
                      "ruf=mailto:auth-reports@example.com" )`;
  const records = readTxtRecords(b22, 'dmarc');
  expect(records.length).toBe(1);
  expect(records[0]?.label).toBe('_dmarc');
  expect(records[0]?.text).toBe(
    'v=DMARC1; p=none; rua=mailto:dmarc-feedback@example.com; ruf=mailto:auth-reports@example.com',
  );
  const two = parseDmarc(records[0]?.text ?? '');
  expect(two.tags.map((t) => t.name)).toEqual(['v', 'p', 'rua', 'ruf', 't', 'psd', 'np', 'sp', 'adkim', 'aspf', 'fo']);
  for (const tag of two.tags.filter((t) => t.status === 'default-used')) {
    expect(tag.default, tag.name).toBe(DEFAULTS[tag.name]);
    expect(tag.value, tag.name).toBeNull();
  }
  const report = checkDmarc(two);
  expect(report.addresses.map((a) => [a.tag, a.text])).toEqual([
    ['rua', 'mailto:dmarc-feedback@example.com'],
    ['ruf', 'mailto:auth-reports@example.com'],
  ]);
  expect(report.policy).toEqual({ domain: 'none', subdomains: 'none', nonExistent: 'none' });

  // RFC 9989 Appendix B.2.3: the record of the third party that accepts the reports.
  expect(parseDmarc('v=DMARC1;').tags.map((t) => [t.name, t.status])[0]).toEqual(['v', 'ok']);

  // RFC 9989 Appendix B.2.5: a subdomain in testing with two aggregate report addresses, written over three strings.
  const b25 = `     ; DMARC Policy Record for the domain test.example.com
     _dmarc IN  TXT  ( "v=DMARC1; p=quarantine; "
                       "rua=mailto:dmarc-feedback@example.com,"
                       "mailto:tld-test@thirdparty.example.net; "
                       "t=y" )`;
  const five = parseDmarc(firstRecord(b25));
  expect(five.tags.map((t) => [t.name, t.value])).toEqual([
    ['v', 'DMARC1'],
    ['p', 'quarantine'],
    ['rua', 'mailto:dmarc-feedback@example.com,mailto:tld-test@thirdparty.example.net'],
    ['t', 'y'],
    ['psd', null],
    ['np', null],
    ['sp', null],
    ['adkim', null],
    ['aspf', null],
    ['ruf', null],
    ['fo', null],
  ]);
  expect(checkDmarc(five).addresses.map((a) => a.text)).toEqual([
    'mailto:dmarc-feedback@example.com',
    'mailto:tld-test@thirdparty.example.net',
  ]);
  // Without a tag for them, sp and np follow p (sections 4.7 and 4.10.1).
  expect(checkDmarc(five).policy).toEqual({
    domain: 'quarantine',
    subdomains: 'quarantine',
    nonExistent: 'quarantine',
  });
});

it('an empty box shows nothing and v=DMARC1 alone shows every default', () => {
  // An empty box, or one that holds only blanks and comment lines, holds no record at all.
  expect(readTxtRecords('', 'dmarc')).toEqual([]);
  expect(readTxtRecords('  \n; a comment line only\n\n', 'dmarc')).toEqual([]);
  expect(pickDmarcRecord([])).toBeNull();

  // RFC 9989 section 4.7 (p): "If this tag is not present in an otherwise syntactically valid DMARC Policy Record, then the
  // record is treated as if it included p=none". The record may end with a semicolon (section 4.8, dmarc-record).
  for (const text of ['v=DMARC1', 'v=DMARC1;', 'v=DMARC1 ;  ']) {
    const record = parseDmarc(text);
    expect(record.isDmarc, text).toBe(true);
    expect(
      record.tags.map((t) => t.name),
      text,
    ).toEqual(['v', ...TABLE_2]);
    expect(record.tags[0]?.status, text).toBe('ok');
    for (const tag of record.tags.slice(1)) {
      expect(tag.status, `${text} ${tag.name}`).toBe('default-used');
      expect(tag.default, `${text} ${tag.name}`).toBe(DEFAULTS[tag.name]);
    }
    expect(checkDmarc(record).policy, text).toEqual({ domain: 'none', subdomains: 'none', nonExistent: 'none' });
    expect(checkDmarc(record).addresses, text).toEqual([]);
  }
  expect(names('v=DMARC1; p=reject')).toEqual(['v', 'p', ...TABLE_2.filter((n) => n !== 'p')]);
});

it('pct, rf and ri are reported as retired in RFC 9989, never as syntax errors', () => {
  // RFC 9989 Appendix C.5.2 (Tags Removed): pct, rf and ri. They were tags of RFC 7489, so a pasted record may hold them.
  const record = parseDmarc('v=DMARC1; p=none; pct=50; rf=afrf; ri=86400');
  for (const name of ['pct', 'rf', 'ri']) {
    const tag = record.byName.get(name);
    expect(tag?.status, name).toBe('retired');
    expect(tag?.problem, name).toBeNull();
    expect(tag?.meaning, name).toContain('Retired in RFC 9989');
    expect(tag?.meaning, name).toContain('RFC 7489');
  }
  expect(record.tags.filter((t) => t.status === 'invalid')).toEqual([]);
  const report = checkDmarc(record);
  expect(report.valid).toBe(true);
  for (const name of ['pct', 'rf', 'ri']) {
    const note = report.notes.find((n) => n.message.includes(`The tag ${name} is retired in RFC 9989`));
    expect(note?.tone, name).toBe('info');
  }
  // A retired tag is not checked against its old syntax: whatever it holds, it is retired and not wrong.
  const odd = parseDmarc('v=DMARC1; pct=abc; ri=; rf=');
  expect(statuses(odd)).toEqual([
    ['v', 'ok'],
    ['pct', 'retired'],
    ['ri', 'retired'],
    ['rf', 'retired'],
  ]);
  expect(checkDmarc(odd).valid).toBe(true);
  // RFC 9989 section 4.7: unknown tags MUST be ignored, and pct does not change the policy that applies.
  expect(checkDmarc(parseDmarc('v=DMARC1; p=reject; pct=10')).policy.domain).toBe('reject');
});

it('v=DMARC1 must come first and is case sensitive', () => {
  // RFC 9989 section 4.7 (v): "This tag MUST be the first tag in the list. The tag value is case sensitive, and the only
  // possible value is DMARC1. If the tag is not the first in the list, the tag is absent, or the value is not DMARC1, then
  // the entire record MUST be ignored."
  const ignored: Array<[string, string]> = [
    ['v=dmarc1; p=reject', 'case sensitive'],
    ['v=Dmarc1; p=reject', 'case sensitive'],
    ['v=DMARC2; p=reject', 'only value'],
    ['p=reject; v=DMARC1', 'must start with the v tag'],
    ['p=reject', 'must start with the v tag'],
    ['; v=DMARC1; p=reject', 'must start with the v tag'],
    ['v; p=reject', 'must start with the v tag'],
    ['', 'must start with the v tag'],
    ['V=DMARC1; p=reject', 'lower case'],
  ];
  for (const [text, reason] of ignored) {
    const record = parseDmarc(text);
    expect(record.isDmarc, text).toBe(false);
    expect(record.ignored, text).toContain(reason);
    expect(record.ignored, text).toContain('ignored');
    expect(record.tags, text).toEqual([]);
    expect(checkDmarc(record).valid, text).toBe(false);
  }
  // Blanks around the equals sign and the semicolons are allowed (section 4.8: equals = *WSP "=" *WSP).
  const spaced = parseDmarc('v = DMARC1 ; p = reject ;');
  expect(spaced.isDmarc).toBe(true);
  expect(spaced.byName.get('p')?.value).toBe('reject');
  expect(spaced.ignored).toBeNull();
  // The tag may be the only one, and it keeps its place.
  expect(parseDmarc('v=DMARC1; p=none').byName.get('p')?.position).toBe(11);
  expect(parseDmarc('v=DMARC1').tags[0]?.position).toBe(1);
});

it('a missing p is treated as none and sp and np fall back as RFC 9989 says', () => {
  // RFC 9989 section 4.7: a record with no p is treated as p=none; sp falls back to p; np falls back to sp, then p.
  const policy = (text: string): [string, string, string] => {
    const p = checkDmarc(parseDmarc(text)).policy;
    return [p.domain, p.subdomains, p.nonExistent];
  };
  expect(policy('v=DMARC1; rua=mailto:a@example.com')).toEqual(['none', 'none', 'none']);
  expect(policy('v=DMARC1; p=reject')).toEqual(['reject', 'reject', 'reject']);
  expect(policy('v=DMARC1; p=reject; sp=quarantine')).toEqual(['reject', 'quarantine', 'quarantine']);
  expect(policy('v=DMARC1; p=reject; np=none')).toEqual(['reject', 'reject', 'none']);
  expect(policy('v=DMARC1; p=reject; sp=quarantine; np=none')).toEqual(['reject', 'quarantine', 'none']);
  expect(policy('v=DMARC1; p=quarantine; sp=none')).toEqual(['quarantine', 'none', 'none']);
  // The values are written with the letter case of the ABNF strings, which are case insensitive (section 4.8).
  const upper = parseDmarc('v=DMARC1; p=Reject');
  expect(upper.byName.get('p')?.status).toBe('ok');
  expect(checkDmarc(upper).policy.domain).toBe('reject');
  // A missing p is said in words.
  const missing = checkDmarc(parseDmarc('v=DMARC1; sp=reject'));
  expect(said(missing, 'treated as p=none')).toBe(true);
  expect(missing.policy).toEqual({ domain: 'none', subdomains: 'reject', nonExistent: 'reject' });
  // RFC 9989 section 4.10.1: with an invalid p, sp or np the record reads as p=none when rua holds a valid address, and
  // otherwise no DMARC processing applies; either way the effect on failing mail is none.
  const bad = checkDmarc(parseDmarc('v=DMARC1; p=bogus; rua=mailto:a@example.com'));
  expect(parseDmarc('v=DMARC1; p=bogus').byName.get('p')?.status).toBe('invalid');
  expect(bad.policy).toEqual({ domain: 'none', subdomains: 'none', nonExistent: 'none' });
  expect(said(bad, 'section 4.10.1')).toBe(true);
  expect(said(bad, 'as if p=none')).toBe(true);
  const noRua = checkDmarc(parseDmarc('v=DMARC1; p=reject; sp=bogus'));
  expect(noRua.policy).toEqual({ domain: 'none', subdomains: 'none', nonExistent: 'none' });
  expect(said(noRua, 'no DMARC processing')).toBe(true);
});

it('a repeated tag uses the first value and reports the repeat', () => {
  // RFC 9989 does not say what a repeated tag means (research A4): the page uses the first value and says so.
  const record = parseDmarc('v=DMARC1; p=none; p=reject; pct=1; pct=2');
  expect(record.tags.slice(0, 5).map((t) => [t.name, t.value, t.status])).toEqual([
    ['v', 'DMARC1', 'ok'],
    ['p', 'none', 'ok'],
    ['p', 'reject', 'repeated'],
    ['pct', '1', 'retired'],
    ['pct', '2', 'repeated'],
  ]);
  const report = checkDmarc(record);
  expect(report.policy.domain).toBe('none');
  expect(said(report, 'The tag p is repeated and the first value is used')).toBe(true);
  expect(said(report, 'The tag pct is repeated and the first value is used')).toBe(true);
  // An unknown tag that repeats is simply unknown both times.
  expect(statuses(parseDmarc('v=DMARC1; x=1; x=2'))).toEqual([
    ['v', 'ok'],
    ['x', 'unknown'],
    ['x', 'unknown'],
  ]);
  // v repeated is a repeat too, and the first v still decides.
  expect(parseDmarc('v=DMARC1; v=DMARC1').tags[1]?.status).toBe('repeated');
  // Tag names are read in lower case: an upper-case name is an unknown tag that is ignored, so P=reject changes nothing.
  const upper = parseDmarc('v=DMARC1; P=reject');
  expect(upper.byName.get('P')?.status).toBe('unknown');
  expect(upper.byName.get('P')?.meaning).toContain('lower case');
  expect(checkDmarc(upper).policy.domain).toBe('none');
});

it('two records in the box are reported as all discarded', () => {
  // RFC 9989 section 4.10, step 2: "If multiple DMARC Policy Records are returned for a single target, they are all
  // discarded."
  const two = pickDmarcRecord(readTxtRecords('v=DMARC1; p=none\nv=DMARC1; p=reject', 'dmarc'));
  expect(two?.record).toBeNull();
  expect(two?.candidates).toBe(2);
  expect(two?.discardedLines).toEqual([1, 2]);
  expect(two?.discarded).toContain('section 4.10');
  expect(two?.discarded).toContain('all of them');
  // The same in zone form, over several lines.
  const zone = `_dmarc IN TXT "v=DMARC1; p=none"
_dmarc IN TXT ( "v=DMARC1; "
                "p=reject" )`;
  const zoned = pickDmarcRecord(readTxtRecords(zone, 'dmarc'));
  expect(zoned?.record).toBeNull();
  expect(zoned?.discardedLines).toEqual([1, 2]);
  // One DMARC record and one other text: the other is set aside, as the tree walk discards what does not start with v.
  const mixed = pickDmarcRecord(readTxtRecords('hello\nv=DMARC1; p=reject', 'dmarc'));
  expect(mixed?.discarded).toBeNull();
  expect(mixed?.setAside).toBe(1);
  expect(mixed?.record?.byName.get('p')?.value).toBe('reject');
  // Two texts and neither is a DMARC record: the first is read and says why it is ignored.
  const none = pickDmarcRecord(readTxtRecords('hello\nworld', 'dmarc'));
  expect(none?.candidates).toBe(0);
  expect(none?.record?.isDmarc).toBe(false);
  // One record alone is the record.
  const one = pickDmarcRecord(readTxtRecords('v=DMARC1; p=reject', 'dmarc'));
  expect(one?.candidates).toBe(1);
  expect(one?.setAside).toBe(0);
  expect(one?.discarded).toBeNull();
});

it('the third-party report authorisation name is written exactly for the domain given', () => {
  // RFC 9989 Appendix B.2.3: the record is published at _dmarc.example.com and sends failure reports to a third party. The
  // third party publishes the value v=DMARC1; at example.com._report._dmarc.thirdparty.example.net.
  const b23 = parseDmarc(
    'v=DMARC1; p=none; rua=mailto:dmarc-feedback@example.com; ruf=mailto:auth-reports@thirdparty.example.net',
  );
  const report = checkDmarc(b23, 'example.com');
  expect(report.authorisations.map((a) => [a.tag, a.host, a.outside, a.name, a.value])).toEqual([
    ['rua', 'example.com', false, null, null],
    ['ruf', 'thirdparty.example.net', true, 'example.com._report._dmarc.thirdparty.example.net', 'v=DMARC1;'],
  ]);
  expect(report.needsDomain).toBe(false);
  // RFC 9990 section 4: the policy of blue.example.com names reports@red.example.net, so the query is for
  // blue.example.com._report._dmarc.red.example.net.
  const blue = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:reports@red.example.net'), 'blue.example.com');
  expect(blue.authorisations[0]?.name).toBe('blue.example.com._report._dmarc.red.example.net');
  // The name is written in lower case, without a trailing dot, and a _dmarc label the visitor typed is taken off.
  const typed = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:Reports@Red.Example.NET'), 'Blue.Example.COM.');
  expect(typed.authorisations[0]?.name).toBe('blue.example.com._report._dmarc.red.example.net');
  const prefixed = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:reports@red.example.net'), '_dmarc.blue.example.com');
  expect(prefixed.authorisations[0]?.name).toBe('blue.example.com._report._dmarc.red.example.net');
  expect(said(prefixed, '_dmarc')).toBe(true);
  // A host under the domain, or a domain under the host, is the same domain by name and needs no record.
  const inside = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:a@mail.example.com,mailto:b@example.com'), 'example.com');
  expect(inside.authorisations.map((a) => a.outside)).toEqual([false, false]);
  const parent = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:b@example.com'), 'mail.example.com');
  expect(parent.authorisations[0]?.outside).toBe(false);
  // A name made only of letters of another domain is not "under" it.
  const lookalike = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:b@badexample.com'), 'example.com');
  expect(lookalike.authorisations[0]?.outside).toBe(true);
  // With no domain typed, the page cannot write a name and says what is needed; no name is invented.
  const noDomain = checkDmarc(b23);
  expect(noDomain.authorisations).toEqual([]);
  expect(noDomain.needsDomain).toBe(true);
  expect(checkDmarc(parseDmarc('v=DMARC1; p=none')).needsDomain).toBe(false);
  // RFC 9990 section 4 step 4: a name over the DNS limits cannot be confirmed.
  const long = [60, 60, 60, 60].map((n) => 'a'.repeat(n)).join('.');
  const tooLong = checkDmarc(parseDmarc('v=DMARC1; rua=mailto:r@thirdparty.example.net'), long);
  expect(tooLong.authorisations[0]?.name).toBeNull();
  expect(tooLong.authorisations[0]?.outside).toBe(true);
  expect(tooLong.authorisations[0]?.message).toContain('DNS limits');
  // A domain that is not a name is refused with a fixed sentence that never repeats it.
  const bad = [
    'exa mple.com',
    'example..com',
    '-a.example',
    'a'.repeat(64) + '.com',
    'x'.repeat(254),
    'ex' + String.fromCodePoint(0xe9) + '.com',
    MARK + ' x',
    '.',
  ];
  for (const domain of bad) {
    const error = refusal(() => checkDmarc(b23, domain));
    expect(error, domain.slice(0, 20)).not.toBeNull();
    expect(error?.part).toBe('domain');
    expect(error?.message).not.toContain(MARK);
    expect(error?.message).toContain('domain');
  }
});

it('fo is ignored without ruf and its values are checked', () => {
  // RFC 9989 section 4.7 (fo): "This tag's content MUST be ignored if a ruf tag is not also specified." The values are 0, 1,
  // d and s separated by colons, "0" and "1" are mutually exclusive, and d and s each appear at most once (section 4.8).
  const alone = checkDmarc(parseDmarc('v=DMARC1; p=none; fo=1'));
  expect(said(alone, 'fo is ignored because the record has no ruf address')).toBe(true);
  const withRuf = checkDmarc(parseDmarc('v=DMARC1; p=none; fo=1; ruf=mailto:a@example.com'));
  expect(said(withRuf, 'fo is ignored')).toBe(false);
  expect(withRuf.valid).toBe(true);
  // A ruf tag with nothing usable in it is the same as no ruf.
  expect(said(checkDmarc(parseDmarc('v=DMARC1; fo=d; ruf=nonsense')), 'fo is ignored')).toBe(true);
  for (const value of [
    '0',
    '1',
    'd',
    's',
    '0:d',
    '1:s',
    'd:0',
    's:1',
    'd:s',
    's:d',
    '0:d:s',
    '1:s:d',
    'd:1:s',
    'D:S',
    'd:s:0',
  ]) {
    const tag = parseDmarc(`v=DMARC1; fo=${value}; ruf=mailto:a@example.com`).byName.get('fo');
    expect(tag?.status, value).toBe('ok');
    expect(tag?.problem, value).toBeNull();
  }
  const wrong: Array<[string, string]> = [
    ['0:1', '0 and 1 cannot be used together'],
    ['1:0:d', '0 and 1 cannot be used together'],
    ['0:0', 'each of 0 and 1 can appear once'],
    ['d:d', 'd and s can each appear once'],
    ['s:d:s', 'd and s can each appear once'],
    ['x', 'only 0, 1, d and s'],
    ['0:', 'only 0, 1, d and s'],
    [':0', 'only 0, 1, d and s'],
    ['0,d', 'only 0, 1, d and s'],
    ['', 'has no value'],
  ];
  for (const [value, reason] of wrong) {
    const record = parseDmarc(`v=DMARC1; fo=${value}; ruf=mailto:a@example.com`);
    const tag = record.byName.get('fo');
    expect(tag?.status, value).toBe('invalid');
    expect(tag?.problem, value).toContain(reason);
    expect(tag?.meaning, value).toContain('default');
    expect(checkDmarc(record).valid, value).toBe(false);
  }
  // An invalid fo shows its default row's value in the Default column and no second row is added.
  const record = parseDmarc('v=DMARC1; fo=0:1');
  expect(record.tags.filter((t) => t.name === 'fo').length).toBe(1);
  expect(record.byName.get('fo')?.default).toBe('0');
});

it('tags keep record order and absent tags follow in the order of RFC 9989 Table 2', () => {
  // The record order is kept, whatever it is; the tags the record does not hold follow in the order of Table 2.
  expect(names('v=DMARC1; fo=1; ruf=mailto:a@example.com; p=none; aspf=s; x=1; adkim=r')).toEqual([
    'v',
    'fo',
    'ruf',
    'p',
    'aspf',
    'x',
    'adkim',
    't',
    'psd',
    'np',
    'sp',
    'rua',
  ]);
  expect(names('v=DMARC1; rua=mailto:a@example.com; sp=none; p=reject; np=none')).toEqual([
    'v',
    'rua',
    'sp',
    'p',
    'np',
    't',
    'psd',
    'adkim',
    'aspf',
    'ruf',
    'fo',
  ]);
  // The same record always gives the same table, in any interleaving with other records.
  const a = 'v=DMARC1; p=reject; rua=mailto:a@example.com';
  const b = 'v=DMARC1; sp=none; x=1';
  const first = [parseDmarc(a), parseDmarc(b), parseDmarc(a)];
  const again = [parseDmarc(b), parseDmarc(a), parseDmarc(b)];
  expect(first[0]).toStrictEqual(again[1]);
  expect(first[1]).toStrictEqual(again[0]);
  expect(first[0]).toStrictEqual(first[2]);
});

it('an empty element between semicolons is ignored and noted, and a trailing semicolon is valid', () => {
  // RFC 9989 section 4.8: dmarc-record = dmarc-version *(dmarc-sep dmarc-tag) [dmarc-sep], so one trailing semicolon is
  // valid; two semicolons in a row hold an empty element, which is read as nothing and noted.
  const trailing = parseDmarc('v=DMARC1; p=reject;');
  expect(trailing.notes).toEqual([]);
  expect(trailing.byName.get('p')?.status).toBe('ok');
  const twice = parseDmarc('v=DMARC1;; p=reject; ;rua=mailto:a@example.com;');
  expect(twice.notes.length).toBe(1);
  expect(twice.notes[0]).toContain('empty element');
  expect(twice.notes[0]).toContain('2');
  expect(statuses(twice)).toEqual([
    ['v', 'ok'],
    ['p', 'ok'],
    ['rua', 'ok'],
  ]);
  expect(checkDmarc(twice).valid).toBe(true);
  expect(said(checkDmarc(twice), 'empty element')).toBe(true);
});

it('report addresses are checked as mailto addresses and other schemes and the obsolete size suffix are noted', () => {
  // RFC 9989 section 4.7 (rua, ruf): a mail receiver MUST support mailto:, and URIs of schemes it does not support MUST be
  // ignored. Section 4.8 and Appendix C.4: the size suffix (obs-dmarc-report-size) is obsolete and ignored.
  const record = parseDmarc(
    'v=DMARC1; rua=mailto:a@example.com!10m , mailto:b@example.net; ruf=https://reports.example.net/dmarc',
  );
  const rua = record.byName.get('rua')?.uris ?? [];
  expect(rua.map((u) => [u.text, u.kind, u.host, u.obsoleteSize])).toEqual([
    ['mailto:a@example.com', 'mailto', 'example.com', '!10m'],
    ['mailto:b@example.net', 'mailto', 'example.net', null],
  ]);
  const ruf = record.byName.get('ruf')?.uris ?? [];
  expect(ruf.map((u) => [u.kind, u.scheme])).toEqual([['other', 'https']]);
  const report = checkDmarc(record);
  expect(said(report, 'size suffix is obsolete')).toBe(true);
  expect(said(report, 'receivers that do not support the scheme ignore it')).toBe(true);
  expect(report.addresses.map((a) => a.text)).toEqual([
    'mailto:a@example.com',
    'mailto:b@example.net',
    'https://reports.example.net/dmarc',
  ]);
  // A bare address, a mailbox with no domain or no name, and a blank inside are not usable addresses.
  const problems: Array<[string, string]> = [
    ['rua=reports@example.com', 'mailto:'],
    ['rua=mailto:reports', 'no @'],
    ['rua=mailto:reports@', 'no domain'],
    ['rua=mailto:@example.com', 'no mailbox'],
    ['rua=mailto:reports@exa mple.com', 'blank'],
    ['rua=mailto:reports@example..com', 'no valid domain'],
    ['rua=mailto:reports@-example.com', 'no valid domain'],
    ['rua=nonsense', 'scheme'],
  ];
  for (const [tag, reason] of problems) {
    const parsed = parseDmarc(`v=DMARC1; ${tag}`);
    const uri = parsed.byName.get('rua')?.uris[0];
    expect(uri?.kind, tag).toBe('invalid');
    expect(uri?.problem, tag).toContain(reason);
    // Nothing usable in the tag: the whole tag is invalid and the default (no reports) applies.
    expect(parsed.byName.get('rua')?.status, tag).toBe('invalid');
  }
  // One usable address keeps the tag; the bad one is noted and left out of the addresses.
  const mixed = parseDmarc('v=DMARC1; rua=mailto:a@example.com,reports@example.com');
  expect(mixed.byName.get('rua')?.status).toBe('ok');
  const mixedReport = checkDmarc(mixed);
  expect(mixedReport.addresses.map((a) => a.text)).toEqual(['mailto:a@example.com']);
  expect(said(mixedReport, 'is not a usable address')).toBe(true);
  expect(mixedReport.valid).toBe(false);
});

it('tag values are checked against RFC 9989 and a wrong value is ignored with its default used', () => {
  // RFC 9989 section 4.8: "Syntax errors in the remainder of the record MUST be discarded in favor of default values (if
  // any) or ignored outright." The values come from the rules of Table 2.
  const wrong: Array<[string, string]> = [
    ['p=quarantined', 'p'],
    ['sp=none,reject', 'sp'],
    ['np=maybe', 'np'],
    ['t=maybe', 't'],
    ['psd=z', 'psd'],
    ['adkim=x', 'adkim'],
    ['aspf=relaxed', 'aspf'],
    ['p=', 'p'],
    ['adkim', 'adkim'],
    ['p=none' + String.fromCharCode(1), 'p'],
    ['p=' + String.fromCodePoint(0xe9), 'p'],
    ['rua=mailto:' + String.fromCodePoint(0xe9) + '@example.com', 'rua'],
  ];
  for (const [text, name] of wrong) {
    const record = parseDmarc(`v=DMARC1; ${text}`);
    const tag = record.byName.get(name);
    expect(tag?.status, text.slice(0, 12)).toBe('invalid');
    expect(tag?.problem, text.slice(0, 12)).not.toBeNull();
    expect(tag?.meaning, text.slice(0, 12)).toContain('default');
    expect(checkDmarc(record).valid, text.slice(0, 12)).toBe(false);
  }
  for (const text of ['t=y', 't=N', 'psd=y', 'psd=n', 'psd=u', 'adkim=s', 'aspf=R', 'sp=NONE', 'np=Quarantine']) {
    const record = parseDmarc(`v=DMARC1; ${text}`);
    expect(statuses(record).pop()?.[1], text).toBe('ok');
  }
  // A tag with no equals sign is not a tag: it is ignored and reported. A name with a digit is not a tag name either.
  const loose = parseDmarc('v=DMARC1; foo; p1=none; =x; p=reject');
  expect(statuses(loose)).toEqual([
    ['v', 'ok'],
    ['foo', 'invalid'],
    ['p1', 'invalid'],
    ['', 'invalid'],
    ['p', 'ok'],
  ]);
  // t=y is explained as one level below the policy, and has no effect on a policy of none (section 4.7).
  const test = checkDmarc(parseDmarc('v=DMARC1; p=reject; t=y'));
  expect(said(test, 'one level below')).toBe(true);
  expect(said(checkDmarc(parseDmarc('v=DMARC1; p=none; t=y')), 'no effect on a policy of none')).toBe(true);
  // RFC 9989 section 7.4: p=reject is advised against for domains whose users post to mailing lists; it is advice only.
  const reject = checkDmarc(parseDmarc('v=DMARC1; p=reject; rua=mailto:a@example.com'));
  expect(reject.notes.find((n) => n.message.includes('section 7.4'))?.tone).toBe('info');
  expect(reject.valid).toBe(true);
});

it('refusals, problems and notes never repeat pasted text', () => {
  // A marker stands for something the visitor pasted; no fixed sentence of the package may hold it.
  const text = `v=DMARC1; ${MARK}=1; p=${MARK}; rua=mailto:${MARK}; sp; fo=${MARK}; ${MARK}${MARK}`;
  const record = parseDmarc(text);
  const fixed = [
    record.ignored ?? '',
    ...record.notes,
    ...record.tags.flatMap((t) => [t.meaning, t.problem ?? '', ...t.uris.map((u) => u.problem ?? '')]),
    ...checkDmarc(record, 'example.com').notes.map((n) => n.message),
    ...checkDmarc(record, 'example.com').authorisations.map((a) => a.message),
  ];
  for (const sentence of fixed) expect(sentence).not.toContain(MARK);
  expect(parseDmarc(`${MARK}=1; v=DMARC1`).ignored).not.toContain(MARK);
  expect(parseDmarc(`v=${MARK}`).ignored).not.toContain(MARK);
  // A box over the limit is refused naming the box, and a record over the limit too, never repeating the text.
  const box = refusal(() => readTxtRecords(MARK + 'a'.repeat(65_536), 'dmarc'));
  expect(box?.part).toBe('dmarc');
  expect(box?.message).toContain('DMARC box');
  expect(box?.message).not.toContain(MARK);
  const long = refusal(() => parseDmarc('v=DMARC1; ' + MARK + 'a'.repeat(16_384)));
  expect(long?.part).toBe('dmarc');
  expect(long?.message).not.toContain(MARK);
  const many = refusal(() => readTxtRecords(('v=DMARC1; ' + MARK + '\n').repeat(101), 'dmarc'));
  expect(many?.message).toContain('DMARC box');
  expect(many?.message).not.toContain(MARK);
});
