import { expect, it } from 'vitest';
import { MAX_OUTPUT_CHARS, MsgpackCborError, convert } from '../src/index';

/*
 * How much JSON text a deeply nested value can write (found by the phase 13 review). A JSON text is the value's tokens
 * plus two spaces of indentation per level, counted by hand below.
 */

/** A CBOR value: `depth` indefinite-length arrays, one inside the next, then `leaves` zeros, then the breaks. */
function nested(depth: number, leaves: number): Uint8Array {
  const out = new Uint8Array(depth * 2 + leaves);
  out.fill(0x9f, 0, depth);
  out.fill(0x00, depth, depth + leaves);
  out.fill(0xff, depth + leaves);
  return out;
}

it('a value whose indentation would write more than 32 MiB of JSON is refused with a message that names the limit and diagnostic notation', () => {
  // 255 levels and 100,000 zeros: every zero line is 2 x 256 spaces, a digit and a comma and a line break, so the text
  // would be 100,000 x 515 = 51,500,000 characters, past the limit of 33,554,432.
  expect(MAX_OUTPUT_CHARS).toBe(33554432);
  const input = nested(255, 100000);
  let error: unknown;
  try {
    convert({ format: 'cbor', direction: 'to-json', input, inputEncoding: 'hex', outputEncoding: 'hex', show: 'json' });
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(MsgpackCborError);
  const message = (error as Error).message;
  expect(message).toContain('32 MiB');
  expect(message).toContain('33,554,432');
  expect(message).toContain('diagnostic notation');
  // Diagnostic notation does not indent, so the same value is shown.
  const diagnostic = convert({
    format: 'cbor',
    direction: 'to-json',
    input,
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'diagnostic',
  });
  expect(diagnostic.text.length).toBeLessThan(600000);
});

it('a value that stays under the limit is written whole, however deep: 255 levels with one zero, 16 levels with 100,000 zeros', () => {
  const deep = convert({
    format: 'cbor',
    direction: 'to-json',
    input: nested(255, 1),
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'json',
  });
  // Level n has its line at 2n spaces: the text is 255 opening lines, the zero line and 255 closing lines.
  expect(deep.text.split('\n')).toHaveLength(255 + 1 + 255 + 1 - 1);
  const wide = convert({
    format: 'cbor',
    direction: 'to-json',
    input: nested(16, 100000),
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'json',
  });
  // 100,000 zero lines at 2 x 16 spaces, a digit, a comma and a line break (the last has no comma): 35 each.
  expect(wide.text.length).toBeGreaterThan(100000 * 34);
  expect(wide.text.length).toBeLessThan(MAX_OUTPUT_CHARS);
});
