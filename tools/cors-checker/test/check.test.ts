import { expect, it } from 'vitest';
import {
  CorsCheckerError,
  checkCors,
  describeRequest,
  extractHeaderListValues,
  parseHeaderBlock,
  type CorsInput,
} from '../src/index';
import rowsFile from './fixtures/wpt/rows.json';

/*
 * Rows and rules, taken from the Fetch Standard (https://fetch.spec.whatwg.org/ at commit e9460d1) and from the
 * web-platform-tests folder fetch/api/cors at commit a419ab2, re-expressed as the rows of fixtures/wpt/rows.json (each row
 * cites its file and line). The expected values are what the standard and those files' assertions say, worked out by hand:
 * they are never copied from this package's output.
 */

const PAGE = 'http://page.example:8000';
const TARGET = 'http://remote.example:8000/preflight.py';
const MARKER = 'ZQXMARKERZQX';

type Pairs = [string, string][];
interface Row {
  source: string;
  name: string;
  engine: boolean;
  request: {
    pageOrigin: string;
    url: string;
    method: string;
    mode: 'cors' | 'no-cors';
    credentials: 'omit' | 'same-origin' | 'include';
    headers: Pairs;
  };
  preflight?: { status: number; headers: Pairs };
  response: { status: number; headers: Pairs };
  expect: {
    preflight: boolean;
    requestHeadersLine: string | null;
    readable: boolean;
    firstFailure: string | null;
    verdict: string;
    readableHeaders?: string[];
    notReadable?: string[];
  };
}
const rows = (rowsFile as unknown as { rows: Row[] }).rows;

function lines(pairs: Pairs): string {
  return pairs.map(([name, value]) => `${name}: ${value}`).join('\n');
}

function inputOf(row: Row): CorsInput {
  return {
    pageOrigin: row.request.pageOrigin,
    url: row.request.url,
    method: row.request.method,
    mode: row.request.mode,
    credentials: row.request.credentials,
    requestHeaders: lines(row.request.headers),
    preflightStatus: row.preflight?.status ?? 204,
    preflightHeaders: row.preflight ? lines(row.preflight.headers) : '',
    responseStatus: row.response.status,
    responseHeaders: lines(row.response.headers),
  };
}

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
  const out = [`Access-Control-Allow-Origin: ${options.origin ?? '*'}`];
  if (options.credentials) out.push('Access-Control-Allow-Credentials: true');
  if (options.methods !== undefined) out.push(`Access-Control-Allow-Methods: ${options.methods}`);
  if (options.headers !== undefined) out.push(`Access-Control-Allow-Headers: ${options.headers}`);
  return out.join('\n');
}

function failureOf(parts: Partial<CorsInput>): string | null {
  return checkCors(input(parts)).firstFailure?.id ?? null;
}

function resultOf(report: ReturnType<typeof checkCors>, id: string): string | undefined {
  return report.steps.find((step) => step.id === id)?.result;
}

function readableNames(report: ReturnType<typeof checkCors>): string[] {
  return report.readable.filter((header) => header.readable).map((header) => header.name.toLowerCase());
}

it('the preflight decision and the Access-Control-Request-Headers line match every re-expressed web-platform-tests row', () => {
  expect(rows.length).toBeGreaterThanOrEqual(80);
  const problems: string[] = [];
  for (const row of rows) {
    try {
      const report = checkCors(inputOf(row));
      const line = report.plan.preflight.accessControlRequestHeaders ?? null;
      if (report.plan.preflight.sent !== row.expect.preflight) {
        problems.push(
          `${row.source} (${row.name}): preflight sent is ${report.plan.preflight.sent}, the row says ${row.expect.preflight}`,
        );
      }
      if (line !== row.expect.requestHeadersLine) {
        problems.push(
          `${row.source} (${row.name}): Access-Control-Request-Headers is ${line}, the row says ${row.expect.requestHeadersLine}`,
        );
      }
    } catch (err) {
      problems.push(`${row.source} (${row.name}): refused with ${(err as Error).message}`);
    }
  }
  expect(problems).toEqual([]);
});

