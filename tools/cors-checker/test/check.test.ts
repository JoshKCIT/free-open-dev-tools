import { expect, it } from 'vitest';
import { CorsCheckerError, checkCors, type CorsInput } from '../src/index';

/*
 * The first rows, taken from the Fetch Standard (https://fetch.spec.whatwg.org/ at commit e9460d1) and from the
 * web-platform-tests file fetch/api/cors/cors-preflight-star.any.js at commit a419ab2 (its line numbers are cited at each
 * row). The expected values are what the standard and that file's assertions say, worked out by hand: they are never
 * copied from this package's output.
 */

const PAGE = 'http://page.example:8000';
const TARGET = 'http://remote.example:8000/preflight.py';
const MARKER = 'ZQXMARKERZQX';

function input(parts: Partial<CorsInput> = {}): CorsInput {
  return {
    pageOrigin: PAGE,
    url: TARGET,
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin',
    requestHeaders: '',
    preflightStatus: 200,
    preflightHeaders: '',
    responseStatus: 200,
    responseHeaders: '',
    ...parts,
  };
}

/** The answer preflight.py gives a preflight: an Access-Control-Allow-Origin of * unless the row names an origin. */
function answer(options: { origin?: string; methods?: string; headers?: string; credentials?: boolean }): string {
  const lines = [`Access-Control-Allow-Origin: ${options.origin ?? '*'}`];
  if (options.credentials) lines.push('Access-Control-Allow-Credentials: true');
  if (options.methods !== undefined) lines.push(`Access-Control-Allow-Methods: ${options.methods}`);
  if (options.headers !== undefined) lines.push(`Access-Control-Allow-Headers: ${options.headers}`);
  return lines.join('\n');
}

function failureOf(parts: Partial<CorsInput>): string | null {
  return checkCors(input(parts)).firstFailure?.id ?? null;
}

function resultOf(report: ReturnType<typeof checkCors>, id: string): string | undefined {
  return report.steps.find((step) => step.id === id)?.result;
}

it('a wildcard never covers Authorization and never applies when credentials are included', () => {
  // cors-preflight-star.any.js:85: "Authorization" header can't be wildcarded.
  const blocked = checkCors(
    input({
      method: 'POST',
      requestHeaders: 'Authorization: 123',
      preflightHeaders: answer({ methods: '*', headers: '*' }),
      responseHeaders: 'Access-Control-Allow-Origin: *',
    }),
  );
  expect(blocked.plan.preflight.sent).toBe(true);
  expect(blocked.plan.preflight.accessControlRequestHeaders).toBe('authorization');
  expect(blocked.verdict).toBe('blocked-preflight');
  expect(blocked.firstFailure?.id).toBe('preflight-authorization');
  expect(resultOf(blocked, 'preflight-headers')).toBe('skipped');
  expect(resultOf(blocked, 'response-acao-present')).toBe('skipped');
  expect(blocked.steps.filter((step) => step.result === 'fail')).toHaveLength(1);

  // cors-preflight-star.any.js:86: naming Authorization next to the wildcard is enough.
  const named = checkCors(
    input({
      method: 'POST',
      requestHeaders: 'Authorization: 123',
      preflightHeaders: answer({ methods: '*', headers: '*, Authorization' }),
      responseHeaders: 'Access-Control-Allow-Origin: *',
    }),
  );
  expect(named.verdict).toBe('readable');
  expect(named.firstFailure).toBeNull();

  // cors-preflight-star.any.js:41, 42 and 44: with credentials included * is not a wildcard for methods or headers.
  const include = {
    credentials: 'include',
    responseHeaders: `Access-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Credentials: true`,
  };
  const credentialed = answer({ origin: PAGE, credentials: true, methods: '*', headers: '*' });
  expect(failureOf({ ...include, method: 'OK', requestHeaders: 'X-Test: 1', preflightHeaders: credentialed })).toBe(
    'preflight-method',
  );
  expect(
    failureOf({
      ...include,
      method: 'PUT',
      preflightHeaders: answer({ origin: PAGE, credentials: true, methods: '*', headers: '' }),
    }),
  ).toBe('preflight-method');
  expect(failureOf({ ...include, method: 'GET', requestHeaders: 'X-Test: 1', preflightHeaders: credentialed })).toBe(
    'preflight-headers',
  );

  // cors-preflight-star.any.js:46: a literal * is matched letter for letter, even with credentials.
  const literal = checkCors(
    input({
      ...include,
      method: '*',
      requestHeaders: '*: 1',
      preflightHeaders: credentialed,
    }),
  );
  expect(literal.verdict).toBe('readable');
});

