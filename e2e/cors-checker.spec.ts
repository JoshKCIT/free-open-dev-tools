import { STATUS_CODES, createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createServer as createSocketServer,
  type AddressInfo,
  type Server as SocketServer,
  type Socket,
} from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/*
 * Real browsers as the second opinion on the CORS checker.
 *
 * This spec never opens the tool page and needs no build of the site. It reads the rows the unit tests assert
 * (tools/cors-checker/test/fixtures/wpt/rows.json: web-platform-tests cases and Fetch Standard boundary cases, each citing
 * its file and line) and runs each row that a page can express against two real local servers:
 *
 *   origin A  http://127.0.0.1:<port>  serves an empty page; the row's script runs in it, so A is the request origin;
 *   origin B  http://localhost:<port>  answers every request as the row says (its preflight answer to OPTIONS, its real
 *             answer to anything else, both read from a base64url JSON `cfg` in the query) and records every request.
 *
 * The two origins differ in host name, so every request is cross-origin. Pages are real http pages, not about:blank and not
 * a routed fake, because Chromium's local network access rule refuses those the loopback server.
 *
 * Two checks per row, in two tests:
 *  1. the engine lets the page read the response exactly when the row says it is readable (a rejected call, and an opaque
 *     response, are not readable), and the headers the row says are readable are, and those it says are not, are not;
 *  2. the server saw a preflight (an OPTIONS request) exactly when the row says one is sent, and the
 *     Access-Control-Request-Headers it received equals the row's line (absent when the row says null).
 *
 * A row on which an engine honestly disagrees is named in ENGINE_EXCEPTIONS with the reason, and stated in the tool's
 * limits. Nothing is skipped silently. `bypassCSP` is never set.
 */

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

/** The rows. An environment variable names another file, used to prove this spec can fail (the file is never committed). */
const ROWS_FILE =
  process.env.CORS_CHECKER_ROWS ??
  fileURLToPath(new URL('../tools/cors-checker/test/fixtures/wpt/rows.json', import.meta.url));
const rows = (JSON.parse(readFileSync(ROWS_FILE, 'utf8')) as { rows: Row[] }).rows.filter((row) => row.engine);

/** Rows on which an engine disagrees with the Fetch Standard text, each with the reason. Mirrored in the tool's limits. */
interface EngineException {
  source: string;
  name?: string;
  engine: string;
  /** Which of the two checks the exception is for. */
  check: 'readable' | 'preflight';
  reason: string;
}
const AUTHORIZATION_REASON =
  'The standard says a * in Access-Control-Allow-Headers never covers Authorization, which must be named. Every browser build tried (Chromium 153, Chrome 154, Edge 154, Firefox 155, WebKit 26.6) still lets the page read the response when credentials are not included. The checker follows the standard.';
const JOINED_REPEATS_REASON =
  'Chromium and WebKit join repeated lines of one header name into one value, with a comma and a space, before the 128-byte rule: eight Accept lines of 128 bytes are one value of 1,038 bytes, so a preflight is sent and the 1,024-byte total is never what decides.';
const NO_TOTAL_REASON =
  'Firefox applies the 128-byte rule to each line the script wrote and does not apply the 1,024-byte total: it sends no preflight for nine Accept lines of 128 bytes. The checker follows the standard.';

const ENGINES = ['chromium', 'firefox', 'webkit', 'mobile-chrome'];
const TOTAL_ROW = 'safelisted values totalling 1,024 bytes need no preflight';
const TOTAL_PLUS_ROW = 'safelisted values totalling 1,025 bytes make every one of them unsafe';

const ENGINE_EXCEPTIONS: EngineException[] = [
  ...ENGINES.flatMap((engine): EngineException[] => [
    { source: 'cors-preflight-star.any.js:85', engine, check: 'readable', reason: AUTHORIZATION_REASON },
    { source: 'cors-preflight.any.js:55', engine, check: 'readable', reason: AUTHORIZATION_REASON },
  ]),
  ...['chromium', 'webkit', 'mobile-chrome'].flatMap((engine): EngineException[] => [
    { source: 'fetch.bs:1114', name: TOTAL_ROW, engine, check: 'readable', reason: JOINED_REPEATS_REASON },
    { source: 'fetch.bs:1114', name: TOTAL_ROW, engine, check: 'preflight', reason: JOINED_REPEATS_REASON },
  ]),
  { source: 'fetch.bs:1114', name: TOTAL_PLUS_ROW, engine: 'firefox', check: 'preflight', reason: NO_TOTAL_REASON },
];