it('the CORS check passes or fails every re-expressed web-platform-tests row and names the first failing rule', () => {
  const problems: string[] = [];
  for (const row of rows) {
    try {
      const report = checkCors(inputOf(row));
      const readable = report.verdict === 'readable';
      if (readable !== row.expect.readable) {
        problems.push(`${row.source} (${row.name}): readable is ${readable}, the row says ${row.expect.readable}`);
      }
      if (report.verdict !== row.expect.verdict) {
        problems.push(`${row.source} (${row.name}): verdict is ${report.verdict}, the row says ${row.expect.verdict}`);
      }
      const first = report.firstFailure?.id ?? null;
      if (first !== row.expect.firstFailure) {
        problems.push(
          `${row.source} (${row.name}): first failure is ${first}, the row says ${row.expect.firstFailure}`,
        );
      }
      if (report.steps.filter((step) => step.result === 'fail').length !== (first === null ? 0 : 1)) {
        problems.push(`${row.source} (${row.name}): exactly one step must fail when the response is blocked`);
      }
    } catch (err) {
      problems.push(`${row.source} (${row.name}): refused with ${(err as Error).message}`);
    }
  }
  expect(problems).toEqual([]);
});

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
    credentials: 'include' as const,
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
  const literal = checkCors(input({ ...include, method: '*', requestHeaders: '*: 1', preflightHeaders: credentialed }));
  expect(literal.verdict).toBe('readable');
});

it('an Access-Control-Allow-Headers or Access-Control-Allow-Methods value that is not a list of tokens fails the whole preflight', () => {
  // cors-preflight-response-validation.any.js: a space inside a name fails even though x-force-preflight is listed.
  const bad = (preflightHeaders: string) =>
    checkCors(
      input({
        requestHeaders: 'x-force-preflight: ',
        preflightHeaders,
        responseHeaders: 'Access-Control-Allow-Origin: *',
      }),
    );
  const headersBad = bad(answer({ headers: 'x-force-preflight,Bad value' }));
  expect(headersBad.firstFailure?.id).toBe('preflight-lists');
  expect(headersBad.firstFailure?.detail).toContain('Access-Control-Allow-Headers');
  expect(headersBad.firstFailure?.detail).toContain('line 2');
  expect(headersBad.firstFailure?.detail).not.toContain('Bad value');
  const methodsBad = bad(answer({ headers: 'x-force-preflight', methods: 'Bad value' }));
  expect(methodsBad.firstFailure?.id).toBe('preflight-lists');
  expect(methodsBad.firstFailure?.detail).toContain('Access-Control-Allow-Methods');
  // One bad line fails the whole header even when another line of the same name is fine.
  expect(
    bad(
      'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: x-force-preflight\nAccess-Control-Allow-Headers: "quoted"',
    ).firstFailure?.id,
  ).toBe('preflight-lists');

  // The elements of a list: spaces and tabs around them go, empty elements are allowed, every element is a token.
  const list = (text: string) =>
    extractHeaderListValues(parseHeaderBlock(text, 'response headers').entries, 'access-control-allow-headers');
  expect(list('X: 1')).toBeNull();
  expect(list('Access-Control-Allow-Headers: a, b ,\tc')).toEqual(['a', 'b', 'c']);
  expect(list('Access-Control-Allow-Headers: a,,b,')).toEqual(['a', 'b']);
  expect(list('Access-Control-Allow-Headers:')).toEqual([]);
  expect(list('Access-Control-Allow-Headers: a\naccess-control-allow-headers: b, c')).toEqual(['a', 'b', 'c']);
  for (const value of ['a b', '"a"', 'a;b', 'a/b', '(a)', 'a:b', 'café']) {
    expect(list(`Access-Control-Allow-Headers: x, ${value}`), value).toBe('failure');
  }
  // A token may hold ! # $ % & ' * + - . ^ _ ` | ~ and digits and letters.
  expect(list("Access-Control-Allow-Headers: !#$%&'*+-.^_`|~, A1")).toEqual(["!#$%&'*+-.^_`|~", 'A1']);
});

