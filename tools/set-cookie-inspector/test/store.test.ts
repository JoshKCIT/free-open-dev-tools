import { expect, it, vi } from 'vitest';
import {
  inspectCookies,
  MAX_AGE_LIMIT_SECONDS,
  SetCookieInspectorError,
  type CookieRow,
  type RequestContext,
} from '../src/index';
import rowsFile from './fixtures/wpt/rows.json';

// Every literal below is retyped from draft-ietf-httpbis-rfc6265bis-22 (1 December 2025): the section is named beside it.
// The request is made from a secure address on site.example and every time is fixed, so no test reads a clock.

const SECURE_PAGE = 'https://site.example/account/login';
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function judge(
  lines: string,
  requestUrl = SECURE_PAGE,
  context: 'same-site' | 'top-level' | 'cross-site' = 'same-site',
) {
  return inspectCookies({ lines, requestUrl, context, nowMs: NOW, reveal: false });
}

function first(lines: string, requestUrl = SECURE_PAGE): CookieRow {
  const row = judge(lines, requestUrl).cookies[0];
  if (row === undefined) throw new Error('no row for the first line');
  return row;
}

it('the __Host- and __Secure- prefixes are enforced whatever their letter case', () => {
  // Section 5.4: "UAs MUST match cookie name prefixes case-insensitively", and the ten rejected and six accepted lines.
  for (const prefix of ['__Host-', '__host-', '__HOST-', '__hOsT-']) {
    // Section 5.4: Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/ is rejected (a Domain attribute).
    const withDomain = first(`Set-Cookie: ${prefix}SID=12345; Secure; Domain=site.example; Path=/`);
    expect(withDomain.decision.outcome).toBe('not-stored');
    expect(withDomain.decision.reason.startsWith('__Host-')).toBe(true);
    expect(withDomain.decision.failedStep?.step).toBe(21);
    // Section 5.4: Set-Cookie: __Host-SID=12345; Secure; Path=/ is accepted from a secure origin.
    expect(first(`Set-Cookie: ${prefix}SID=12345; Secure; Path=/`).decision.outcome).toBe('stored');
    // Section 5.4: Set-Cookie: __host-SID=12345; Secure is rejected (no Path attribute).
    expect(first(`Set-Cookie: ${prefix}SID=12345; Secure`).decision.outcome).toBe('not-stored');
    // Section 5.4: Set-Cookie: __Host-SID=12345 is rejected (no Secure attribute).
    expect(first(`Set-Cookie: ${prefix}SID=12345`).decision.outcome).toBe('not-stored');
    // Section 5.7 step 21: a Path attribute that is not / is refused too.
    expect(first(`Set-Cookie: ${prefix}SID=12345; Secure; Path=/account`).decision.outcome).toBe('not-stored');
  }
  for (const prefix of ['__Secure-', '__secure-', '__SECURE-', '__SeCuRe-']) {
    // Section 5.4: Set-Cookie: __Secure-SID=12345; Domain=site.example is rejected (no Secure attribute).
    const unsecured = first(`Set-Cookie: ${prefix}SID=12345; Domain=site.example`);
    expect(unsecured.decision.outcome).toBe('not-stored');
    expect(unsecured.decision.reason.startsWith('__Secure-')).toBe(true);
    expect(unsecured.decision.failedStep?.step).toBe(20);
    // Section 5.4: Set-Cookie: __Secure-SID=12345; Domain=site.example; Secure is accepted from a secure origin.
    expect(first(`Set-Cookie: ${prefix}SID=12345; Domain=site.example; Secure`).decision.outcome).toBe('stored');
  }
  // A prefix is matched at the start of the name only.
  expect(first('Set-Cookie: my__Host-SID=12345').decision.outcome).toBe('stored');
});