interface Seen {
  method: string;
  accessControlRequestHeaders: string | null;
}
interface Observed {
  /** The call resolved with a response whose type is cors. */
  readable: boolean;
  type: string | null;
  error: string | null;
  headerNames: string[];
  requests: Seen[];
}

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/**
 * The answers of server B. Node's own HTTP server refuses a method it does not know (SUPER, patcH, chicken, a lower-case
 * patch) with a 400 before the page can see anything, so the rows that use such a method could never be answered. This
 * small server reads one request line and its headers from a socket, records them, and writes the answer the row asks for:
 * the status, then every header line in the order given (a repeated name stays repeated), then the body.
 */
function answer(socket: Socket, seen: Map<string, Seen[]>): void {
  let received = '';
  socket.setEncoding('latin1');
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: string) => {
    received += chunk;
    const end = received.indexOf('\r\n\r\n');
    if (end < 0) return;
    socket.removeAllListeners('data');
    const lines = received.slice(0, end).split('\r\n');
    const [method = '', target = '/'] = (lines[0] ?? '').split(' ');
    let line: string | null = null;
    for (const header of lines.slice(1)) {
      const colon = header.indexOf(':');
      if (colon > 0 && header.slice(0, colon).toLowerCase() === 'access-control-request-headers') {
        line = header.slice(colon + 1).trim();
      }
    }
    const url = new URL(target, 'http://localhost');
    const id = url.searchParams.get('id') ?? '';
    const cfg = JSON.parse(Buffer.from(url.searchParams.get('cfg') ?? 'e30', 'base64url').toString('utf8')) as {
      preflight?: { status: number; headers: Pairs };
      response: { status: number; headers: Pairs };
    };
    const list = seen.get(id) ?? [];
    list.push({ method, accessControlRequestHeaders: line });
    seen.set(id, list);

    const preflight = method === 'OPTIONS';
    const { status, headers } = preflight ? (cfg.preflight ?? { status: 200, headers: [] }) : cfg.response;
    // The body of a real answer is three bytes, like the resource the Content-Length rows were written for.
    const body = preflight || method === 'HEAD' || status === 204 || status === 304 ? '' : 'top';
    const out = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Status'}`];
    for (const [name, value] of headers) out.push(`${name}: ${value}`);
    if (!headers.some(([name]) => name.toLowerCase() === 'content-length') && status !== 204 && status !== 304) {
      out.push(`Content-Length: ${body.length}`);
    }
    out.push('Connection: close', '', '');
    socket.end(Buffer.from(out.join('\r\n') + body, 'latin1'));
  });
}

interface Servers {
  originA: string;
  originB: string;
  /** What server B saw, by row number. */
  seen: Map<string, Seen[]>;
  close(): Promise<void>;
}

async function listen(
  server: { listen(port: number, host: string, done: () => void): unknown; address(): unknown },
  host: string,
): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return (server.address() as AddressInfo).port;
}

async function startServers(): Promise<Servers> {
  const seen = new Map<string, Seen[]>();
  const pageServer = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>origin</title><p>origin</p>');
  });
  const answerServer: SocketServer = createSocketServer((socket) => answer(socket, seen));
  const portA = await listen(pageServer, '127.0.0.1');
  const portB = await listen(answerServer, '127.0.0.1');
  return {
    originA: `http://127.0.0.1:${portA}`,
    // The same machine under another name: a different origin, so every request is cross-origin.
    originB: `http://localhost:${portB}`,
    seen,
    async close() {
      await Promise.all([
        new Promise<void>((resolve) => pageServer.close(() => resolve())),
        new Promise<void>((resolve) => answerServer.close(() => resolve())),
      ]);
    },
  };
}

/** The row's answers with the page origin the row names written as the real origin of server A. */
function realised(pairs: Pairs, rowPageOrigin: string, originA: string): Pairs {
  return pairs.map(([name, value]) => [name, value.split(rowPageOrigin).join(originA)]);
}

