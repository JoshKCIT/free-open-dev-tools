import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IsoDurationError, buildIsoDuration, parseIsoDuration } from '../src/index';

/**
 * Review fixes for the ISO 8601 duration text: one named sentence for a part that is not a number, and a digit limit
 * that counts the digits of the value, not the zeros written in front of it.
 */
const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
});

afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
});

const MARKER = 'FODT-MARKER-3141';

function buildRefusal(parts: Parameters<typeof buildIsoDuration>[0]): string {
  try {
    buildIsoDuration(parts);
  } catch (error) {
    expect(error).toBeInstanceOf(IsoDurationError);
    return (error as Error).message;
  }
  throw new Error('expected a refusal, but the call returned');
}

it('a part that is not a number gets one sentence that names the part once, whatever is wrong with it', () => {
  // A trailing dot, a bare fraction, an exponent, a sign, doubled separators, hex, spaces, empty and pasted text.
  for (const bad of ['7.', '.5', '1e3', '1E3', '-1', '+1', '1..5', '1,,5', '0x10', '1 2', ' ', 'x', `7${MARKER}`]) {
    expect(buildRefusal({ seconds: bad }), JSON.stringify(bad)).toBe(
      'The seconds value must be a number such as 7 or 7.5.',
    );
  }
  // The empty text is not a number either (the page treats an empty Seconds box as 0 before it gets here).
  expect(buildRefusal({ seconds: '' })).toBe('The seconds value must be a number such as 7 or 7.5.');
  // The same sentence names whichever part it is.
  expect(buildRefusal({ days: '1e3' })).toBe('The days value must be a number such as 7 or 7.5.');
  expect(buildRefusal({ years: '.5' })).toBe('The years value must be a number such as 7 or 7.5.');
  // The sentence names the part once and does not carry the other grammar sentence.
  const message = buildRefusal({ seconds: '7.' });
  expect(message.match(/seconds/gi)).toHaveLength(1);
  expect(message).not.toContain('capital letter');
  expect(buildRefusal({ seconds: `7${MARKER}` })).not.toContain(MARKER);
});

it('a part with too many digits is refused with a sentence that names the part', () => {
  expect(buildRefusal({ seconds: '1.1234567891' })).toBe(
    'The seconds value has at most 15 digits before the decimal point and 9 after it.',
  );
  expect(buildRefusal({ days: '1234567890123456' })).toBe(
    'The days value has at most 15 digits before the decimal point and 9 after it.',
  );
  // Reading text keeps its own sentence for the same problem.
  expect(() => parseIsoDuration('P1234567890123456D')).toThrow(
    'A part has at most 15 digits before the decimal point and 9 after it.',
  );
});

it('the 15-digit limit counts the digits of the value and not the zeros written in front of it', () => {
  // Sixteen characters, fifteen zeros and a 1: the value is 1.
  expect(parseIsoDuration('P0000000000000001D').days).toBe('1');
  expect(parseIsoDuration('P000000000000000000000000000001Y').years).toBe('1');
  expect(parseIsoDuration('PT0000000000000000.5S').seconds).toBe('0.5');
  expect(parseIsoDuration('P000000000000000000D').days).toBe('0');
  expect(parseIsoDuration('P0000123456789012345D').days).toBe('123456789012345');
  expect(buildIsoDuration({ days: '0000000000000000001' })).toBe('P1D');
  expect(buildIsoDuration({ seconds: '0000000000000000007.50' })).toBe('PT7.5S');
  // Sixteen digits that count are still too many, with or without zeros in front.
  for (const text of ['P1234567890123456D', 'P00001234567890123456D', 'PT1234567890123456.5S']) {
    expect(() => parseIsoDuration(text), text).toThrow('A part has at most 15 digits before the decimal point');
  }
  expect(() => buildIsoDuration({ days: '00001234567890123456' })).toThrow(IsoDurationError);
  // The whole text is still at most 256 characters.
  expect(() => parseIsoDuration('P' + '0'.repeat(300) + '1D')).toThrow('A duration is at most 256 characters.');
  // The fraction limit is unchanged: nine digits after the point, counted as written.
  expect(() => parseIsoDuration('PT0.1234567891S')).toThrow(
    'A part has at most 15 digits before the decimal point and 9 after it.',
  );
  expect(parseIsoDuration('PT0.123456789S').seconds).toBe('0.123456789');
});

it('values are exact decimal text: leading and trailing zeros are dropped and a comma becomes a dot', () => {
  expect(parseIsoDuration('P007Y').years).toBe('7');
  expect(parseIsoDuration('PT00.50S').seconds).toBe('0.5');
  expect(parseIsoDuration('P0,5D').days).toBe('0.5');
  expect(buildIsoDuration(parseIsoDuration('P007Y'))).toBe('P7Y');
  expect(buildIsoDuration(parseIsoDuration('PT00.50S'))).toBe('PT0.5S');
  expect(buildIsoDuration(parseIsoDuration('P0,5D'))).toBe('P0.5D');
});