it('an empty paste shows nothing, a nameless cookie is stored and an empty name with an empty value is ignored', () => {
  // An empty paste, and one that is only spaces, tabs and line breaks, give no rows.
  expect(judge('').cookies).toHaveLength(0);
  expect(judge(' \t \r\n\n\r  \n').cookies).toHaveLength(0);
  // Section 5.6 step 3: no equals sign means an empty name and the whole text is the value.
  const nameless = first('Set-Cookie: abc');
  expect(nameless.name).toBe('');
  expect(nameless.value).toBe('abc');
  expect(nameless.decision.outcome).toBe('stored');
  // A leading equals sign gives an empty name and the rest as the value.
  const equalsFirst = first('=abc');
  expect(equalsFirst.name).toBe('');
  expect(equalsFirst.value).toBe('abc');
  expect(equalsFirst.decision.outcome).toBe('stored');
  // Section 5.7 step 2: an empty name and an empty value are ignored entirely.
  for (const line of ['=', 'Set-Cookie: =', 'Set-Cookie:', '= ; Secure', '  =  ']) {
    const row = first(line);
    expect(row.decision.outcome).toBe('ignored');
    expect(row.decision.failedStep?.step).toBe(2);
  }
  // Section 5.7 step 22: an empty name whose value starts with a prefix is refused in any letter case.
  expect(first('__Host-x').decision.outcome).toBe('not-stored');
  expect(first('__SECURE-x; Secure').decision.outcome).toBe('not-stored');
  expect(first('__Host-x').decision.failedStep?.step).toBe(22);
});

