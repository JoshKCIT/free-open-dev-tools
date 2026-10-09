/**
 * Code 128 (ISO/IEC 15417), described here from the GS1 General
 * Specifications' own "GS1-128" section (5.4, the same symbology as plain
 * Code 128 -- 5.4.3 says "GS1-128 barcode character assignments are
 * identical to Code 128 symbol character assignments").
 *
 * The 107 symbol patterns (values 0-106) are transcribed byte for byte from
 * the installed `@zxing/library`'s own `Code128Reader.CODE_PATTERNS`
 * (fetched source), which this file's own test
 * asserts against directly. Value 0's pattern "2 1 2 2 2 2" matches the
 * fetched GS1 text's own Table 5-25 element-width column for symbol
 * character value 0 exactly ("212222"), and value 100 ("Code B") matches
 * `@zxing/library`'s own `CODE_CODE_B = 100` constant, itself confirmed
 * against GS1's own Table 5-27 worked example, which weights a literal
 * "Code B" instruction at symbol value 100.
 */

export class BarcodeError extends Error {
  readonly position?: number;
  readonly reason: string;
  constructor(message: string, reason: string, position?: number) {
    super(message);
    this.name = 'BarcodeError';
    this.reason = reason;
    this.position = position;
  }
}

/** `@zxing/library`'s own `Code128Reader.CODE_PATTERNS` (esm build,
 * `core/oned/Code128Reader.js`), values 0-105 six elements each, value 106
 * (the stop character) seven. Every element is a module width; Code 128
 * symbol characters always start with a bar. */