it('with no request headers a simple GET needs no preflight and an empty response fails at the missing Access-Control-Allow-Origin', () => {
  const report = checkCors(input());
  expect(report.plan.preflight.sent).toBe(false);
  expect(report.plan.preflight.accessControlRequestHeaders).toBeUndefined();
  expect(report.verdict).toBe('blocked-response');
  expect(report.firstFailure?.id).toBe('response-acao-present');
  expect(report.steps.filter((step) => step.id.startsWith('preflight-') && step.result !== 'info')).toHaveLength(0);
  expect(report.steps.filter((step) => step.result === 'fail')).toHaveLength(1);
  // cors-no-preflight.any.js:88 shows the same request with an answer that allows any origin: it is readable.
  const allowed = checkCors(input({ responseHeaders: 'Access-Control-Allow-Origin: *' }));
  expect(allowed.verdict).toBe('readable');
  expect(allowed.firstFailure).toBeNull();
});

it('refusals name the part and the line and never repeat pasted text', () => {
  function refusal(parts: Partial<CorsInput>): CorsCheckerError {
    try {
      checkCors(input(parts));
    } catch (err) {
      expect(err).toBeInstanceOf(CorsCheckerError);
      return err as CorsCheckerError;
    }
    throw new Error('expected a refusal');
  }

  const malformed = refusal({ responseHeaders: `Access-Control-Allow-Origin: *\n${MARKER} without a colon` });
  expect(malformed.part).toBe('response headers');
  expect(malformed.line).toBe(2);
  expect(malformed.message).toContain('response headers');
  expect(malformed.message).toContain('Line 2');
  expect(malformed.message).not.toContain(MARKER);

  const badName = refusal({ requestHeaders: `X-One: 1\nBad ${MARKER}: 2` });
  expect([badName.part, badName.line]).toEqual(['request headers', 2]);
  expect(badName.message).not.toContain(MARKER);

  const preflight = refusal({ method: 'PUT', preflightHeaders: `${MARKER}` });
  expect([preflight.part, preflight.line]).toEqual(['preflight headers', 1]);
  expect(preflight.message).not.toContain(MARKER);

  const tooLong = refusal({ responseHeaders: `X-A: ${'a'.repeat(65_536)}${MARKER}` });
  expect(tooLong.part).toBe('response headers');
  expect(tooLong.message).toContain('65,536');
  expect(tooLong.message).not.toContain(MARKER);

  const tooManyLines = refusal({ requestHeaders: 'X-A: 1\n'.repeat(500) + MARKER });
  expect([tooManyLines.part, tooManyLines.line]).toEqual(['request headers', 501]);
  expect(tooManyLines.message).toContain('500');
  expect(tooManyLines.message).not.toContain(MARKER);

  const longUrl = refusal({ url: `http://remote.example/${MARKER}${'a'.repeat(8_192)}` });
  expect(longUrl.part).toBe('url');
  expect(longUrl.message).toContain('8,192');
  expect(longUrl.message).not.toContain(MARKER);

  const longMethod = refusal({ method: MARKER + 'A'.repeat(64) });
  expect(longMethod.part).toBe('method');
  expect(longMethod.message).toContain('64');
  expect(longMethod.message).not.toContain(MARKER);

  const notAUrl = refusal({ url: `${MARKER} not an address` });
  expect(notAUrl.part).toBe('url');
  expect(notAUrl.message).not.toContain(MARKER);

  const notAScheme = refusal({ url: `ftp://${MARKER}.example/` });
  expect(notAScheme.part).toBe('url');
  expect(notAScheme.message).not.toContain(MARKER);

  const badOrigin = refusal({ pageOrigin: `${MARKER}` });
  expect(badOrigin.part).toBe('page origin');
  expect(badOrigin.message).not.toContain(MARKER);

  const badMethod = refusal({ method: `GE T ${MARKER}` });
  expect(badMethod.part).toBe('method');
  expect(badMethod.message).not.toContain(MARKER);
});
