import { expect, it } from 'vitest';
import { checkDmarc, parseDmarc, pickDmarcRecord, readTxtRecords } from '../src/index';

// Expected values are the literals of RFC 9989 (May 2026). The section is named where a record is taken from the text.

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