it('refusals name the line and never repeat pasted text', () => {
  const marker = 'LEAKMARK7Q';
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const refusal = (run: () => unknown): SetCookieInspectorError => {
    try {
      run();
    } catch (err) {
      if (err instanceof SetCookieInspectorError) return err;
      throw err;
    }
    throw new Error('the input was not refused');
  };
  const check = (run: () => unknown, part: string, line?: number): void => {
    const err = refusal(run);
    expect(err.part).toBe(part);
    expect(err.line).toBe(line);
    expect(err.message).not.toContain(marker);
    expect(err.message).not.toContain('LEAK');
    if (line !== undefined) expect(err.message).toContain(`Line ${line}`);
  };
  // A line over 16,384 characters, with a marker inside it, on the third line (a blank line counts in the numbering).
  const longLine = `a=${'b'.repeat(16_000)}${marker}${'c'.repeat(400)}`;
  check(() => judge(`x=1\n\n${longLine}`), 'lines', 3);
  // More than 100 attributes on one line.
  const manyAttributes = `x=1${`; ${marker}`.repeat(101)}`;
  check(() => judge(`y=2\n${manyAttributes}`), 'lines', 2);
  // More than 500 lines, blank lines not counted: line 501 is the first one past the limit.
  const manyLines = `${marker}=1\n`.repeat(501);
  check(() => judge(manyLines), 'lines', 501);
  // A paste over 262,144 characters.
  check(() => judge(`${marker}=${'v'.repeat(262_144)}`), 'lines');
  // An address that cannot be read, or is not http or https, never appears in the message.
  check(() => judge('a=1', `not a url ${marker}`), 'request url');
  check(() => judge('a=1', `ftp://host.example/${marker}`), 'request url');
  check(() => judge('a=1', `https://host.example/${'p'.repeat(9_000)}${marker}`), 'request url');
  // A time that is not a number.
  check(
    () =>
      inspectCookies({
        lines: 'a=1',
        requestUrl: SECURE_PAGE,
        context: 'same-site',
        nowMs: Number.NaN,
        reveal: false,
      }),
    'time',
  );
  // A control character inside a line is a cookie that is ignored, not a refusal, and the text is not repeated.
  const control = first(`${marker}=1\u0001`);
  expect(control.decision.outcome).toBe('ignored');
  expect(control.decision.reason).not.toContain('1\u0001');
  expect(control.decision.reason).not.toContain(marker);
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('the sixteen section 5.4 example lines of draft-ietf-httpbis-rfc6265bis-22 are stored or rejected as the draft says', () => {
  // Section 5.4: "The following are examples of Set-Cookie header fields that would be rejected by a conformant user agent."
  const rejected = [
    'Set-Cookie: __Secure-SID=12345; Domain=site.example',
    'Set-Cookie: __secure-SID=12345; Domain=site.example',
    'Set-Cookie: __SECURE-SID=12345; Domain=site.example',
    'Set-Cookie: __Host-SID=12345',
    'Set-Cookie: __host-SID=12345; Secure',
    'Set-Cookie: __host-SID=12345; Domain=site.example',
    'Set-Cookie: __HOST-SID=12345; Domain=site.example; Path=/',
    'Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/',
    'Set-Cookie: __host-SID=12345; Secure; Domain=site.example; Path=/',
    'Set-Cookie: __HOST-SID=12345; Secure; Domain=site.example; Path=/',
  ];
  // Section 5.4: "Whereas the following Set-Cookie header fields would be accepted if set from a secure origin."
  const accepted = [
    'Set-Cookie: __Secure-SID=12345; Domain=site.example; Secure',
    'Set-Cookie: __secure-SID=12345; Domain=site.example; Secure',
    'Set-Cookie: __SECURE-SID=12345; Domain=site.example; Secure',
    'Set-Cookie: __Host-SID=12345; Secure; Path=/',
    'Set-Cookie: __host-SID=12345; Secure; Path=/',
    'Set-Cookie: __HOST-SID=12345; Secure; Path=/',
  ];
  expect(rejected).toHaveLength(10);
  expect(accepted).toHaveLength(6);
  for (const line of rejected) {
    const row = first(line);
    expect(row.decision.outcome, line).toBe('not-stored');
    expect(row.decision.failedStep?.step, line).toBeGreaterThanOrEqual(20);
  }
  for (const line of accepted) expect(first(line).decision.outcome, line).toBe('stored');
  // From a plain http address the accepted six are refused too: every one of them has the Secure attribute (step 13).
  for (const line of accepted) {
    const row = first(line, 'http://site.example/account/login');
    expect(row.decision.outcome, line).toBe('not-stored');
    expect(row.decision.failedStep?.step, line).toBe(13);
  }
});

it('a Domain must match the response host, a domain cookie matches subdomains and an address host matches only itself', () => {
  // Section 5.1.3 and 5.7 step 10: the host must domain-match the Domain attribute, or the cookie is refused.
  const outcome = (line: string, url: string): string => first(line, url).decision.outcome;
  expect(outcome('a=1; Domain=site.example', 'https://www.site.example/')).toBe('stored');
  expect(outcome('a=1; Domain=www.site.example', 'https://site.example/')).toBe('not-stored');
  expect(outcome('a=1; Domain=other.example', 'https://site.example/')).toBe('not-stored');
  expect(outcome('a=1; Domain=ite.example', 'https://site.example/')).toBe('not-stored');
  expect(outcome('a=1; Domain=example', 'https://site.example/')).toBe('stored');
  expect(first('a=1; Domain=other.example', 'https://site.example/').decision.failedStep?.step).toBe(10);
  // The comparison is in lower case.
  expect(outcome('a=1; Domain=SITE.EXAMPLE', 'https://Site.Example/')).toBe('stored');
  // An IP address is domain-matched only when identical (the string must be a host name for the suffix rule).
  expect(outcome('a=1; Domain=127.0.0.1', 'http://127.0.0.1/')).toBe('stored');
  expect(outcome('a=1; Domain=0.0.1', 'http://127.0.0.1/')).toBe('not-stored');
  expect(outcome('a=1; Domain=0.1', 'http://127.0.0.1/')).toBe('not-stored');
  // Step 8: a Domain with a character that is not in CHAR (here a non-ASCII letter) ignores the cookie.
  const accent = String.fromCodePoint(0xe9);
  const nonChar = first(`a=1; Domain=site${accent}.example`, 'https://site.example/');
  expect(nonChar.decision.outcome).toBe('not-stored');
  expect(nonChar.decision.failedStep?.step).toBe(8);
  // The sentence about where the cookie is sent says which of the two it is.
  expect(first('a=1').sentTo).toContain('site.example');
  expect(first('a=1').sentTo).toContain('only');
  expect(first('a=1; Domain=site.example').sentTo).toContain('subdomains');
  // Localhost and the loopback addresses are secure hosts, so Secure is accepted over plain http there.
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/']) {
    expect(first('a=1; Secure', url).decision.outcome, url).toBe('stored');
  }
  expect(first('a=1; Secure', 'http://site.example/').decision.outcome).toBe('not-stored');
});

it('a time too near the end of the date range is refused as a time, never thrown as a date error', () => {
  // The last moment JavaScript can write is 8,640,000,000,000,000 ms after 1970. A lifetime of up to 400 days is counted
  // from the time of the response, so the time must leave room for it.
  const at = (nowMs: number, lines = 'a=1; Max-Age=100') =>
    inspectCookies({ lines, requestUrl: SECURE_PAGE, context: 'same-site', nowMs, reveal: false });
  const last = 8_640_000_000_000_000;
  const room = MAX_AGE_LIMIT_SECONDS * 1000;
  for (const nowMs of [last, last - room + 1, -last - 1, Number.POSITIVE_INFINITY]) {
    let caught: unknown = null;
    try {
      at(nowMs);
    } catch (err) {
      caught = err;
    }
    expect(caught, String(nowMs)).toBeInstanceOf(SetCookieInspectorError);
    expect((caught as SetCookieInspectorError).part).toBe('time');
  }
  // The last time that leaves room is read, with the longest lifetime and an Expires far in the future.
  const edge = at(last - room, 'a=1; Max-Age=999999999\nb=2; Expires=Fri, 31 Dec 9999 23:59:59 GMT');
  expect(edge.cookies[0]?.decision.lifetime?.clamped).toBe(true);
  expect(edge.cookies[0]?.decision.lifetime?.until).toBe('+275760-09-13 00:00:00 UTC');
  expect(edge.cookies[1]?.decision.outcome).toBe('stored-then-deleted');
  expect(at(-last).cookies[0]?.decision.outcome).toBe('stored');
});

it('a Domain is put in lower case for ASCII letters only, so a non-ASCII letter still reaches step 8', () => {
  // Section 5.6.3 converts the Domain to lower case and section 5.7 step 8 then ignores a Domain with a character outside
  // CHAR. KELVIN SIGN (U+212A) lower-cases to the ASCII k in JavaScript, which would hide it from step 8.
  const kelvin = String.fromCodePoint(0x212a);
  const row = first(`a=1; Domain=ban${kelvin}.example`, 'https://www.bank.example/');
  expect(row.decision.outcome).toBe('not-stored');
  expect(row.decision.failedStep?.step).toBe(8);
  // A leading dot and ASCII capitals are still folded as before.
  expect(first('a=1; Domain=.BANK.Example', 'https://www.bank.example/').decision.outcome).toBe('stored');
  expect(first('a=1; Domain=.BANK.Example', 'https://www.bank.example/').decision.scope?.domain).toBe('bank.example');
});

it('a cookie whose SameSite is not None is ignored on a cross-site request that is not a top-level navigation', () => {
  // Section 5.7 step 18: a SameSite that is not None (so Default, Lax or Strict) on a cross-site request is ignored
  // unless the request navigates a top-level traversable (a top-level navigation, step 18.3).
  const judgeIn = (line: string, context: RequestContext, url = SECURE_PAGE): CookieRow => {
    const row = judge(line, url, context).cookies[0];
    if (row === undefined) throw new Error('no row');
    return row;
  };
  for (const attribute of [
    '',
    '; SameSite=Lax',
    '; SameSite=Strict',
    '; SameSite=lax',
    '; SameSite=Bogus',
    '; SameSite',
  ]) {
    const crossSite = judgeIn(`a=1${attribute}`, 'cross-site');
    expect(crossSite.decision.outcome, attribute).toBe('ignored');
    expect(crossSite.decision.failedStep, attribute).toMatchObject({ section: '5.7', step: 18 });
    expect(judgeIn(`a=1${attribute}`, 'same-site').decision.outcome, attribute).toBe('stored');
    expect(judgeIn(`a=1${attribute}`, 'top-level').decision.outcome, attribute).toBe('stored');
  }
  // SameSite=None is not ignored on a cross-site request, but it needs Secure (step 19).
  expect(judgeIn('a=1; SameSite=None; Secure', 'cross-site').decision.outcome).toBe('stored');
  expect(judgeIn('a=1; SameSite=none; secure', 'cross-site').decision.outcome).toBe('stored');
  for (const context of ['same-site', 'top-level', 'cross-site'] as const) {
    const refused = judgeIn('a=1; SameSite=None', context);
    expect(refused.decision.outcome, context).toBe('not-stored');
    expect(refused.decision.failedStep, context).toMatchObject({ section: '5.7', step: 19 });
  }
  // Step 19 is checked after step 18: a cross-site Lax cookie never gets that far.
  expect(judgeIn('a=1; SameSite=Lax; Secure', 'cross-site').decision.failedStep?.step).toBe(18);
  // The wording says which kind of request it was and never promises what a browser does.
  expect(judgeIn('a=1', 'cross-site').decision.reason).toContain('cross-site');
});

interface WptRow {
  source: string;
  name: string;
  lines: (string | { nameLength: number; valueLength: number; suffix?: string; dropFirst?: number })[];
  requestUrl: string;
  context: RequestContext;
  nowMs: number;
  expect: {
    outcome: string;
    name?: string;
    value?: string;
    lifetime?: string;
    lifetimeS?: number;
    clamped?: boolean;
    secureOnly?: boolean;
  };
}

interface NotReproduced {
  source: string;
  name: string;
  lines: string[];
  requestUrl: string;
  context: RequestContext;
  nowMs: number;
  wpt: { shouldExist: boolean };
  draft: { outcome: string };
  why: string;
}

interface RowsFile {
  wptCommit: string;
  rows: WptRow[];
  windowJsRows: WptRow[];
  notReproduced: NotReproduced[];
}

const WPT = rowsFile as unknown as RowsFile;

/** The text of a row line: a string as it is, or the "t" x n, "=", "1" x v cookie of cookieStringWithNameAndValueLengths. */
function lineText(line: WptRow['lines'][number]): string {
  if (typeof line === 'string') return line;
  const text = `${'t'.repeat(line.nameLength)}=${'1'.repeat(line.valueLength)}${line.suffix ?? ''}`;
  return line.dropFirst === undefined ? text : text.slice(line.dropFirst);
}

/** Judges one row and compares it with what the file and the draft expect. Returns the messages of every difference. */
function differences(row: WptRow): string[] {
  const out: string[] = [];
  const texts = row.lines.map(lineText);
  const report = inspectCookies({
    lines: texts.join('\n'),
    requestUrl: row.requestUrl,
    context: row.context,
    nowMs: row.nowMs,
    reveal: true,
  });
  if (report.cookies.length !== texts.length) {
    return [`${row.source} ${row.name}: ${report.cookies.length} rows for ${texts.length} lines`];
  }
  report.cookies.forEach((cookie) => {
    const where = `${row.source} ${row.name}`;
    if (cookie.decision.outcome !== row.expect.outcome) {
      out.push(`${where}: outcome ${cookie.decision.outcome}, expected ${row.expect.outcome}`);
    }
    if (row.expect.name !== undefined && cookie.name !== row.expect.name) out.push(`${where}: name differs`);
    if (row.expect.value !== undefined && cookie.value !== row.expect.value) out.push(`${where}: value differs`);
    const lifetime = cookie.decision.lifetime;
    if (row.expect.lifetime === 'session' && lifetime?.kind !== 'session') out.push(`${where}: not a session cookie`);
    if (row.expect.lifetimeS !== undefined && lifetime?.seconds !== row.expect.lifetimeS) {
      out.push(`${where}: lifetime ${String(lifetime?.seconds)}, expected ${row.expect.lifetimeS}`);
    }
    if (row.expect.clamped !== undefined && lifetime?.clamped !== row.expect.clamped)
      out.push(`${where}: clamped differs`);
    if (row.expect.secureOnly !== undefined && cookie.decision.scope?.secureOnly !== row.expect.secureOnly) {
      out.push(`${where}: Secure differs`);
    }
  });
  return out;
}

it('the re-expressed web-platform-tests size, max-age and expires rows give the result the draft gives', () => {
  expect(WPT.wptCommit).toBe('a419ab2055dd4a747dfae5c407ae9a6d10aa08ca');
  const chosen = WPT.rows.filter(
    (row) =>
      row.source.startsWith('cookies/size/name-and-value.html:') ||
      row.source.startsWith('cookies/attributes/max-age.html:') ||
      row.source.startsWith('cookies/attributes/expires.html:'),
  );
  expect(chosen.length).toBeGreaterThanOrEqual(30);
  expect(chosen.flatMap(differences)).toEqual([]);
});

it('the re-expressed web-platform-tests invalid-attribute and prefix rows give the result the draft gives', () => {
  const chosen = [
    ...WPT.rows.filter(
      (row) => row.source.startsWith('cookies/attributes/invalid.html:') || row.source.startsWith('cookies/prefix/'),
    ),
    ...WPT.windowJsRows,
  ];
  expect(chosen.length).toBeGreaterThanOrEqual(90);
  expect(chosen.flatMap(differences)).toEqual([]);
  // Every row is judged once and every one of the files named in UPSTREAM.md is represented.
  const files = new Set(
    [...WPT.rows, ...WPT.windowJsRows, ...WPT.notReproduced].map((row) => row.source.split(':')[0]),
  );
  expect(files.size).toBe(11);
});

it('the published cases the page does not reproduce are listed with the draft outcome and the reason', () => {
  // Pitfall 6: a published case that does not reproduce is listed by name with its reason, never dropped.
  expect(WPT.notReproduced.map((row) => row.source)).toEqual([
    'cookies/prefix/__host.explicit-path.https.window.js:106',
    'cookies/prefix/__host.explicit-path.https.window.js:113',
    'cookies/prefix/__Http.https.html:35',
    'cookies/prefix/__Http.https.html:43',
    'cookies/prefix/__Host-Http.https.html:28',
    'cookies/prefix/__Host-Http.https.html:52',
  ]);
  for (const row of WPT.notReproduced) {
    expect(row.why.length, row.source).toBeGreaterThan(40);
    const report = inspectCookies({
      lines: row.lines.join('\n'),
      requestUrl: row.requestUrl,
      context: row.context,
      nowMs: row.nowMs,
      reveal: true,
    });
    // The page gives the outcome the draft text gives, which is what the row says.
    expect(report.cookies[0]?.decision.outcome, row.source).toBe(row.draft.outcome);
    // Five of the six differ from the file: the file expects a refusal and the draft stores the cookie.
    const fileWantsStored = row.wpt.shouldExist;
    const pageStores = report.cookies[0]?.decision.outcome === 'stored';
    if (row.draft.outcome === 'stored') expect(pageStores && !fileWantsStored, row.source).toBe(true);
  }
});
