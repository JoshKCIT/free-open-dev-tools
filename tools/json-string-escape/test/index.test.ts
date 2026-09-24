import { it, expect } from 'vitest';
import { escapeString, unescapeString, JsonStringError } from '../src/index';

// RFC 8259 section 7's complete two-character escape table, transcribed by
// hand from https://www.rfc-editor.org/rfc/rfc8259#section-7 rather than
// imported from the package, so this test catches a mistranscription in the
// package's own table rather than merely agreeing with it.
const RFC_8259_SECTION_7_ESCAPES: { char: string; escape: string }[] = [
  { char: '"', escape: '\\"' },
  { char: '\\', escape: '\\\\' },
  { char: '/', escape: '\\/' },
  { char: '\b', escape: '\\b' },
  { char: '\f', escape: '\\f' },
  { char: '\n', escape: '\\n' },
  { char: '\r', escape: '\\r' },
  { char: '\t', escape: '\\t' },
];

it('every two-character escape in the RFC 8259 table is produced and read back', () => {
  for (const { char, escape } of RFC_8259_SECTION_7_ESCAPES) {
    const escaped = escapeString(char, { escapeForwardSlash: true });
    expect(escaped.value, `escaping "${char}"`).toBe(escape);
    expect(escaped.warnings).toEqual([]);

    const unescaped = unescapeString(escape);
    expect(unescaped.value, `unescaping "${escape}"`).toBe(char);
    expect(unescaped.warnings).toEqual([]);
  }
});

it('the RFC 8259 out-of-plane example escapes to its two published escapes in order', () => {
  // RFC 8259 section 7: "a string containing only the G clef character
  // (U+1D11E) may be represented as" the twelve-character sequence formed
  // from the two hex escapes D834 and DD1E, asserted below.
  const gClef = String.fromCodePoint(0x1d11e);
  const escaped = escapeString(gClef, { escapeAboveAscii: true });
  expect(escaped.value).toBe('\\uD834\\uDD1E');
  expect(escaped.warnings).toEqual([]);

  const unescaped = unescapeString('\\uD834\\uDD1E');
  expect(unescaped.value).toBe(gClef);
  expect(unescaped.warnings).toEqual([]);
});

it('a lone high surrogate escape is accepted and returns one warning naming the missing half', () => {
  // RFC 8259 section 8.2's own example, "\uDEAD", is a LOW surrogate; this
  // test exercises the HIGH-surrogate half of the same rule with \uD834
  // (the high half of the G clef pair above) standing alone.
  const result = unescapeString('\\uD834');
  expect(result.value).toBe('\uD834');
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]!.message.toLowerCase()).toContain('low half is missing');
  expect(result.warnings[0]!.position).toBe(0);
});

it('a lone low surrogate escape is accepted and returns one warning naming the missing half', () => {
  // RFC 8259 section 8.2: "\uDEAD" (a single unpaired UTF-16 surrogate).
  const result = unescapeString('\\uDEAD');
  expect(result.value).toBe('\uDEAD');
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]!.message.toLowerCase()).toContain('high half is missing');
  expect(result.warnings[0]!.position).toBe(0);
});

it('the strict-Unicode option rejects both lone surrogate escapes', () => {
  expect(() => unescapeString('\\uD834', { strict: true })).toThrow(JsonStringError);
  expect(() => unescapeString('\\uDEAD', { strict: true })).toThrow(JsonStringError);

  let error: JsonStringError | undefined;
  try {
    unescapeString('\\uDEAD', { strict: true });
  } catch (err) {
    error = err as JsonStringError;
  }
  expect(error!.message).toContain('8259');
  expect(error!.message.toLowerCase()).toContain('strict');
});

it('with escape-above-ASCII off, a lone surrogate is still emitted as an escape rather than raw', () => {
  const loneHigh = '\uD834'; // a JS string containing only a high surrogate code unit
  const result = escapeString(loneHigh, { escapeAboveAscii: false });
  expect(result.value).toBe('\\uD834');
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]!.position).toBe(0);

  // Contrast: a well-formed pair with the same option off is emitted raw, not escaped.
  const gClef = String.fromCodePoint(0x1d11e);
  const pairedResult = escapeString(gClef, { escapeAboveAscii: false });
  expect(pairedResult.value).toBe(gClef);
  expect(pairedResult.warnings).toEqual([]);
});

it('an escape outside the RFC table is rejected with its position', () => {
  let error: JsonStringError | undefined;
  try {
    unescapeString('a\\qb');
  } catch (err) {
    error = err as JsonStringError;
  }
  expect(error).toBeInstanceOf(JsonStringError);
  expect(error!.message).toContain('\\q');
  expect(error!.position).toBe(1);
});

it('every character below the space is escaped, by its two-character form or by \\uXXXX', () => {
  for (let code = 0; code < 0x20; code++) {
    const ch = String.fromCharCode(code);
    const { value } = escapeString(ch);
    expect(value.startsWith('\\'), `code 0x${code.toString(16)} was emitted raw: "${value}"`).toBe(true);
  }
});

it('the forward slash is optional on the way out and always accepted on the way in', () => {
  expect(escapeString('/').value).toBe('/');
  expect(escapeString('/', { escapeForwardSlash: true }).value).toBe('\\/');
  expect(unescapeString('/').value).toBe('/');
  expect(unescapeString('\\/').value).toBe('/');
});

it('a four-hex-digit escape with too few digits or a non-hex digit is rejected at its position', () => {
  expect(() => unescapeString('\\u12')).toThrow(JsonStringError);
  expect(() => unescapeString('\\u12zz')).toThrow(JsonStringError);
});

it('wrap surrounds the result in double quotes on the way out and strips them on the way in', () => {
  const escaped = escapeString('hi', { wrap: true });
  expect(escaped.value).toBe('"hi"');
  expect(unescapeString('"hi"', { wrap: true }).value).toBe('hi');
});

it('a raw, un-escaped quotation mark is rejected', () => {
  expect(() => unescapeString('a"b')).toThrow(JsonStringError);
});
