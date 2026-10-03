import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import jsQR from 'jsqr';
import { encodeBase32 } from '../src/base32';
import { countdownHtml } from '../src/countdown';
import { TotpError } from '../src/errors';
import { qrSvg } from '../src/qr';
import { otpauthUri } from '../src/uri';
import { LINK_CASES } from './fixtures/pyotp-cases';

/**
 * Expected links come from pyotp 2.10.0 (recorded in test/fixtures, see its README), an independent implementation; the
 * QR codes are checked by decoding them again with jsQR, a reader that is not the package that wrote them. The format
 * itself is the Key Uri Format: otpauth://TYPE/LABEL?PARAMETERS, a label of issuer, a colon and the account name, the
 * secret as unpadded Base32, and parameters that equal their defaults left out.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** The link a recorded case describes, built by the package, and the link pyotp wrote with the Base32 text put back. */
function linkOf(caseIndex: number): { built: string; expected: string; seed: Uint8Array } {
  const recorded = LINK_CASES[caseIndex]!;
  const seed = hexBytes(recorded.seedHex);
  const built = otpauthUri({
    type: recorded.options.type,
    secret: seed,
    issuer: recorded.options.issuer,
    account: recorded.options.account,
    algorithm: recorded.options.algorithm,
    digits: recorded.options.digits,
    period: recorded.options.period,
    counter: BigInt(recorded.options.counter),
  });
  return { built, expected: recorded.uri.replace('{SEED}', encodeBase32(seed, false)), seed };
}

it('otpauth links equal pyotp output for four recorded cases', () => {
  expect(LINK_CASES.map((c) => c.title)).toEqual([
    'plain',
    'issuer with a space, a colon and reserved characters',
    'HOTP with a counter',
    'non-ASCII with SHA512',
  ]);
  LINK_CASES.forEach((recorded, index) => {
    const { built, expected } = linkOf(index);
    expect(built, recorded.title).toBe(expected);
  });
  // Spelled out for the two cases a reader can check by eye against the Key Uri Format.
  expect(linkOf(2).built.startsWith('otpauth://hotp/Example:bob?secret=')).toBe(true);
  expect(linkOf(2).built.endsWith('&issuer=Example&counter=7')).toBe(true);
  expect(linkOf(0).built.startsWith('otpauth://totp/alice%40example.com?secret=')).toBe(true);
  expect(linkOf(0).built.includes('&')).toBe(false);
});

it('the link leaves out parameters that equal their defaults, always writes a counter for HOTP and refuses a missing account', () => {
  const seed = hexBytes('3132333435363738393031323334353637383930');
  const base = {
    type: 'totp' as const,
    secret: seed,
    issuer: '',
    account: 'a',
    algorithm: 'SHA1' as const,
    digits: 6 as const,
    period: 30,
    counter: 0n,
  };
  const secretText = encodeBase32(seed, false);
  expect(otpauthUri(base)).toBe(`otpauth://totp/a?secret=${secretText}`);
  expect(otpauthUri({ ...base, issuer: 'I' })).toBe(`otpauth://totp/I:a?secret=${secretText}&issuer=I`);
  expect(otpauthUri({ ...base, algorithm: 'SHA256' })).toBe(`otpauth://totp/a?secret=${secretText}&algorithm=SHA256`);
  expect(otpauthUri({ ...base, digits: 8 })).toBe(`otpauth://totp/a?secret=${secretText}&digits=8`);
  expect(otpauthUri({ ...base, period: 1 })).toBe(`otpauth://totp/a?secret=${secretText}&period=1`);
  // HOTP: the counter is always there, even 0, and a period is never written.
  expect(otpauthUri({ ...base, type: 'hotp', period: 60 })).toBe(`otpauth://hotp/a?secret=${secretText}&counter=0`);
  expect(otpauthUri({ ...base, type: 'hotp', counter: 9007199254740991n })).toBe(
    `otpauth://hotp/a?secret=${secretText}&counter=9007199254740991`,
  );
  // Parameter order: secret, issuer, counter, algorithm, digits, period, as pyotp writes them.
  expect(otpauthUri({ ...base, type: 'hotp', issuer: 'I', algorithm: 'SHA512', digits: 8, counter: 5n })).toBe(
    `otpauth://hotp/I:a?secret=${secretText}&issuer=I&counter=5&algorithm=SHA512&digits=8`,
  );
  // A slash is written as %2F, so the label stays one path segment; a space is %20, never +.
  expect(otpauthUri({ ...base, account: 'a/b c' })).toBe(`otpauth://totp/a%2Fb%20c?secret=${secretText}`);
  expect(() => otpauthUri({ ...base, account: '' })).toThrowError(TotpError);
});

