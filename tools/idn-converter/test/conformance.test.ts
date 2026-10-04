import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toASCII } from 'tr46';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STRICT, convertName, explainName, visible } from '../src/index';
import {
  FIXTURE_DIR,
  IDNA_TEST_PATH,
  familiesOfCode,
  gitBlobShaOfFile,
  readIdnaTestFile,
  readVendoredRows,
  sameWithWildcard,
  sha256OfFile,
} from './idna-test-file';

// Expected values in this file come only from Unicode's IdnaTestV2.txt 17.0.0, vendored byte for byte under
// test/fixtures/idna (see UPSTREAM.md there), read by the test's own reader (idna-test-file.ts). Nothing here is
// computed by the code under test. The counts below were made with a separate script over the same file: 6,391 rows;
// 5,842 rows with an error in the toAsciiN column, 5,712 in the toAsciiT column and 5,730 in the toUnicode column; 271
// toUnicode rows with the status X4_2 (an empty label).
const ROWS_IN_FILE = 6391;
const ERROR_ROWS_ASCII_N = 5842;
const ERROR_ROWS_ASCII_T = 5712;
const ERROR_ROWS_UNICODE = 5730;
const ROWS_WITH_EMPTY_LABEL_STATUS = 271;

type Spy = ReturnType<typeof vi.spyOn>;
let spies: Record<string, Spy> = {};

