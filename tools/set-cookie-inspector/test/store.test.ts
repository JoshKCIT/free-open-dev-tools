import { describe, expect, it, vi } from 'vitest';
import { inspectCookies, SetCookieInspectorError, type CookieRow } from '../src/index';

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

describe('the cookie name prefixes and the empty cookie', () => {
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
});
