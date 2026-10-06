import { expect, it, vi } from 'vitest';
import {
  checkInput,
  inspectCookies,
  maskValue,
  parseCookieDate,
  parseSetCookie,
  splitLines,
  visible,
} from '../src/index';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';
import { inspect, mulberry32, NOW, one } from './helpers';

it('the same lines and the same time give the same result every time', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const first =
    'Set-Cookie: sid=31d4d96e407aad42; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600\nSet-Cookie: lang=en-US; Domain=site.example; Expires=Wed, 07 Oct 2026 12:00:00 GMT';
  const second = '__Host-a=1; Secure; Path=/\n=\nplain\nb=2; Domain=other.example';
  const a = inspect(first);
  const b = inspect(second);
  // The same input again, and interleaved with the other input in both orders, gives an equal report.
  for (let round = 0; round < 3; round++) {
    expect(inspect(first)).toStrictEqual(a);
    expect(inspect(second)).toStrictEqual(b);
    expect(inspect(second)).toStrictEqual(b);
    expect(inspect(first)).toStrictEqual(a);
  }
  // The time is an input: a different moment gives a different lifetime, and the same moment the same one.
  const later = inspect(first, { nowMs: NOW + 1000 });
  expect(later.cookies[1]?.decision.lifetime?.seconds).toBe(86_400 - 1);
  expect(a.cookies[1]?.decision.lifetime?.seconds).toBe(86_400);
  expect(inspect(first, { nowMs: NOW + 1000 })).toStrictEqual(later);
  // A report never changes after it is made, whatever is done with the next one.
  const snapshot = JSON.stringify(a);
  inspect(second);
  expect(JSON.stringify(a)).toBe(snapshot);
  // The same lines judged with Reveal on and off differ only in what is shown, never in the decision.
  const hidden = inspect(first, { reveal: false });
  const shown = inspect(first, { reveal: true });
  expect(hidden.cookies.map((row) => row.decision)).toStrictEqual(shown.cookies.map((row) => row.decision));
  expect(hidden.cookies.map((row) => row.value)).toStrictEqual(shown.cookies.map((row) => row.value));
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('cookie names __proto__, constructor and toString are plain names', () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'prototype'];
  const lines = names.map((name) => `${name}=1; Path=/; ${name}=x; __proto__=y; constructor=z`).join('\n');
  const report = inspect(lines);
  expect(report.cookies.map((row) => row.name)).toEqual(names);
  for (const row of report.cookies) {
    expect(row.decision.outcome).toBe('stored');
    expect(row.value).toBe('1');
    // The attributes with those names are unknown attributes, listed and ignored, in the order written.
    expect(row.attributes.map((attribute) => attribute.kind)).toEqual(['path', 'unknown', 'unknown', 'unknown']);
    expect(row.attributes.slice(1).every((attribute) => attribute.use === 'ignored')).toBe(true);
  }
  // Two cookies with the same hostile name are two rows, and the order they are sent in is the order pasted.
  const twice = inspect('__proto__=1; Path=/account\n__proto__=2; Path=/account');
  expect(twice.cookies).toHaveLength(2);
  expect(twice.sendOrder).toEqual([1, 2]);
  // Nothing was written onto a shared prototype, and no report object has a polluted prototype.
  const empty: Record<string, unknown> = {};
  expect(empty['x']).toBeUndefined();
  expect(Object.keys({})).toEqual([]);
  expect(Object.getPrototypeOf(report.cookies[0]?.decision)).toBe(Object.prototype);
  expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  // A Max-Age, Domain, Path or SameSite attribute written with such a name is a plain unknown one.
  const odd = one('a=1; __proto__=Max-Age=5; constructor');
  expect(odd.attributes.map((attribute) => attribute.use)).toEqual(['ignored', 'ignored']);
  expect(odd.decision.lifetime?.kind).toBe('session');
});

it('every parser stays linear on hostile input', () => {
  const cases: Array<[string, (input: string) => unknown, ReadonlyArray<(n: number) => string>]> = [
    [
      'splitLines',
      splitLines,
      [...HOSTILE, (n) => 'a=b\n'.repeat(n / 4), (n) => '\r'.repeat(n), (n) => 'a,'.repeat(n / 2)],
    ],
    [
      'parseSetCookie',
      parseSetCookie,
      [
        ...HOSTILE,
        (n) => `a=b${'; x'.repeat(n / 3)}`,
        (n) => `a=b; Expires=${'a '.repeat(n / 2)}`,
        (n) => `a=b; Max-Age=${'9'.repeat(n)}`,
        (n) => `a=b${';'.repeat(n)}`,
        (n) => '='.repeat(n),
        (n) => `a=b${'; Max-Age=1'.repeat(n / 12)}`,
        (n) => `a=b${'; Domain=x'.repeat(n / 11)}`,
      ],
    ],
    [
      'parseCookieDate',
      parseCookieDate,
      [
        ...HOSTILE,
        (n) => 'a '.repeat(n / 2),
        (n) => `${'1:'.repeat(n / 2)}1`,
        (n) => '12'.repeat(n / 2),
        (n) => `${'jan '.repeat(n / 4)}`,
        (n) => `${'0'.repeat(n)}:0:0`,
      ],
    ],
    ['maskValue', maskValue, HOSTILE],
    ['visible', (input) => visible(input, 200), HOSTILE],
    ['checkInput', checkInput, [...HOSTILE, (n) => 'a=b\n'.repeat(n / 4), (n) => '\n'.repeat(n)]],
    [
      'inspectCookies',
      (input) =>
        inspectCookies({
          lines: input,
          requestUrl: 'https://site.example/account/login',
          context: 'same-site',
          nowMs: NOW,
          reveal: false,
        }),
      [
        (n) => `${'a=b; Path=/x; Max-Age=60\n'.repeat(Math.floor(n / 26))}`,
        (n) => `${'__Host-a=b; Secure\n'.repeat(Math.floor(n / 19))}`,
        (n) => `a=${'b'.repeat(n)}`,
        (n) => `a=b; x=${'y'.repeat(n)}`,
        (n) => `a=b; Expires=${'a '.repeat(n / 2)}`,
      ],
    ],
  ];
  const sizes = new Map<string, number>([
    ['inspectCookies', 4000],
    ['splitLines', 8000],
  ]);
  const ratios: string[] = [];
  for (const [name, fn, makers] of cases) {
    makers.forEach((make, index) => {
      const ratio = scalingRatio(fn, make, sizes.get(name) ?? 6000);
      if (ratio > MAX_SCALING_RATIO) ratios.push(`${name} string ${index}: ${ratio.toFixed(2)}`);
    });
  }
  expect(ratios).toEqual([]);
  // A seeded corpus of random lines is read to the end without a throw, whatever it holds.
  const random = mulberry32(0x5eed1c0);
  const alphabet = ['a', '=', ';', ' ', ',', '"', '\t', 'Z', '0', '-', '/', '.', 'max-age', 'Domain', 'Secure'];
  for (let i = 0; i < 200; i++) {
    let line = '';
    for (let j = 0; j < 60; j++) line += alphabet[Math.floor(random() * alphabet.length)] ?? '';
    expect(() => parseSetCookie(line)).not.toThrow();
    expect(() => parseCookieDate(line)).not.toThrow();
  }
});