beforeEach(() => {
  spies = {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A short, escaped description of a row for a failure message (control and direction characters are escaped). */
function label(line: number, source: string): string {
  return 'line ' + line + ' ' + visible(source, 60);
}

it('UTS 46 ToASCII agrees with IdnaTestV2 17.0.0 on every row in both processing columns', () => {
  const rows = readVendoredRows();
  expect(rows.length).toBe(ROWS_IN_FILE);
  const disagreements: string[] = [];
  let errorsN = 0;
  let errorsT = 0;
  for (const row of rows) {
    // The nontransitional column: the tool's own conversion with the strict profile (all five checks on).
    const n = convertName(row.source, { direction: 'to-ascii', profile: 'strict' });
    const wantErrorN = row.toAsciiNStatus.length > 0;
    if (wantErrorN) errorsN++;
    if (n.valid === wantErrorN || (n.ascii === null) !== wantErrorN) {
      disagreements.push('N verdict ' + label(row.line, row.source));
    } else if (!wantErrorN && !sameWithWildcard(n.ascii ?? '', row.toAsciiN)) {
      disagreements.push('N value ' + label(row.line, row.source));
    }
    // The transitional column (deprecated, not offered by the page): the same package function with the same strict
    // options and transitional processing on, which is how the file asks for it.
    const t = toASCII(row.source, { ...STRICT, transitionalProcessing: true });
    const wantErrorT = row.toAsciiTStatus.length > 0;
    if (wantErrorT) errorsT++;
    if ((t === null) !== wantErrorT) disagreements.push('T verdict ' + label(row.line, row.source));
    else if (t !== null && !sameWithWildcard(t, row.toAsciiT))
      disagreements.push('T value ' + label(row.line, row.source));
  }
  expect(disagreements.slice(0, 10)).toEqual([]);
  expect(errorsN).toBe(ERROR_ROWS_ASCII_N);
  expect(errorsT).toBe(ERROR_ROWS_ASCII_T);
});

it('UTS 46 ToUnicode agrees with IdnaTestV2 17.0.0 on every row, the empty label status included', () => {
  const rows = readVendoredRows();
  const disagreements: string[] = [];
  let errors = 0;
  let emptyLabelRows = 0;
  for (const row of rows) {
    const result = convertName(row.source, { direction: 'to-unicode', profile: 'strict' });
    const wantError = row.toUnicodeStatus.length > 0;
    if (wantError) errors++;
    if (result.valid === wantError || (result.unicode === null) !== wantError) {
      disagreements.push('verdict ' + label(row.line, row.source));
    } else if (!wantError && !sameWithWildcard(result.unicode ?? '', row.toUnicode)) {
      disagreements.push('value ' + label(row.line, row.source));
    }
    if (row.toUnicodeStatus.includes('X4_2')) {
      emptyLabelRows++;
      // The empty label status is the tool's own check (the package reports no such code): it must be named.
      if (!result.problems.some((problem) => problem.family === 'empty-label')) {
        disagreements.push('empty label not explained ' + label(row.line, row.source));
      }
    }
  }
  expect(disagreements.slice(0, 10)).toEqual([]);
  expect(errors).toBe(ERROR_ROWS_UNICODE);
  expect(emptyLabelRows).toBe(ROWS_WITH_EMPTY_LABEL_STATUS);
});

it('each invalid label is explained by the status families IdnaTestV2 lists and never by a wrong one', () => {
  const rows = readVendoredRows();
  const wrong: string[] = [];
  const unexplained: string[] = [];
  const incomplete: string[] = [];
  const falseAlarms: string[] = [];
  let withoutProcessingCode = 0;
  for (const row of rows) {
    // ToASCII with every check on.
    const problems = explainName(row.source, STRICT, 'to-ascii');
    const named = new Set<string>(problems.map((problem) => problem.family));
    if (row.toAsciiNStatus.length === 0) {
      if (problems.length > 0) falseAlarms.push('valid name explained ' + label(row.line, row.source));
    } else {
      const allowed = new Set(row.toAsciiNStatus.flatMap(familiesOfCode));
      for (const family of named) {
        if (!allowed.has(family)) wrong.push('wrong family ' + family + ' ' + label(row.line, row.source));
      }
      if (problems.length === 0) unexplained.push('not explained ' + label(row.line, row.source));
      // A name whose file statuses hold no processing code passes the basic checks, so tr46 can separate every family
      // it lists: each of them must be named (an A4 code stands for a length or an empty label).
      if (!row.toAsciiNStatus.some((code) => familiesOfCode(code).includes('processing'))) {
        withoutProcessingCode++;
        const covered = row.toAsciiNStatus.every((code) => familiesOfCode(code).some((family) => named.has(family)));
        if (!covered) incomplete.push('family left out ' + label(row.line, row.source));
      }
    }
    // ToUnicode with the same checks: no length families, and the same rules for the rest.
    const unicodeProblems = explainName(row.source, STRICT, 'to-unicode');
    if (row.toUnicodeStatus.length === 0) {
      if (unicodeProblems.length > 0)
        falseAlarms.push('valid name explained (ToUnicode) ' + label(row.line, row.source));
    } else {
      const allowedU = new Set(row.toUnicodeStatus.flatMap(familiesOfCode));
      for (const problem of unicodeProblems) {
        if (!allowedU.has(problem.family))
          wrong.push('wrong family (ToUnicode) ' + problem.family + ' ' + label(row.line, row.source));
      }
      if (unicodeProblems.length === 0) unexplained.push('not explained (ToUnicode) ' + label(row.line, row.source));
    }
  }
  expect(wrong.slice(0, 10)).toEqual([]);
  expect(unexplained.slice(0, 10)).toEqual([]);
  expect(incomplete.slice(0, 10)).toEqual([]);
  expect(falseAlarms.slice(0, 10)).toEqual([]);
  // The check above is not vacuous: 1,661 error rows are in this group (counted by a separate script).
  expect(withoutProcessingCode).toBe(1661);
});

it('the strict and browser profiles differ only in hyphen, STD3, length and empty label checks', () => {
  // The options UTS 46 lets an application switch off are checkHyphens (V2, V3), useSTD3ASCIIRules (U1) and
  // verifyDNSLength (A4_1, A4_2); the browser profile (the URL Standard's domain parser ToASCII with beStrict false)
  // switches exactly those three off and keeps bidi and joiners on. An empty label is a length problem (the data's X4_2,
  // listed with A4_1 and A4_2), so it is accepted when lengths are not verified, and a final full stop passes (UTS 46
  // section 4.2: the empty root label is passed through when VerifyDnsLength is false).
  const switchedOff = new Set(['V2', 'V3', 'U1', 'A4_1', 'A4_2']);
  const rows = readVendoredRows();
  const problemsFound: string[] = [];
  let differing = 0;
  for (const row of rows) {
    const strict = convertName(row.source, { direction: 'to-ascii', profile: 'strict' });
    const browser = convertName(row.source, { direction: 'to-ascii', profile: 'browser' });
    const wantValid = row.toAsciiNStatus.every((code) => switchedOff.has(code));
    if (browser.valid !== wantValid) {
      problemsFound.push('verdict ' + label(row.line, row.source));
      continue;
    }
    if (wantValid && !sameWithWildcard(browser.ascii ?? '', row.toAsciiN))
      problemsFound.push('value ' + label(row.line, row.source));
    if (strict.valid && !browser.valid) problemsFound.push('browser stricter ' + label(row.line, row.source));
    if (browser.valid && !strict.valid) {
      differing++;
      const onlySwitchedOff = strict.problems.every((problem) =>
        ['hyphen', 'std3', 'length', 'empty-label'].includes(problem.family),
      );
      if (!onlySwitchedOff) problemsFound.push('strict-only family ' + label(row.line, row.source));
    }
    // Whatever the browser profile reports, the strict profile reports too.
    const strictFamilies = new Set(strict.problems.map((problem) => problem.family));
    for (const problem of browser.problems) {
      if (!strictFamilies.has(problem.family)) problemsFound.push('browser-only family ' + label(row.line, row.source));
    }
    // And the families the browser profile names are never ones whose check it switched off, empty labels included.
    const allowed = new Set(row.toAsciiNStatus.filter((code) => !switchedOff.has(code)).flatMap(familiesOfCode));
    for (const problem of browser.problems) {
      if (!allowed.has(problem.family))
        problemsFound.push('browser wrong family ' + problem.family + ' ' + label(row.line, row.source));
    }
  }
  expect(problemsFound.slice(0, 10)).toEqual([]);
  // Not vacuous: many rows are valid in the browser profile and not in the strict one.
  expect(differing).toBeGreaterThan(150);
});

it('the whole conformance file converts in under 20 seconds', () => {
  const rows = readVendoredRows();
  const started = performance.now();
  let converted = 0;
  for (const row of rows) {
    convertName(row.source, { direction: 'to-ascii', profile: 'strict' });
    convertName(row.source, { direction: 'to-unicode', profile: 'strict' });
    convertName(row.source, { direction: 'to-ascii', profile: 'browser' });
    converted += 3;
  }
  const elapsed = performance.now() - started;
  expect(converted).toBe(ROWS_IN_FILE * 3);
  expect(elapsed).toBeLessThan(20_000);
}, 120_000);

it('nothing is written to the console while converting', () => {
  const rows = readVendoredRows().slice(0, 1500);
  for (const row of rows) {
    convertName(row.source, { direction: 'to-ascii', profile: 'strict' });
    convertName(row.source, { direction: 'to-unicode', profile: 'browser' });
    explainName(row.source, STRICT, 'to-ascii');
  }
  for (const [name, spy] of Object.entries(spies)) expect(spy.mock.calls.length, 'console.' + name).toBe(0);
});

/** Reads the `- SHA-256:` line and the `- name: sha` lines under the Files heading of the UPSTREAM.md. */
function readUpstream(text: string): { sha256: string; blobs: Map<string, string> } {
  const sha256Line = text.split('\n').find((line) => line.startsWith('- SHA-256: '));
  expect(sha256Line).toBeDefined();
  const blobs = new Map<string, string>();
  const marker = text.indexOf('## Files');
  expect(marker).toBeGreaterThan(0);
  for (const line of text.slice(marker).split('\n')) {
    if (!line.startsWith('- ')) continue;
    const colon = line.indexOf(': ');
    if (colon < 0) continue;
    blobs.set(line.slice(2, colon), line.slice(colon + 2).trim());
  }
  return { sha256: (sha256Line ?? '').slice('- SHA-256: '.length).trim(), blobs };
}

it('the vendored IdnaTestV2 file is the 17.0.0 file with its recorded hash', () => {
  const upstream = readUpstream(readFileSync(join(FIXTURE_DIR, 'UPSTREAM.md'), 'utf8'));
  // The values below were read from https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt on 2026-10-04 (the
  // file's size, `curl -fsSL | sha256sum` and `git hash-object`); UPSTREAM.md records the same.
  expect(upstream.sha256).toBe('beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf');
  expect(sha256OfFile(IDNA_TEST_PATH)).toBe(upstream.sha256);
  expect(upstream.blobs.get('IdnaTestV2.txt')).toBe('fdee7e65891191df1bd24ba632d328d28a43c347');
  expect(gitBlobShaOfFile(IDNA_TEST_PATH)).toBe(upstream.blobs.get('IdnaTestV2.txt'));
  expect(gitBlobShaOfFile(join(FIXTURE_DIR, 'LICENSE.txt'))).toBe(upstream.blobs.get('LICENSE.txt'));
  const bytes = readFileSync(IDNA_TEST_PATH);
  expect(bytes.length).toBe(775_973);
  expect(bytes.includes(13)).toBe(false);
  const header = bytes.toString('utf8').split('\n').slice(0, 10);
  expect(header).toContain('# IdnaTestV2.txt');
  expect(header).toContain('# Version: 17.0.0');
  expect(readIdnaTestFile(bytes.toString('utf8')).length).toBe(ROWS_IN_FILE);
  expect(readFileSync(join(FIXTURE_DIR, 'LICENSE.txt'), 'utf8').startsWith('UNICODE LICENSE V3')).toBe(true);
});
