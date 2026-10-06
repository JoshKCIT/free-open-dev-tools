import { expect, it, vi } from 'vitest';
import {
  checkCors,
  corsUnsafeRequestHeaderNames,
  describeRequest,
  extractHeaderListValues,
  normalizeMethod,
  parseHeaderBlock,
  serializeOrigin,
  type CorsInput,
} from '../src/index';
import { parseMimeEssence } from '../src/mime';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

/*
 * Hostile input. A pasted text can be built to make a parser slow, or to hit a name a plain object already has
 * (__proto__, constructor, toString). The expectations are stated from the rules, not from the output: every lookup keyed by
 * a pasted name must treat these names as any other, and doubling a hostile input must not make a parser take more than 6
 * times as long (a parser that reads its input once takes about 2 times as long).
 */

const PAGE = 'http://page.example:8000';

function input(parts: Partial<CorsInput> = {}): CorsInput {
  return {
    pageOrigin: PAGE,
    url: 'http://remote.example:8000/items',
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin',
    requestHeaders: '',
    preflightStatus: 200,
    preflightHeaders: '',
    responseStatus: 200,
    responseHeaders: 'Access-Control-Allow-Origin: *',
    ...parts,
  };
}

const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

it('header names __proto__, constructor and toString are plain names', () => {
  // As request headers, listed in the preflight answer and exposed in the real one, they are ordinary names.
  const all = checkCors(
    input({
      requestHeaders: NAMES.map((name) => `${name}: 1`).join('\n'),
      preflightHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: ${NAMES.join(', ')}`,
      responseHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Expose-Headers: ${NAMES.join(',')}\n${NAMES.map((name) => `${name}: 2`).join('\n')}`,
    }),
  );
  // 0x5f (_) sorts before the letters; the rest are in alphabetical order once lower-cased.
  expect(all.plan.preflight.accessControlRequestHeaders).toBe('__proto__,constructor,hasownproperty,tostring,valueof');
  expect(all.verdict).toBe('readable');
  expect(all.readable.filter((header) => header.readable).map((header) => header.name)).toEqual(
    expect.arrayContaining(NAMES),
  );
  // A name the page does not list is not listed because a plain object has it: nothing is read through a prototype.
  for (const name of NAMES) {
    const missing = checkCors(
      input({ requestHeaders: `${name}: 1`, preflightHeaders: 'Access-Control-Allow-Origin: *' }),
    );
    expect(missing.firstFailure?.id, name).toBe('preflight-headers');
    const other = checkCors(
      input({
        requestHeaders: 'X-A: 1',
        preflightHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: ${name}`,
      }),
    );
    expect(other.firstFailure?.id, name).toBe('preflight-headers');
    // Nor is a header readable or a method allowed because the name exists on an object.
    const hidden = checkCors(input({ responseHeaders: `Access-Control-Allow-Origin: *\n${name}: 3` }));
    expect(hidden.readable.find((header) => header.name === name)?.readable, name).toBe(false);
    const method = checkCors(input({ method: name, preflightHeaders: 'Access-Control-Allow-Origin: *' }));
    expect(method.firstFailure?.id, name).toBe('preflight-method');
    expect(normalizeMethod(name), name).toBe(name);
    const allowed = checkCors(
      input({
        method: name,
        preflightHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: ${name}`,
      }),
    );
    expect(allowed.verdict, name).toBe('readable');
  }
  // The names do not reach the prototype of anything the package builds.
  expect(Object.getPrototypeOf(all.plan)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(all)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(Object.keys(all.plan.preflight)).not.toContain('__proto__');
  const parsed = parseHeaderBlock('__proto__: x\nconstructor: y', 'request headers');
  expect(parsed.entries.map((entry) => entry.name)).toEqual(['__proto__', 'constructor']);
  expect(extractHeaderListValues(parsed.entries, '__proto__')).toEqual(['x']);
  expect(
    corsUnsafeRequestHeaderNames([
      { name: '__proto__', value: 'x' },
      { name: 'toString', value: 'y' },
    ]),
  ).toEqual(['__proto__', 'tostring']);
});

const SIZE = 16_000;

/** Strings of the shapes each parser could be made slow by, besides the six every tool is tried with. */
const OWN: ReadonlyArray<(n: number) => string> = [
  (n) => 'a: b\n'.repeat(Math.floor(n / 5)),
  (n) => 'a: b\n' + ' c\n'.repeat(Math.floor(n / 3)),
  (n) => 'text/plain' + ';a=b'.repeat(Math.floor(n / 4)),
  (n) => '"'.repeat(n),
  (n) => ', '.repeat(Math.floor(n / 2)),
  (n) => 'a ,'.repeat(Math.floor(n / 3)),
  (n) => 'bytes=' + '9'.repeat(Math.floor(n / 2)) + '-' + '9'.repeat(Math.floor(n / 2)),
  (n) => 'a,'.repeat(Math.floor(n / 2)) + 'b c',
  (n) => 'x\u0000'.repeat(Math.floor(n / 2)),
  (n) => '\r\n'.repeat(Math.floor(n / 2)) + 'a',
];

it('every parser stays linear on hostile input', () => {
  const targets: [string, (text: string) => unknown, number][] = [
    ['parseHeaderBlock', (t) => parseHeaderBlock(t, 'response headers'), SIZE],
    ['parseHeaderBlock after a name', (t) => parseHeaderBlock(`X-A: ${t}`, 'response headers'), SIZE],
    [
      'extractHeaderListValues',
      (t) =>
        extractHeaderListValues(
          parseHeaderBlock(`Access-Control-Allow-Headers: ${t}`, 'response headers').entries,
          'access-control-allow-headers',
        ),
      SIZE,
    ],
    ['parseMimeEssence', (t) => parseMimeEssence(t), SIZE],
    [
      'corsUnsafeRequestHeaderNames',
      (t) =>
        corsUnsafeRequestHeaderNames([
          { name: 'content-type', value: t },
          { name: 'range', value: t },
          { name: 'accept', value: t },
        ]),
      SIZE,
    ],
    ['serializeOrigin', (t) => serializeOrigin(`http://${t}`), 4_000],
    [
      'describeRequest with a hostile address',
      (t) => describeRequest(input({ url: `http://remote.example/${t}` })),
      3_000,
    ],
    [
      'describeRequest with hostile request headers',
      (t) =>
        describeRequest(
          input({
            requestHeaders: `X-A: ${t}\nAccept: ${t}\nContent-Type: ${t}\nRange: ${t}\nX-HTTP-Method-Override: ${t}`,
          }),
        ),
      6_000,
    ],
    [
      'checkCors with a hostile response',
      (t) =>
        checkCors(
          input({
            responseHeaders: `Access-Control-Allow-Origin: ${t}\nAccess-Control-Expose-Headers: ${t}\nAccess-Control-Allow-Credentials: ${t}`,
          }),
        ),
      8_000,
    ],
    [
      'checkCors with a hostile preflight',
      (t) =>
        checkCors(
          input({
            method: 'PUT',
            requestHeaders: 'X-A: 1\nAuthorization: 2',
            preflightHeaders: `Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: ${t}\nAccess-Control-Allow-Headers: ${t}\nAccess-Control-Max-Age: ${t}`,
          }),
        ),
      SIZE / 2,
    ],
    ['checkCors with a hostile method', (t) => checkCors(input({ method: t.slice(0, 64) })), 1_000],
    ['checkCors with a hostile page origin', (t) => checkCors(input({ pageOrigin: `http://${t}` })), 4_000],
  ];
  const problems: string[] = [];
  for (const [name, fn, size] of targets) {
    [...HOSTILE, ...OWN].forEach((make, index) => {
      const ratio = scalingRatio(fn, make, size);
      if (!(ratio <= MAX_SCALING_RATIO))
        problems.push(`${name} on hostile string ${index}: doubling the input took ${ratio.toFixed(1)} times as long`);
    });
  }
  expect(problems).toEqual([]);
}, 240_000);

it('the package prints nothing to the console', () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    checkCors(
      input({ method: 'PUT', requestHeaders: 'Authorization: 1', preflightHeaders: 'Access-Control-Allow-Origin: *' }),
    );
    checkCors(input({ responseHeaders: 'Access-Control-Allow-Origin: *\nAccess-Control-Expose-Headers: *\nX: 1' }));
    expect(() => checkCors(input({ url: 'nope' }))).toThrow();
    expect(() => checkCors(input({ responseHeaders: 'no colon here' }))).toThrow();
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});