async function runRow(page: Page, servers: Servers, row: Row, index: number): Promise<Observed> {
  const id = String(index);
  const cfg = {
    preflight: row.preflight
      ? {
          status: row.preflight.status,
          headers: realised(row.preflight.headers, row.request.pageOrigin, servers.originA),
        }
      : undefined,
    response: {
      status: row.response.status,
      headers: realised(row.response.headers, row.request.pageOrigin, servers.originA),
    },
  };
  const url = `${servers.originB}/preflight?id=${id}&cfg=${base64url(JSON.stringify(cfg))}`;
  const outcome = await page.evaluate(
    async ({ target, init }) => {
      try {
        const response = await fetch(target, {
          method: init.method,
          mode: init.mode,
          credentials: init.credentials,
          headers: init.headers,
        });
        const names: string[] = [];
        response.headers.forEach((_value, name) => names.push(name.toLowerCase()));
        return { type: response.type, names, error: null as string | null };
      } catch (err) {
        return { type: null as string | null, names: [] as string[], error: err instanceof Error ? err.name : 'error' };
      }
    },
    {
      target: url,
      init: {
        method: row.request.method,
        mode: row.request.mode,
        credentials: row.request.credentials,
        headers: row.request.headers,
      },
    },
  );
  return {
    readable: outcome.error === null && outcome.type === 'cors',
    type: outcome.type,
    error: outcome.error,
    headerNames: outcome.names,
    requests: servers.seen.get(id) ?? [],
  };
}

async function observeAll(page: Page): Promise<{ servers: Servers; observed: Observed[] }> {
  const servers = await startServers();
  await page.goto(`${servers.originA}/`);
  const observed: Observed[] = [];
  for (let index = 0; index < rows.length; index++) {
    observed.push(await runRow(page, servers, rows[index] as Row, index));
  }
  return { servers, observed };
}

/** The exception for a row, an engine and a check, when there is one. */
function exceptionFor(row: Row, engine: string, check: EngineException['check']): EngineException | undefined {
  return ENGINE_EXCEPTIONS.find(
    (e) =>
      e.source === row.source &&
      (e.name === undefined || e.name === row.name) &&
      e.engine === engine &&
      e.check === check,
  );
}

/** What the engine does that the row does not say, or null when they agree on whether the page may read the response. */
function readableProblem(row: Row, seen: Observed): string | null {
  if (seen.readable !== row.expect.readable) {
    return `the engine says readable is ${seen.readable} (${seen.error ?? seen.type}), the row says ${row.expect.readable}`;
  }
  if (!seen.readable) return null;
  for (const name of row.expect.readableHeaders ?? []) {
    if (!seen.headerNames.includes(name)) return `${name} should be readable but is not`;
  }
  for (const name of row.expect.notReadable ?? []) {
    if (seen.headerNames.includes(name)) return `${name} should not be readable but is`;
  }
  return null;
}

/** What the server saw that the row does not say about the preflight, or null when they agree. */
function preflightProblem(row: Row, seen: Observed): string | null {
  const preflights = seen.requests.filter((request) => request.method === 'OPTIONS');
  if (preflights.length > 0 !== row.expect.preflight) {
    return `the server saw ${preflights.length} preflights, the row says ${row.expect.preflight ? 'one is sent' : 'none is sent'}`;
  }
  if (!row.expect.preflight) return null;
  const line = preflights[0]?.accessControlRequestHeaders ?? null;
  if (line !== row.expect.requestHeadersLine) {
    return `the server received Access-Control-Request-Headers ${JSON.stringify(line)}, the row says ${JSON.stringify(row.expect.requestHeadersLine)}`;
  }
  return null;
}

/**
 * Compares every row with what the engine did. A row with an exception for this engine and check must still disagree (an
 * exception that is no longer needed is reported, so the list never goes stale); any other disagreement is reported.
 */
function compare(
  engine: string,
  check: EngineException['check'],
  observed: Observed[],
  problemOf: (row: Row, seen: Observed) => string | null,
): string[] {
  const reports: string[] = [];
  rows.forEach((row, index) => {
    const problem = problemOf(row, observed[index] as Observed);
    const exception = exceptionFor(row, engine, check);
    if (exception) {
      if (problem === null)
        reports.push(`${row.source} (${row.name}): the exception for ${engine} is no longer needed`);
    } else if (problem !== null) reports.push(`${row.source} (${row.name}): ${problem}`);
  });
  return reports;
}

test('cors-checker: real browsers agree with the re-expressed Fetch rows on whether the page may read the response', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(rows.length).toBeGreaterThanOrEqual(40);
  const { servers, observed } = await observeAll(page);
  try {
    const disagreements = compare(testInfo.project.name, 'readable', observed, readableProblem);
    expect(disagreements, `${testInfo.project.name}: ${rows.length} rows run`).toEqual([]);
  } finally {
    await servers.close();
  }
});

test('cors-checker: the server sees a preflight exactly when the rows say one is sent, with the same Access-Control-Request-Headers line', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { servers, observed } = await observeAll(page);
  try {
    const disagreements = compare(testInfo.project.name, 'preflight', observed, preflightProblem);
    expect(disagreements, `${testInfo.project.name}: ${rows.length} rows run`).toEqual([]);
  } finally {
    await servers.close();
  }
});
