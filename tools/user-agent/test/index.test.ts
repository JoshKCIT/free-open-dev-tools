import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseUserAgent, UserAgentError, MAX_USER_AGENT_LENGTH } from '../src/index';
import { tokenizeUserAgent } from '../src/tokens';

const here = dirname(fileURLToPath(import.meta.url));

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

function readFixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

const rfc9110 = readFixture('rfc9110', 'rfc9110.txt');

interface BowserAcceptanceEntry {
  ua: string;
  spec: {
    browser?: { name?: string; version?: string };
    os?: { name?: string; version?: string; versionName?: string };
    platform?: { type?: string; vendor?: string; model?: string };
    engine?: { name?: string };
  };
}

const bowserAcceptanceYaml = readFixture('bowser-acceptance', 'useragentstrings.yml');
const bowserAcceptance = parseYaml(bowserAcceptanceYaml) as Record<string, BowserAcceptanceEntry[]>;
const bowserAcceptanceEntries: BowserAcceptanceEntry[] = Object.values(bowserAcceptance).flat();

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/30.0.1599.17 Safari/537.36';
const REDUCED_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

it('the RFC 9110 section 10.1.5 example is split into its product tokens and versions', () => {
  const { tokens } = tokenizeUserAgent('CERN-LineMode/2.15 libwww/2.17b3');
  expect(tokens).toEqual([
    { product: 'CERN-LineMode', version: '2.15', comments: [] },
    { product: 'libwww', version: '2.17b3', comments: [] },
  ]);
  // RFC 9110 section 10.1.5's own example.
  expect(stripWhitespace(rfc9110)).toContain(stripWhitespace('User-Agent: CERN-LineMode/2.15 libwww/2.17b3'));
});

it('comments in parentheses, nested comments and quoted pairs are read as RFC 9110 defines them', () => {
  const withComments = tokenizeUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
  );
  expect(withComments.wellFormed).toBe(true);
  expect(withComments.tokens[0]).toEqual({
    product: 'Mozilla',
    version: '5.0',
    comments: ['Windows NT 10.0; Win64; x64'],
  });
  expect(withComments.tokens[1]).toEqual({
    product: 'AppleWebKit',
    version: '537.36',
    comments: ['KHTML, like Gecko'],
  });

  const nested = tokenizeUserAgent('A/1 (outer (inner) still outer)');
  expect(nested.wellFormed).toBe(true);
  expect(nested.tokens[0]!.comments).toEqual(['outer (inner) still outer']);

  const quotedPair = tokenizeUserAgent('A/1 (a \\) b)');
  expect(quotedPair.wellFormed).toBe(true);
  expect(quotedPair.tokens[0]!.comments).toEqual(['a \\) b']);
});

it('every bowser acceptance fixture maps to the same browser, engine, OS and platform in this report', () => {
  expect(bowserAcceptanceEntries.length).toBeGreaterThan(0);

  // Named departures from bowser's own acceptance data, if this tool's
  // mapping ever disagrees with bowser's own reported fields. Every entry
  // must name a ua string that exists in the vendored fixture file above.
  const KNOWN_DIFFERENCES: string[] = [];

  const failing: string[] = [];
  for (const entry of bowserAcceptanceEntries) {
    const report = parseUserAgent(entry.ua);
    const same =
      (entry.spec.browser?.name ?? undefined) === (report.browser.name ?? undefined) &&
      (entry.spec.browser?.version ?? undefined) === (report.browser.version ?? undefined) &&
      (entry.spec.engine?.name ?? undefined) === (report.engine.name ?? undefined) &&
      (entry.spec.os?.name ?? undefined) === (report.os.name ?? undefined) &&
      (entry.spec.os?.version ?? undefined) === (report.os.version ?? undefined) &&
      (entry.spec.os?.versionName ?? undefined) === (report.os.versionName ?? undefined) &&
      (entry.spec.platform?.type ?? undefined) === (report.device.type ?? undefined) &&
      (entry.spec.platform?.vendor ?? undefined) === (report.device.vendor ?? undefined) &&
      (entry.spec.platform?.model ?? undefined) === (report.device.model ?? undefined);
    if (!same) failing.push(entry.ua);
  }

  for (const name of KNOWN_DIFFERENCES) {
    expect(bowserAcceptanceEntries.some((e) => e.ua === name)).toBe(true);
  }
  expect(failing.sort()).toEqual(KNOWN_DIFFERENCES.sort());
});

it('a reduced Chromium User-Agent is recognised and lowers the confidence with a reason', () => {
  const report = parseUserAgent(REDUCED_CHROME_UA);
  expect(report.reduced).toBe(true);
  expect(report.confidence).toBe('medium');
  expect(report.reasons.some((r) => r.toLowerCase().includes('reduced'))).toBe(true);

  const notReduced = parseUserAgent(DESKTOP_CHROME_UA);
  expect(notReduced.reduced).toBe(false);
});

it('confidence is high only when browser, engine and OS are all recognised', () => {
  const full = parseUserAgent(DESKTOP_CHROME_UA);
  expect(full.browser.name).toBe('Chrome');
  expect(full.engine.name).toBeTruthy();
  expect(full.os.name).toBeTruthy();
  expect(full.confidence).toBe('high');

  // A real Opera 12 UA bowser recognises the browser and OS for, but not the engine.
  const missingEngine = parseUserAgent('Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.0) Opera 12.14');
  expect(missingEngine.browser.name).toBe('Opera');
  expect(missingEngine.os.name).toBeTruthy();
  expect(missingEngine.engine.name).toBeUndefined();
  expect(missingEngine.confidence).toBe('medium');
});

it('an empty or unrecognised string gets low confidence and the spoofing and Client Hints note is always present', () => {
  const empty = parseUserAgent('');
  expect(empty.confidence).toBe('low');
  expect(empty.browser.name).toBeUndefined();

  const unrecognised = parseUserAgent('hello');
  expect(unrecognised.confidence).toBe('low');

  const NOTE =
    'A User-Agent string is whatever the client chose to send, so it can be spoofed, and Client Hints (the Sec-CH-UA headers) are not available from a pasted string.';
  expect(empty.note).toBe(NOTE);
  expect(unrecognised.note).toBe(NOTE);
  expect(parseUserAgent(DESKTOP_CHROME_UA).note).toBe(NOTE);
});

it('an input over 8192 characters is refused rather than parsed', () => {
  const atLimit = 'A'.repeat(MAX_USER_AGENT_LENGTH);
  expect(() => parseUserAgent(atLimit)).not.toThrow();

  const overLimit = 'A'.repeat(MAX_USER_AGENT_LENGTH + 1);
  expect(() => parseUserAgent(overLimit)).toThrow(UserAgentError);
  expect(() => parseUserAgent(overLimit)).toThrow(/8192/);
});

it('nothing is written to the console while parsing', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    parseUserAgent('');
    parseUserAgent('hello');
    parseUserAgent(DESKTOP_CHROME_UA);
    parseUserAgent(REDUCED_CHROME_UA);
    parseUserAgent('Mozilla/5.0 (unbalanced');
    parseUserAgent('A/1 (a \\) b) \u0000\u0001 weird bytes');
    try {
      parseUserAgent('A'.repeat(MAX_USER_AGENT_LENGTH + 1));
    } catch {
      // expected: only checking console output here
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
