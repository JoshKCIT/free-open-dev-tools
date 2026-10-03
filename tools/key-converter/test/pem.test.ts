import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PemError, base64ToBytes, bytesToBase64, bytesToPem, hexToBytes, pemBlocks } from '../src/pem';

/**
 * Specification: RFC 7468 (the textual form of PEM, any line width accepted on input), RFC 1421 section 4.6.1.1 (header
 * lines before the body) and RFC 4648 (Base64 and Base16, with the test vectors of its section 10). The bodies below are
 * encoded with Node's Buffer, which this package does not use.
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

const BEGIN = '-----BEGIN ';
const END = '-----END ';
const DASHES = '-----';

/** A sequence of bytes that is easy to tell apart: n, n+1, n+2 and so on. */
function counting(length: number, from: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (from + i) & 255);
}

function wrap(text: string, width: number, newline: string): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join(newline);
}

function block(label: string, body: Uint8Array, width: number, newline: string): string {
  const encoded = Buffer.from(body).toString('base64');
  return `${BEGIN}${label}${DASHES}${newline}${wrap(encoded, width, newline)}${newline}${END}${label}${DASHES}${newline}`;
}

function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error('the call did not throw');
}

it('PEM blocks are found with any line width, CRLF line ends and text around them', () => {
  const first = counting(100, 7);
  const second = counting(150, 200);
  const text =
    'Some prose before the keys.\r\n' +
    block('PRIVATE KEY', first, 64, '\r\n') +
    'a note between the blocks, with a dash - and a colon: in it\r\n' +
    block('CERTIFICATE REQUEST', second, 76, '\r\n') +
    'and prose after.';
  const found = pemBlocks(text, 10);
  expect(found.map((b) => b.label)).toEqual(['PRIVATE KEY', 'CERTIFICATE REQUEST']);
  expect(Array.from(found[0]!.body)).toEqual(Array.from(first));
  expect(Array.from(found[1]!.body)).toEqual(Array.from(second));
  expect(found[0]!.headers).toEqual([]);
  // The positions are those of the BEGIN line and the end of the END line, so a caller can cut the text out.
  expect(text.slice(found[0]!.start).startsWith(BEGIN + 'PRIVATE KEY' + DASHES)).toBe(true);
  expect(text.slice(found[0]!.start, found[0]!.end).endsWith(END + 'PRIVATE KEY' + DASHES)).toBe(true);
  expect(found[1]!.start).toBeGreaterThan(found[0]!.end);

  // Line feed only, one long line, and a body with no line breaks at all.
  const plain = pemBlocks(block('PUBLIC KEY', first, 1000, '\n'), 1);
  expect(Array.from(plain[0]!.body)).toEqual(Array.from(first));
  const narrow = pemBlocks(block('PUBLIC KEY', first, 7, '\n'), 1);
  expect(Array.from(narrow[0]!.body)).toEqual(Array.from(first));

  // RFC 1421 header lines, up to the first blank line, are kept apart from the body.
  const encrypted =
    `${BEGIN}RSA PRIVATE KEY${DASHES}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF\n\n` +
    `${Buffer.from(first).toString('base64')}\n${END}RSA PRIVATE KEY${DASHES}\n`;
  const withHeaders = pemBlocks(encrypted, 1);
  expect(withHeaders[0]!.headers).toEqual([
    'Proc-Type: 4,ENCRYPTED',
    'DEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF',
  ]);
  expect(Array.from(withHeaders[0]!.body)).toEqual(Array.from(first));

  // Nothing that looks like a block is an empty answer, not an error.
  expect(pemBlocks('no keys in here', 5)).toEqual([]);
  expect(pemBlocks('', 5)).toEqual([]);

  // A BEGIN with no END, an END with another label, and more blocks than the caller allows are each refused.
  const lone = `${BEGIN}PRIVATE KEY${DASHES}\nQUJD\n`;
  const loneError = thrown(() => pemBlocks(lone, 5));
  expect(loneError).toBeInstanceOf(PemError);
  expect((loneError as PemError).position).toBe(0);
  expect(thrown(() => pemBlocks(`${BEGIN}PRIVATE KEY${DASHES}\nQUJD\n${END}PUBLIC KEY${DASHES}\n`, 5))).toBeInstanceOf(
    PemError,
  );
  const three = block('PUBLIC KEY', first, 64, '\n').repeat(3);
  expect(pemBlocks(three, 3).length).toBe(3);
  const tooMany = thrown(() => pemBlocks(three, 2));
  expect(tooMany).toBeInstanceOf(PemError);
  expect((tooMany as PemError).message).toMatch(/2/);
});

it('500 KiB of BEGIN lines without an END is refused in linear time', () => {
  const line = `${BEGIN}CERTIFICATE${DASHES}\n`;
  const withoutEnd = line.repeat(Math.ceil((500 * 1024) / line.length));
  expect(withoutEnd.length).toBeGreaterThanOrEqual(500 * 1024);

  // Only the call under test is timed; every expect comes after the second reading.
  const startedAt = performance.now();
  const error = thrown(() => pemBlocks(withoutEnd, 100));
  const elapsed = performance.now() - startedAt;
  expect(error).toBeInstanceOf(PemError);
  expect(elapsed).toBeLessThan(1000);

  // Many different labels, and one END at the very end that matches none of them, is just as cheap.
  const labels = Array.from({ length: 5000 }, (_, i) => `${BEGIN}LABEL ${i}${DASHES}\n`).join('');
  const padded = labels.repeat(Math.ceil((500 * 1024) / labels.length)) + `${END}OTHER${DASHES}\n`;
  const secondStart = performance.now();
  const secondError = thrown(() => pemBlocks(padded, 100));
  const secondElapsed = performance.now() - secondStart;
  expect(secondError).toBeInstanceOf(PemError);
  expect(secondElapsed).toBeLessThan(1000);

  // Dashes and BEGIN with no label, over and over, find nothing and cost one pass.
  const noise = `${BEGIN}${DASHES}`.repeat(Math.ceil((500 * 1024) / 16));
  const thirdStart = performance.now();
  const found = pemBlocks(noise, 100);
  const thirdElapsed = performance.now() - thirdStart;
  expect(found).toEqual([]);
  expect(thirdElapsed).toBeLessThan(1000);
}, 60_000);