it('two Access-Control-Allow-Origin lines or a comma list are one combined value and fail the check', () => {
  // cors-multiple-origins.sub.any.js: listing multiple origins is illegal.
  const lineTwice = failureOf({
    responseHeaders: `Access-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Origin: ${PAGE}`,
  });
  expect(lineTwice).toBe('response-acao-match');
  expect(failureOf({ responseHeaders: `Access-Control-Allow-Origin: ${PAGE}, ${PAGE}` })).toBe('response-acao-match');
  expect(failureOf({ responseHeaders: 'Access-Control-Allow-Origin: *, *' })).toBe('response-acao-match');
  expect(failureOf({ responseHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Allow-Origin: ${PAGE}` })).toBe(
    'response-acao-match',
  );
  // The same rule holds for the answer to the preflight.
  const preflight = failureOf({
    method: 'PUT',
    preflightHeaders: `Access-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Methods: PUT`,
    responseHeaders: `Access-Control-Allow-Origin: ${PAGE}`,
  });
  expect(preflight).toBe('preflight-acao-match');
  const detail =
    checkCors(input({ responseHeaders: `Access-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Origin: ${PAGE}` }))
      .firstFailure?.detail ?? '';
  expect(detail).toContain('combined');
  // One origin on one line passes, and so does a single * without credentials.
  expect(failureOf({ responseHeaders: `Access-Control-Allow-Origin: ${PAGE}` })).toBeNull();
  expect(failureOf({ responseHeaders: 'Access-Control-Allow-Origin: *' })).toBeNull();
  // The same combining applies to Access-Control-Allow-Credentials.
  const credentials = { credentials: 'include' as const };
  const origin = `Access-Control-Allow-Origin: ${PAGE}`;
  expect(
    failureOf({ ...credentials, responseHeaders: `${origin}\nAccess-Control-Allow-Credentials: true` }),
  ).toBeNull();
  expect(
    failureOf({
      ...credentials,
      responseHeaders: `${origin}\nAccess-Control-Allow-Credentials: true\nAccess-Control-Allow-Credentials: true`,
    }),
  ).toBe('response-acac');
  expect(
    failureOf({ ...credentials, responseHeaders: `${origin}\nAccess-Control-Allow-Credentials: true, true` }),
  ).toBe('response-acac');
  expect(failureOf({ ...credentials, responseHeaders: `${origin}\nAccess-Control-Allow-Credentials: TRUE` })).toBe(
    'response-acac',
  );
  expect(failureOf({ ...credentials, responseHeaders: origin })).toBe('response-acac');
});

it('readable response headers follow the safelist and Access-Control-Expose-Headers with and without credentials', () => {
  // The rows that assert which headers script can read (cors-filtering, cors-expose-star).
  const problems: string[] = [];
  for (const row of rows) {
    const wants = row.expect.readableHeaders ?? [];
    const hides = row.expect.notReadable ?? [];
    if (wants.length === 0 && hides.length === 0) continue;
    const names = readableNames(checkCors(inputOf(row)));
    for (const name of wants)
      if (!names.includes(name)) problems.push(`${row.source} (${row.name}): ${name} should be readable`);
    for (const name of hides)
      if (names.includes(name)) problems.push(`${row.source} (${row.name}): ${name} should not be readable`);
  }
  expect(problems).toEqual([]);

  // The seven safelisted names, and only those, without any Access-Control-Expose-Headers.
  const safelisted = [
    'Cache-Control',
    'Content-Language',
    'Content-Length',
    'Content-Type',
    'Expires',
    'Last-Modified',
    'Pragma',
  ];
  const others = ['ETag', 'Server', 'X-Request-Id', 'Age'];
  const plain = checkCors(
    input({
      responseHeaders:
        [...safelisted, ...others].map((name) => `${name}: 1`).join('\n') + '\nAccess-Control-Allow-Origin: *',
    }),
  );
  expect(plain.verdict).toBe('readable');
  expect(readableNames(plain).sort()).toEqual(safelisted.map((name) => name.toLowerCase()).sort());
  expect(plain.readable.every((header) => header.why.length > 0)).toBe(true);

  // Access-Control-Expose-Headers adds names, whatever their letter case, over one line or several.
  const exposed = checkCors(
    input({
      responseHeaders:
        'Access-Control-Allow-Origin: *\nAccess-Control-Expose-Headers: x-a, X-B\naccess-control-expose-headers: Etag\nX-A: 1\nx-b: 2\nETag: 3\nServer: 4',
    }),
  );
  expect(readableNames(exposed).sort()).toEqual(['etag', 'x-a', 'x-b']);

  // * without credentials means every name, except Set-Cookie and Set-Cookie2; even next to other names.
  const all = checkCors(
    input({
      responseHeaders:
        'Access-Control-Allow-Origin: *\nAccess-Control-Expose-Headers: set-cookie, *\nSet-Cookie: a=b\nSet-Cookie2: c=d\nServer: s\nX-A: 1',
    }),
  );
  expect(readableNames(all)).toEqual(
    expect.arrayContaining(['server', 'x-a', 'access-control-allow-origin', 'access-control-expose-headers']),
  );
  expect(readableNames(all)).not.toContain('set-cookie');
  expect(readableNames(all)).not.toContain('set-cookie2');
  expect(all.readable.find((header) => header.name === 'Set-Cookie')?.readable).toBe(false);

  // With credentials included * names only a header literally called *.
  const credentialed = checkCors(
    input({
      credentials: 'include',
      responseHeaders: `Access-Control-Allow-Origin: ${PAGE}\nAccess-Control-Allow-Credentials: true\nAccess-Control-Expose-Headers: *\nContent-Type: text/plain\nServer: s\n*: whoa`,
    }),
  );
  expect(readableNames(credentialed).sort()).toEqual(['*', 'content-type']);

  // A list that is not a list of names exposes nothing extra, and a blocked response exposes nothing at all.
  const badList = checkCors(
    input({
      responseHeaders: 'Access-Control-Allow-Origin: *\nAccess-Control-Expose-Headers: bad name\nServer: s\nPragma: p',
    }),
  );
  expect(readableNames(badList)).toEqual(['pragma']);
  const blocked = checkCors(input({ responseHeaders: 'Pragma: p\nAccess-Control-Allow-Origin: http://other.example' }));
  expect(blocked.verdict).toBe('blocked-response');
  expect(blocked.readable).toEqual([]);
  // A repeated name is listed once, with the name as first written.
  const repeated = checkCors(input({ responseHeaders: 'Access-Control-Allow-Origin: *\nPragma: a\npragma: b' }));
  expect(repeated.readable.filter((header) => header.name.toLowerCase() === 'pragma')).toHaveLength(1);
});

it('forbidden request headers and no-cors unsafe headers are dropped silently and forbidden methods are refused', () => {
  const fates = (parts: Partial<CorsInput>): string[] =>
    describeRequest(input(parts)).headers.map((header) => `${header.name}=${header.fate}`);

  // Forbidden request-header names, the Proxy- and Sec- prefixes and the method override headers with a forbidden method.
  const forbidden = [
    'Accept-Charset',
    'Accept-Encoding',
    'Access-Control-Request-Headers',
    'Access-Control-Request-Method',
    'Connection',
    'Content-Length',
    'Cookie',
    'Cookie2',
    'Date',
    'DNT',
    'Expect',
    'Host',
    'Keep-Alive',
    'Origin',
    'Referer',
    'Set-Cookie',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'Via',
    'Proxy-Authorization',
    'PROXY-x',
    'Sec-Fetch-Mode',
    'sec-ch-ua',
  ];
  for (const name of forbidden) {
    expect(fates({ requestHeaders: `${name}: 1` }), name).toEqual([`${name}=dropped-forbidden`]);
  }
  expect(fates({ requestHeaders: 'X-HTTP-Method-Override: TRACE' })).toEqual([
    'X-HTTP-Method-Override=dropped-forbidden',
  ]);
  expect(fates({ requestHeaders: 'x-method-override: get, Connect' })).toEqual(['x-method-override=dropped-forbidden']);
  expect(fates({ requestHeaders: 'X-HTTP-Method: track' })).toEqual(['X-HTTP-Method=dropped-forbidden']);
  expect(fates({ requestHeaders: 'X-HTTP-Method-Override: PUT' })).toEqual(['X-HTTP-Method-Override=sent']);
  expect(fates({ requestHeaders: 'X-HTTP-Method-Override: "TRACE"' })).toEqual(['X-HTTP-Method-Override=sent']);

  // A dropped header causes no preflight, is not in the Access-Control-Request-Headers line and is not counted in the total.
  const dropped = checkCors(
    input({
      requestHeaders: 'Cookie: a=b\nHost: x\nSec-Fetch-Mode: cors\nAccept: */*',
      responseHeaders: 'Access-Control-Allow-Origin: *',
    }),
  );
  expect(dropped.plan.preflight.sent).toBe(false);
  expect(dropped.plan.unsafeNames).toEqual([]);
  expect(dropped.verdict).toBe('readable');
  const mixed = describeRequest(input({ requestHeaders: 'Cookie: a=b\nX-Token: t\nAuthorization: x' }));
  expect(mixed.preflight.accessControlRequestHeaders).toBe('authorization,x-token');

  // no-cors: a header is dropped unless the combined value of its name is no-CORS-safelisted.
  const noCors = (requestHeaders: string): string[] => fates({ mode: 'no-cors', requestHeaders });
  expect(noCors('X-Custom: 1')).toEqual(['X-Custom=dropped-no-cors']);
  expect(noCors('Accept: */*\nAccept-Language: en\nContent-Language: en\nContent-Type: text/plain')).toEqual([
    'Accept=sent',
    'Accept-Language=sent',
    'Content-Language=sent',
    'Content-Type=sent',
  ]);
  expect(noCors('Content-Type: application/json')).toEqual(['Content-Type=dropped-no-cors']);
  expect(noCors('Range: bytes=0-')).toEqual(['Range=dropped-no-cors']);
  // The combined value counts: text/plain then application/json would be text/plain, application/json.
  expect(noCors('Content-Type: text/plain\nContent-Type: application/json')).toEqual([
    'Content-Type=sent',
    'Content-Type=dropped-no-cors',
  ]);
  expect(noCors(`Accept: x\nAccept: ${'y'.repeat(127)}`)).toEqual(['Accept=sent', 'Accept=dropped-no-cors']);
  // Forbidden headers are dropped in every mode, and a no-cors request is never preflighted.
  expect(noCors('Cookie: a=b')).toEqual(['Cookie=dropped-forbidden']);
  const noCorsPlan = describeRequest(input({ mode: 'no-cors', requestHeaders: 'X-Custom: 1' }));
  expect(noCorsPlan.preflight.sent).toBe(false);
  expect(noCorsPlan.preflight.accessControlRequestHeaders).toBeUndefined();

  // Forbidden methods and a no-cors method other than GET, HEAD or POST are refused by the browser with a TypeError.
  for (const method of ['CONNECT', 'TRACE', 'TRACK', 'connect', 'Trace', 'tRaCk']) {
    const report = checkCors(input({ method }));
    expect(report.verdict, method).toBe('refused-request');
    expect(report.firstFailure?.id, method).toBe('request-refused');
    expect(report.plan.preflight.sent, method).toBe(false);
  }
  for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'chicken']) {
    expect(checkCors(input({ mode: 'no-cors', method })).verdict, method).toBe('refused-request');
  }
  for (const method of ['GET', 'HEAD', 'POST', 'post']) {
    expect(checkCors(input({ mode: 'no-cors', method })).verdict, method).toBe('opaque');
  }
  // A header value with a character above U+00FF is refused by the fetch API too.
  const wide = checkCors(input({ requestHeaders: `X-A: ${String.fromCodePoint(0x100)}` }));
  expect(wide.verdict).toBe('refused-request');
  expect(wide.firstFailure?.detail).not.toContain(String.fromCodePoint(0x100));
  expect(
    checkCors(
      input({
        requestHeaders: `X-A: ${String.fromCodePoint(0xff)}`,
        responseHeaders: 'Access-Control-Allow-Origin: *',
      }),
    ).verdict,
  ).toBe('blocked-preflight');
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
  // A request to the page's own origin needs none of these rules, and nothing is pasted for it to pass.
  const same = checkCors(input({ url: `${PAGE}/items`, method: 'PUT', requestHeaders: 'X-Token: t' }));
  expect(same.verdict).toBe('same-origin');
  expect(same.plan.crossOrigin).toBe(false);
  expect(same.plan.preflight.sent).toBe(false);
  expect(same.firstFailure).toBeNull();
  // An opaque page origin is the same as no origin, even when the address is written the same.
  expect(checkCors(input({ pageOrigin: 'null', url: `${PAGE}/items` })).verdict).toBe('blocked-response');
  expect(checkCors(input({ pageOrigin: 'null', responseHeaders: 'Access-Control-Allow-Origin: null' })).verdict).toBe(
    'readable',
  );
});

it('the preflight text lists the unsafe names lower-cased, deduplicated, sorted by byte and joined by a comma with no space', () => {
  const report = checkCors(
    input({
      method: 'put',
      requestHeaders:
        'X-b: 1\nx-B: 2\nAuthorization: x\nX-a-1: 1\nX-a_1: 1\nX-A.1: 1\nContent-Type: application/json\nAccept: */*',
      preflightHeaders:
        'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: PUT\nAccess-Control-Allow-Headers: *, authorization',
      responseHeaders: 'Access-Control-Allow-Origin: *',
    }),
  );
  // 0x2d (-) < 0x2e (.) < 0x5f (_) < 0x62 (b): the first byte that differs decides.
  expect(report.plan.preflight.accessControlRequestHeaders).toBe('authorization,content-type,x-a-1,x-a.1,x-a_1,x-b');
  expect(report.plan.method).toBe('PUT');
  expect(report.preflightText).toBe(
    [
      `OPTIONS ${TARGET}`,
      `Origin: ${PAGE}`,
      'Accept: */*',
      'Access-Control-Request-Method: PUT',
      'Access-Control-Request-Headers: authorization,content-type,x-a-1,x-a.1,x-a_1,x-b',
    ].join('\n'),
  );
  expect(report.verdict).toBe('readable');
  // No unsafe header means no Access-Control-Request-Headers line at all.
  const none = checkCors(
    input({
      method: 'DELETE',
      preflightHeaders: answer({ methods: 'DELETE' }),
      responseHeaders: 'Access-Control-Allow-Origin: *',
    }),
  );
  expect(none.preflightText).not.toContain('Access-Control-Request-Headers');
  expect(none.verdict).toBe('readable');
  // Exactly one row of the checks ends the table of a blocked response, and the rows follow the standard's order.
  const blocked = checkCors(
    input({ method: 'PUT', preflightHeaders: answer({}), responseHeaders: 'Access-Control-Allow-Origin: *' }),
  );
  expect(blocked.steps.filter((step) => step.result === 'fail')).toHaveLength(1);
  expect(blocked.firstFailure?.id).toBe('preflight-method');
  expect(blocked.steps.map((step) => step.id).slice(0, 8)).toEqual([
    'preflight-needed',
    'preflight-acao-present',
    'preflight-acao-match',
    'preflight-acac',
    'preflight-status',
    'preflight-lists',
    'preflight-method',
    'preflight-authorization',
  ]);
});

it('Access-Control-Max-Age is read as whole seconds and is 5 when absent or invalid', () => {
  const maxAge = (header: string) =>
    checkCors(
      input({
        method: 'PUT',
        preflightHeaders: `${answer({ methods: 'PUT' })}${header}`,
        responseHeaders: 'Access-Control-Allow-Origin: *',
      }),
    ).maxAge;
  expect(maxAge('')).toEqual({ seconds: 5, fromHeader: false });
  expect(maxAge('\nAccess-Control-Max-Age: 600')).toEqual({ seconds: 600, fromHeader: true });
  expect(maxAge('\nAccess-Control-Max-Age: 0')).toEqual({ seconds: 0, fromHeader: true });
  expect(maxAge('\nAccess-Control-Max-Age: 86400')).toEqual({ seconds: 86400, fromHeader: true });
  for (const bad of ['-1', '1.5', '1e3', 'ten', '', '600, 700', '+5', '0x10']) {
    expect(maxAge(`\nAccess-Control-Max-Age: ${bad}`), bad).toEqual({ seconds: 5, fromHeader: false });
  }
  expect(maxAge('\nAccess-Control-Max-Age: 5\nAccess-Control-Max-Age: 6')).toEqual({ seconds: 5, fromHeader: false });
  // The age is only known once the preflight passed.
  expect(
    checkCors(input({ method: 'PUT', preflightHeaders: answer({}), responseHeaders: 'Access-Control-Allow-Origin: *' }))
      .maxAge,
  ).toBeNull();
});

it('Access-Control-Max-Age with leading zeros is read by its value and only a long number is cut', () => {
  // delta-seconds is 1*DIGIT, so leading zeros are valid and do not change the number.
  const maxAge = (value: string) =>
    checkCors(
      input({
        method: 'PUT',
        preflightHeaders: `${answer({ methods: 'PUT' })}\nAccess-Control-Max-Age: ${value}`,
        responseHeaders: 'Access-Control-Allow-Origin: *',
      }),
    ).maxAge;
  expect(maxAge('0000000000000600')).toEqual({ seconds: 600, fromHeader: true });
  expect(maxAge('0'.repeat(40) + '86400')).toEqual({ seconds: 86400, fromHeader: true });
  expect(maxAge('0'.repeat(20))).toEqual({ seconds: 0, fromHeader: true });
  expect(maxAge('000')).toEqual({ seconds: 0, fromHeader: true });
  // A number longer than 15 significant digits is still cut at the largest exact whole number.
  expect(maxAge('1' + '0'.repeat(20))).toEqual({ seconds: Number.MAX_SAFE_INTEGER, fromHeader: true });
  expect(maxAge('000' + '9'.repeat(15))).toEqual({ seconds: 999_999_999_999_999, fromHeader: true });
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

  const credentialsInUrl = refusal({ url: `http://${MARKER}:${MARKER}@remote.example/` });
  expect(credentialsInUrl.part).toBe('url');
  expect(credentialsInUrl.message).not.toContain(MARKER);

  const badOrigin = refusal({ pageOrigin: `${MARKER}` });
  expect(badOrigin.part).toBe('page origin');
  expect(badOrigin.message).not.toContain(MARKER);

  const badMethod = refusal({ method: `GE T ${MARKER}` });
  expect(badMethod.part).toBe('method');
  expect(badMethod.message).not.toContain(MARKER);

  // A marker inside a well-formed header may be shown, but never more than 200 characters of it. A long value is cut in
  // every detail the report holds, and hidden characters in a shown value are written out.
  const longValue = `Access-Control-Allow-Origin: ${MARKER}${'z'.repeat(500)}`;
  const report = checkCors(input({ responseHeaders: longValue }));
  for (const step of report.steps) expect(step.detail.length, step.id).toBeLessThan(500);
  expect(report.steps.map((step) => step.detail).join('\n')).not.toContain('z'.repeat(250));
  expect(report.summary).not.toContain(MARKER);
  const hidden = checkCors(
    input({ responseHeaders: `Access-Control-Allow-Origin: a${String.fromCodePoint(0x202e)}b` }),
  );
  expect(hidden.steps.map((step) => step.detail).join('\n')).toContain('\\u{202E}');
});

it('the same input gives the same report however many times and in whatever order it is checked', () => {
  const a = inputOf(
    rows.find(
      (row) =>
        row.source.startsWith('cors-preflight-star.any.js') && row.expect.firstFailure === 'preflight-authorization',
    ) as Row,
  );
  const b = inputOf(
    rows.find(
      (row) => row.source.startsWith('cors-preflight.any.js') && row.expect.requestHeadersLine?.includes(','),
    ) as Row,
  );
  const c = input({ responseHeaders: 'Access-Control-Allow-Origin: *' });
  const inputs = [a, b, c];
  const first = inputs.map((item) => checkCors(item));
  const orders = [
    [a, b, c, a, b, c, a, b, c],
    [c, b, a, c, b, a, c, b, a],
    [b, b, a, c, c, a, b, a, c],
  ];
  for (const order of orders) {
    for (const item of order) {
      expect(checkCors(item)).toStrictEqual(first[inputs.indexOf(item)]);
    }
  }
  // A refusal in between changes nothing either.
  expect(() => checkCors(input({ url: 'nope' }))).toThrow(CorsCheckerError);
  expect(checkCors(a)).toStrictEqual(first[0]);
});