export const CODE128_PATTERNS: readonly (readonly number[])[] = [
  [2, 1, 2, 2, 2, 2],
  [2, 2, 2, 1, 2, 2],
  [2, 2, 2, 2, 2, 1],
  [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2],
  [1, 2, 2, 2, 1, 3],
  [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2],
  [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2],
  [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2],
  [1, 2, 2, 1, 3, 2],
  [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2],
  [1, 2, 3, 2, 2, 1],
  [2, 2, 3, 2, 1, 1],
  [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1],
  [2, 1, 3, 2, 1, 2],
  [2, 2, 3, 1, 1, 2],
  [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2],
  [3, 2, 1, 2, 2, 1],
  [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2],
  [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3],
  [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1],
  [1, 1, 1, 3, 2, 3],
  [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3],
  [1, 3, 2, 1, 1, 3],
  [1, 3, 2, 3, 1, 1],
  [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3],
  [2, 3, 1, 3, 1, 1],
  [1, 1, 2, 1, 3, 3],
  [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3],
  [1, 1, 3, 3, 2, 1],
  [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1],
  [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1],
  [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1],
  [2, 1, 3, 1, 3, 1],
  [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1],
  [3, 1, 2, 1, 1, 3],
  [3, 1, 2, 3, 1, 1],
  [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1],
  [2, 2, 1, 4, 1, 1],
  [4, 3, 1, 1, 1, 1],
  [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4],
  [1, 2, 1, 4, 2, 1],
  [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1],
  [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2],
  [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1],
  [1, 4, 2, 1, 1, 2],
  [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4],
  [4, 1, 3, 1, 1, 1],
  [2, 4, 1, 1, 1, 2],
  [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2],
  [1, 2, 1, 1, 4, 2],
  [1, 2, 1, 2, 4, 1],
  [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1],
  [4, 1, 1, 2, 1, 2],
  [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1],
  [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1],
  [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3],
  [1, 1, 1, 3, 4, 1],
  [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 1, 1, 1, 1, 3],
  [4, 1, 1, 3, 1, 1],
  [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1],
  [3, 1, 1, 1, 4, 1],
  [4, 1, 1, 1, 3, 1],
  [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
  [2, 3, 3, 1, 1, 1, 2], // STOP (value 106): 7 elements
];

export const CODE_FNC3 = 96;
export const CODE_FNC2 = 97;
export const CODE_SHIFT = 98;
export const CODE_CODE_C = 99;
export const CODE_CODE_B = 100;
export const CODE_CODE_A = 101;
export const CODE_FNC1 = 102;
export const CODE_START_A = 103;
export const CODE_START_B = 104;
export const CODE_START_C = 105;
export const CODE_STOP = 106;

export const MAX_CODE128_LENGTH = 80;

type CodeSet = 'A' | 'B' | 'C';

function inSetA(code: number): boolean {
  return code >= 0 && code <= 95;
}
function inSetB(code: number): boolean {
  return code >= 32 && code <= 127;
}
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** ASCII -> Code Set A symbol value. GS1 5.4.3.8: ASCII = S + 32 for
 * S <= 63 (S in 0..63 -> ASCII 32..95); ASCII = S - 64 for 64 <= S <= 95
 * (S in 64..95 -> ASCII 0..31). Inverted here. */
function valueInSetA(code: number): number {
  return code >= 32 ? code - 32 : code + 64;
}
/** ASCII -> Code Set B symbol value. GS1 5.4.3.8: ASCII = S + 32 for
 * S <= 95 (S in 0..95 -> ASCII 32..127). Inverted here. */
function valueInSetB(code: number): number {
  return code - 32;
}

const START_FOR_SET: Record<CodeSet, number> = { A: CODE_START_A, B: CODE_START_B, C: CODE_START_C };
const SWITCH_FOR_SET: Record<CodeSet, number> = { A: CODE_CODE_A, B: CODE_CODE_B, C: CODE_CODE_C };
const SETS: CodeSet[] = ['A', 'B', 'C'];

interface PlannedStep {
  /** The set active while this step's data value(s) are produced. */
  set: CodeSet;
  /** How many input characters this step consumes (1, or 2 for set C). */
  consumed: number;
}

/**
 * Chooses a minimal-length sequence of code sets and switches with a
 * bottom-up dynamic program: for every position, the cost of consuming the
 * next character(s) while staying in each of the three sets is computed
 * first (this only ever looks at already-solved, later positions), then
 * the cost of being at that position in each set is the best of staying
 * put or switching into a cheaper target set (switching never chains,
 * since two switches in a row costs exactly as much as one switch
 * straight to the final target). No FNC codes or Shift are considered
 * (`limits`): a run needing a single stray character from the other set
 * pays for a full switch, which is the standard, simplest Code 128
 * encoder behaviour and is what the required brute-force comparison test
 * also searches over.
 */
function planSets(codes: number[]): { steps: PlannedStep[]; startSet: CodeSet } {
  const n = codes.length;
  // minCost[pos][set]: minimum number of symbol characters (switches +
  // data) needed to encode codes[pos..n) given the current active set is
  // `set` at `pos`, not counting the very first START character.
  const minCost: number[][] = Array.from({ length: n + 1 }, () => [0, 0, 0]);
  const consumeInfo: (PlannedStep | null)[][] = Array.from({ length: n }, () => [null, null, null]);
  const consumeCost: number[][] = Array.from({ length: n }, () => [Infinity, Infinity, Infinity]);

  const idx = (s: CodeSet): number => (s === 'A' ? 0 : s === 'B' ? 1 : 2);

  for (let pos = n - 1; pos >= 0; pos--) {
    for (const set of SETS) {
      if (set === 'C') {
        if (pos + 1 < n && isDigit(codes[pos]!) && isDigit(codes[pos + 1]!)) {
          consumeCost[pos]![idx('C')] = 1 + minCost[pos + 2]![idx('C')]!;
          consumeInfo[pos]![idx('C')] = { set: 'C', consumed: 2 };
        }
      } else if (set === 'A') {
        if (inSetA(codes[pos]!)) {
          consumeCost[pos]![idx('A')] = 1 + minCost[pos + 1]![idx('A')]!;
          consumeInfo[pos]![idx('A')] = { set: 'A', consumed: 1 };
        }
      } else {
        if (inSetB(codes[pos]!)) {
          consumeCost[pos]![idx('B')] = 1 + minCost[pos + 1]![idx('B')]!;
          consumeInfo[pos]![idx('B')] = { set: 'B', consumed: 1 };
        }
      }
    }
    for (const set of SETS) {
      let best = Infinity;
      for (const target of SETS) {
        const switchCost = target === set ? 0 : 1;
        const total = switchCost + consumeCost[pos]![idx(target)]!;
        if (total < best) best = total;
      }
      minCost[pos]![idx(set)] = best;
    }
  }

  let startSet: CodeSet = 'A';
  let bestStart = Infinity;
  for (const set of SETS) {
    if (minCost[0]![idx(set)]! < bestStart) {
      bestStart = minCost[0]![idx(set)]!;
      startSet = set;
    }
  }

  const steps: PlannedStep[] = [];
  let pos = 0;
  let current = startSet;
  while (pos < n) {
    let target = current;
    let best = consumeCost[pos]![idx(current)]!;
    for (const candidate of SETS) {
      if (candidate === current) continue;
      const total = 1 + consumeCost[pos]![idx(candidate)]!;
      if (total < best) {
        best = total;
        target = candidate;
      }
    }
    current = target;
    const info = consumeInfo[pos]![idx(current)]!;
    steps.push(info);
    pos += info.consumed;
  }

  return { steps, startSet };
}

export interface Code128Result {
  /** Every symbol value in order, including the start character, every
   * switch, every data character, the check character and the stop
   * character. */
  values: number[];
  /** The bar/space module string, "1" for a bar and "0" for a space. */
  modules: string;
  checkValue: number;
}

function patternToModules(widths: readonly number[]): string {
  let out = '';
  let bar = true; // Code 128 symbol characters always start with a bar
  for (const w of widths) {
    out += (bar ? '1' : '0').repeat(w);
    bar = !bar;
  }
  return out;
}

/**
 * Encodes ASCII 0-127 text (at most 80 characters) as Code 128, choosing
 * code sets to minimise the number of symbol characters. GS1 5.4.7.5.1's
 * own symbol check character algorithm: the start character is weighted 1,
 * then every following symbol character (switches included) is weighted by
 * its 1-based position after the start, summed and reduced modulo 103.
 */
export function encodeCode128(data: string): Code128Result {
  if (data.length === 0) {
    throw new BarcodeError('Code 128 needs at least one character.', 'empty');
  }
  if (data.length > MAX_CODE128_LENGTH) {
    throw new BarcodeError(
      `Code 128 accepts at most ${MAX_CODE128_LENGTH} characters; this is ${data.length}.`,
      'too-long',
    );
  }
  const codes: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code > 127) {
      throw new BarcodeError(`The character at position ${i + 1} is not ASCII.`, 'non-ascii', i + 1);
    }
    codes.push(code);
  }

  const { steps, startSet } = planSets(codes);

  const values: number[] = [START_FOR_SET[startSet]];
  let currentSet = startSet;
  let pos = 0;
  for (const step of steps) {
    if (step.set !== currentSet) {
      values.push(SWITCH_FOR_SET[step.set]);
      currentSet = step.set;
    }
    if (step.set === 'C') {
      const twoDigits = String.fromCharCode(codes[pos]!) + String.fromCharCode(codes[pos + 1]!);
      values.push(Number(twoDigits));
    } else if (step.set === 'A') {
      values.push(valueInSetA(codes[pos]!));
    } else {
      values.push(valueInSetB(codes[pos]!));
    }
    pos += step.consumed;
  }

  let sum = values[0]!; // start character weighted 1
  for (let i = 1; i < values.length; i++) {
    sum += values[i]! * i;
  }
  const checkValue = sum % 103;
  values.push(checkValue);
  values.push(CODE_STOP);

  const modules = values.map((v) => patternToModules(CODE128_PATTERNS[v]!)).join('');
  return { values, modules, checkValue };
}