it('Base64 errors give the position of the first bad character and never the character', () => {
  const body = 'A'.repeat(41) + '#' + 'AAAA';
  const err = thrown(() => base64ToBytes(body));
  expect(err).toBeInstanceOf(PemError);
  const pemError = err as PemError;
  expect(pemError.name).toBe('PemError');
  expect(pemError.position).toBe(41);
  expect(pemError.message).toContain('41');
  expect(pemError.message).not.toContain('#');

  // A character outside ASCII is refused at its position, and is not repeated.
  const accented = String.fromCodePoint(0xe9);
  const accentedError = thrown(() => base64ToBytes('QUJD' + accented + 'QUJD')) as PemError;
  expect(accentedError.position).toBe(4);
  expect(accentedError.message).not.toContain(accented);

  // Data after the padding is refused at the first character after it.
  const afterPadding = thrown(() => base64ToBytes('QQ==Q')) as PemError;
  expect(afterPadding.position).toBe(4);
  // More than two padding characters, and a length that cannot be Base64, are refused.
  expect(thrown(() => base64ToBytes('QQ==='))).toBeInstanceOf(PemError);
  expect(thrown(() => base64ToBytes('Q'))).toBeInstanceOf(PemError);
  expect(thrown(() => base64ToBytes('===='))).toBeInstanceOf(PemError);
  // The URL-safe alphabet is not the standard one, and each refuses the other's characters.
  expect(thrown(() => base64ToBytes('-_-_'))).toBeInstanceOf(PemError);
  expect(thrown(() => base64ToBytes('+/+/', { url: true }))).toBeInstanceOf(PemError);
  // A long run of padding characters is counted in one pass, not by repeated slicing.
  const startedAt = performance.now();
  const longPadding = thrown(() => base64ToBytes('QQ' + '='.repeat(200_000)));
  const elapsed = performance.now() - startedAt;
  expect(longPadding).toBeInstanceOf(PemError);
  expect(elapsed).toBeLessThan(1000);
});

it('the Base64 and hex codecs match the RFC 4648 section 10 test vectors', () => {
  const text = (value: string) => Uint8Array.from(Array.from(value, (c) => c.charCodeAt(0)));
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];
  for (const [plain, encoded] of vectors) {
    expect(bytesToBase64(text(plain))).toBe(encoded);
    expect(bytesToBase64(text(plain), false, false)).toBe(encoded.replace(/=+$/, ''));
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(text(plain)));
    // Padding may be left off when decoding, and whitespace anywhere is skipped.
    expect(Array.from(base64ToBytes(encoded.replace(/=+$/, '')))).toEqual(Array.from(text(plain)));
    expect(Array.from(base64ToBytes(wrap(encoded, 2, '\r\n ')))).toEqual(Array.from(text(plain)));
  }
  // Section 5: the URL-safe alphabet writes - and _ where the standard one writes + and /.
  const tricky = Uint8Array.of(0xfb, 0xff, 0xbf);
  expect(bytesToBase64(tricky)).toBe('+/+/');
  expect(bytesToBase64(tricky, true)).toBe('-_-_');
  expect(Array.from(base64ToBytes('-_-_', { url: true }))).toEqual([0xfb, 0xff, 0xbf]);
  expect(bytesToBase64(Uint8Array.of(0xfb, 0xff), true, false)).toBe('-_8');

  // Every byte value, round trip, against Node's own codec.
  const everything = counting(256, 0);
  expect(bytesToBase64(everything)).toBe(Buffer.from(everything).toString('base64'));
  expect(Array.from(base64ToBytes(Buffer.from(everything).toString('base64')))).toEqual(Array.from(everything));

  // PEM output: 64 columns, a line feed after every line, including the last.
  const pem = bytesToPem('PUBLIC KEY', counting(100, 0));
  const expectedBody = wrap(Buffer.from(counting(100, 0)).toString('base64'), 64, '\n');
  expect(pem).toBe(`${BEGIN}PUBLIC KEY${DASHES}\n${expectedBody}\n${END}PUBLIC KEY${DASHES}\n`);
  expect(bytesToPem('X', counting(100, 0), 70).split('\n')[1]!.length).toBe(70);

  // Section 8 (Base16) with the separators a key listing uses. Upper and lower case are both read.
  expect(Array.from(hexToBytes('0a:ff 10\n0B'))).toEqual([0x0a, 0xff, 0x10, 0x0b]);
  expect(Array.from(hexToBytes(''))).toEqual([]);
  const odd = thrown(() => hexToBytes('0a f')) as PemError;
  expect(odd).toBeInstanceOf(PemError);
  expect(odd.position).toBe(3);
  const bad = thrown(() => hexToBytes('0a zz')) as PemError;
  expect(bad.position).toBe(3);
  expect(bad.message).not.toContain('z');
});