/** Paints the SVG the package wrote (one background rect and one path of squares) into RGBA pixels. */
function rasterise(svg: string): { data: Uint8ClampedArray; width: number; height: number } {
  const size = /^<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg);
  expect(size, 'the SVG starts with its size').not.toBeNull();
  const width = Number(size![1]);
  const height = Number(size![2]);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const path = /<path d="([^"]*)"/.exec(svg);
  expect(path, 'the SVG has a path').not.toBeNull();
  const square = /M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g;
  let painted = 0;
  for (let part = square.exec(path![1]!); part !== null; part = square.exec(path![1]!)) {
    const [x, y, w, h] = [Number(part[1]), Number(part[2]), Number(part[3]), Number(part[4])];
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) {
        const at = (row * width + column) * 4;
        data[at] = 0;
        data[at + 1] = 0;
        data[at + 2] = 0;
      }
    }
    painted++;
  }
  expect(painted, 'the path draws dark modules').toBeGreaterThan(100);
  return { data, width, height };
}

it('each otpauth QR code decodes back to the same link with jsqr', () => {
  for (let index = 0; index < LINK_CASES.length; index++) {
    const { expected } = linkOf(index);
    const svg = qrSvg(expected);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // Nothing that could load a resource: no text, link, image, script or style in the picture.
    expect(/<(script|image|a|text|style|foreignObject|use)[ >]|href|url\(/.test(svg)).toBe(false);
    const raster = rasterise(svg);
    const decoded = jsQR(raster.data, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
    expect(decoded, LINK_CASES[index]!.title).not.toBeNull();
    expect(decoded!.data).toBe(expected);
  }
  // A link too long for any QR code is refused with a plain message that does not repeat it.
  const long = 'otpauth://totp/' + 'a'.repeat(3000);
  let caught: unknown;
  try {
    qrSvg(long);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(TotpError);
  expect((caught as TotpError).message).toMatch(/^[A-Z][^]*\.$/);
  expect((caught as TotpError).message.includes('aaaa')).toBe(false);
  // The picture is drawn from the module matrix: the source never asks the library for a PNG or a canvas.
  const source = readFileSync(new URL('../src/qr.ts', import.meta.url), 'utf8');
  expect(/png|canvas|toDataURL|toFile|toString\(/i.test(source), 'qr.ts reaches for a raster writer').toBe(false);
  expect(source.includes('matrixToSvg')).toBe(true);
  expect(source.includes("errorCorrectionLevel: 'M'")).toBe(true);
});

it('svg.ts is a byte-for-byte copy of the QR folder file', () => {
  // The copy's md5 is recorded here, so a changed copy is caught even when the QR folder is not next to this one.
  const mine = readFileSync(new URL('../src/svg.ts', import.meta.url));
  expect(createHash('md5').update(mine).digest('hex')).toBe('efe21a1538232a4144761a029ed69b35');
  const canonical = new URL('../../qr-generator/src/svg.ts', import.meta.url);
  if (existsSync(canonical)) {
    expect(mine.equals(readFileSync(canonical)), 'svg.ts differs from tools/qr-generator/src/svg.ts').toBe(true);
  }
});

it('the countdown block holds only numbers, an inline style and a reduced-motion rule', () => {
  const html = countdownHtml(17, 30);
  expect(html).toContain('<style>');
  expect(html).toContain('@keyframes');
  expect(html).toContain('prefers-reduced-motion: reduce');
  expect(html).toContain('animation:none');
  // The bar drains from 17 of 30 (56.67 percent) to nothing in 17 seconds.
  expect(html).toContain('17s');
  expect(html).toContain('56.67%');
  expect(html).toMatch(/17 of 30 seconds left/);
  // No script, link, image, form, frame, resource address, import or event handler.
  expect(/<(script|link|img|image|a|form|iframe|object|embed|input|button|svg|meta|base)[ >/]/i.test(html)).toBe(false);
  expect(/href|src=|url\(|@import|expression|javascript:|\bon[a-z]+=/i.test(html)).toBe(false);
  // The markup differs between two sets of numbers only in the numbers.
  const shape = (text: string) => text.replace(/[0-9]+(\.[0-9]+)?/g, '#');
  expect(shape(countdownHtml(5, 30))).toBe(shape(countdownHtml(29, 60)));
  expect(shape(countdownHtml(1, 1))).toBe(shape(countdownHtml(86400, 86400)));
  // The first and last seconds of a step.
  expect(countdownHtml(30, 30)).toContain('100%');
  expect(countdownHtml(1, 30)).toContain('3.33%');
  // Anything that is not a whole number of seconds inside the step is refused, so nothing but digits can get in.
  for (const [left, period] of [
    [Number.NaN, 30],
    [Number.POSITIVE_INFINITY, 30],
    [0, 30],
    [31, 30],
    [1.5, 30],
    [-1, 30],
    [5, 0],
    [5, 86401],
  ] as [number, number][]) {
    expect(() => countdownHtml(left, period), `${left} of ${period}`).toThrowError(TotpError);
  }
  expect(() => countdownHtml('5; background:url(x)' as unknown as number, 30)).toThrowError(TotpError);
});
