/**
 * Base64 variable length quantities, as ECMA-426 1st edition section 5.1 defines them ("Decode a base64 VLQ"): each
 * character carries six bits, the lowest bit of the first one is the sign, the next four bits are the low bits of the
 * value, and bit 5 of every character says another character follows (five more bits each). A value of 2 to the 31 or
 * more is an error, and a value of 0 with the sign bit set reads as -2147483648.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The six bit number of each ASCII character of the Base64 alphabet, or -1 for any other. */
export const DIGIT_OF: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

const TWO_TO_THE_31 = 2_147_483_648;
/** Past this the weight of a digit is not tracked further: any non-zero digit there is already too big. */
const WEIGHT_CEILING = 2 ** 40;

/** Why a value could not be read. */
export type VlqProblem = 'too-big' | 'truncated' | 'not-base64';

/** A value that cannot be read. `position` is the index in the text of the character that decided it. */
export class VlqError extends Error {
  readonly problem: VlqProblem;
  readonly position: number;

  constructor(problem: VlqProblem, position: number) {
    super(
      problem === 'too-big'
        ? `A value of 2 to the 31 or more at position ${position}.`
        : problem === 'truncated'
          ? `A value ends early at position ${position}.`
          : `A character outside the Base64 alphabet at position ${position}.`,
    );
    this.name = 'VlqError';
    this.problem = problem;
    this.position = position;
  }
}

/** Where a read value and the position after it are written. One object can be reused for every read. */
export interface VlqRead {
  value: number;
  next: number;
}

/**
 * Reads one value of `text` starting at `pos` and stopping at `end` (default: the end of the text). Writes the value
 * and the position after it into `out` and returns it. Throws a VlqError at the exact position of the character that
 * makes the value unreadable. A comma or a semicolon where a character of the value is expected means the value ended early, so a
 * value never runs across a segment.
 */
export function decodeVlq(
  text: string,
  pos: number,
  end: number = text.length,
  out: VlqRead = { value: 0, next: 0 },
): VlqRead {
  let at = pos;
  let code = text.charCodeAt(at);
  const first = code < 128 ? (DIGIT_OF[code] ?? -1) : -1;
  if (at >= end || first < 0)
    throw new VlqError(at >= end || code === 44 || code === 59 ? 'truncated' : 'not-base64', at);
  const negative = (first & 1) === 1;
  let value = (first >> 1) & 15;
  let weight = 16;
  let current = first;
  while ((current & 32) === 32) {
    at++;
    if (at >= end) throw new VlqError('truncated', at);
    code = text.charCodeAt(at);
    current = code < 128 ? (DIGIT_OF[code] ?? -1) : -1;
    if (current < 0) throw new VlqError(code === 44 || code === 59 ? 'truncated' : 'not-base64', at);
    value += (current & 31) * weight;
    if (value >= TWO_TO_THE_31) throw new VlqError('too-big', at);
    if (weight < WEIGHT_CEILING) weight *= 32;
  }
  out.next = at + 1;
  out.value = value === 0 && negative ? -TWO_TO_THE_31 : negative ? -value : value;
  return out;
}
