import { drawUniformIntBounded, newModeByteReader } from './sampler';

/** Most dice one term may roll, and most one whole expression may roll. */
export const MAX_DICE_PER_TERM = 1_000;
export const MAX_DICE_TOTAL = 10_000;
/** A die has at least 2 and at most 1,000,000 sides. */
export const MIN_SIDES = 2;
export const MAX_SIDES = 1_000_000;
/** Longer text is refused before it is read. */
export const MAX_NOTATION_CHARACTERS = 200;
/** The largest plain number an expression may add or subtract. */
export const MAX_CONSTANT = 999_999_999;

/**
 * The dice notation this tool reads, in its own words. Shown on the page and listed in the supported formats.
 * Integers only, so every total is exact: at most 10,000 dice of at most 1,000,000 sides, plus constants below a billion.
 */
export const DICE_GRAMMAR = [
  "expression := term (('+' | '-') term)*",
  'term := dice | integer',
  "dice := [count] 'd' (sides | '%' | 'F') [modifier]",
  "modifier := ('kh' | 'kl' | 'dh' | 'dl') [n]",
  'd% is d100 and dF is a fudge die (minus one, zero or plus one). kh keeps the highest n dice, kl the lowest n, dh drops the highest n and dl drops the lowest n (n is 1 when left out). Letters can be in any case and spaces are allowed around + and -.',
  'A term rolls at most 1,000 dice, an expression at most 10,000, and a die has 2 to 1,000,000 sides. Where equal dice tie for a place, the earlier roll is the one kept.',
].join('\n');

/** The notation could not be read, or it asks for more than the limits allow. */
export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceError';
  }
}

export type DiceModifierKind = 'kh' | 'kl' | 'dh' | 'dl';

export interface DiceModifier {
  kind: DiceModifierKind;
  /** How many dice are kept or dropped, from 1 to the number of dice in the term. */
  count: number;
}

export interface DiceDiceTerm {
  type: 'dice';
  sign: 1 | -1;
  count: number;
  /** A number of sides from 2 to 1,000,000, or 'F' for a fudge die. `d%` reads as 100 sides. */
  sides: number | 'F';
  modifier: DiceModifier | null;
  /** The term written out in full, with its operator when it is not the first, such as `+1d4` or `4d6kh3`. */
  notation: string;
}

export interface DiceConstantTerm {
  type: 'constant';
  sign: 1 | -1;
  value: number;
  notation: string;
}

export type DiceTerm = DiceDiceTerm | DiceConstantTerm;

export interface DiceExpression {
  terms: DiceTerm[];
  /** How many dice the whole expression rolls. */
  diceCount: number;
}

export interface RolledTerm {
  notation: string;
  /** Every die in the order it was rolled. Empty for a constant. */
  rolls: number[];
  /** The dice that count, in roll order. */
  kept: number[];
  /** The dice that do not count, in roll order. */
  dropped: number[];
  /** Positions (from 0) in `rolls` of the kept dice. */
  keptIndexes: number[];
  /** The kept dice added up, negative for a subtracted term; a constant's own value for a constant. */
  subtotal: number;
}

export interface DiceRoll {
  terms: RolledTerm[];
  total: number;
  diceRolled: number;
}

const MODIFIERS = new Map<string, DiceModifierKind>([
  ['kh', 'kh'],
  ['kl', 'kl'],
  ['dh', 'dh'],
  ['dl', 'dl'],
]);

interface Reader {
  text: string;
  i: number;
}

/** A fixed sentence and a 1-based position; the typed text is never repeated. */
function fail(what: string, position: number): never {
  throw new DiceError(`This is not dice notation: ${what} at character ${position}.`);
}

/** Lower-cases ASCII letters only, so no other character can pose as a letter of the notation. */
function asciiLower(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function skipSpaces(r: Reader): void {
  while (r.i < r.text.length) {
    const c = r.text.charCodeAt(r.i);
    if (c !== 32 && c !== 9) return;
    r.i++;
  }
}

/** Reads a run of digits. A value past the largest constant stops growing, so any run of digits is read in one pass. */
function readNumber(r: Reader): number | null {
  let value = 0;
  let any = false;
  while (r.i < r.text.length) {
    const c = r.text.charCodeAt(r.i);
    if (c < 48 || c > 57) break;
    any = true;
    if (value <= MAX_CONSTANT) value = value * 10 + (c - 48);
    r.i++;
  }
  return any ? value : null;
}

function readTerm(r: Reader, sign: 1 | -1, operator: string): DiceTerm {
  const start = r.i;
  const count = readNumber(r);
  const letter = r.i < r.text.length ? asciiLower(r.text.charCodeAt(r.i)) : 0;

  if (letter !== 100) {
    // Not a die: a plain number, or nothing a term can start with.
    if (count === null) fail('a number or dice such as d6 was expected', start + 1);
    if (count > MAX_CONSTANT) fail('this number is too large', start + 1);
    return { type: 'constant', sign, value: count, notation: operator + String(count) };
  }

  if (count !== null && count < 1) fail('a term must roll at least 1 die', start + 1);
  if (count !== null && count > MAX_DICE_PER_TERM) fail('a term cannot roll more than 1,000 dice', start + 1);
  const dice = count ?? 1;
  r.i++; // the d

  let sides: number | 'F';
  let sidesText: string;
  const next = r.i < r.text.length ? r.text.charCodeAt(r.i) : 0;
  if (next === 37) {
    sides = 100;
    sidesText = '%';
    r.i++;
  } else if (asciiLower(next) === 102) {
    sides = 'F';
    sidesText = 'F';
    r.i++;
  } else {
    const sidesStart = r.i;
    const read = readNumber(r);
    if (read === null) fail('the number of sides is missing', r.i + 1);
    if (read < MIN_SIDES || read > MAX_SIDES) fail('the number of sides must be from 2 to 1,000,000', sidesStart + 1);
    sides = read;
    sidesText = String(read);
  }

  let modifier: DiceModifier | null = null;
  if (r.i + 1 < r.text.length) {
    const key = String.fromCharCode(asciiLower(r.text.charCodeAt(r.i)), asciiLower(r.text.charCodeAt(r.i + 1)));
    const kind = MODIFIERS.get(key);
    if (kind) {
      r.i += 2;
      const digitsStart = r.i;
      const given = readNumber(r);
      if (given !== null && (given < 1 || given > dice)) {
        fail('the keep or drop count must be from 1 to the number of dice in the term', digitsStart + 1);
      }
      modifier = { kind, count: given ?? 1 };
    }
  }

  const notation = `${operator}${dice}d${sidesText}${modifier ? modifier.kind + String(modifier.count) : ''}`;
  return { type: 'dice', sign, count: dice, sides, modifier, notation };
}

/**
 * Reads dice notation in one pass. Nothing about the typed text is repeated in a refusal: each message is a fixed
 * sentence and the 1-based position of the first problem. Text over 200 characters is refused before it is read.
 */
export function parseDiceNotation(text: string): DiceExpression {
  if (text.length > MAX_NOTATION_CHARACTERS) {
    fail('the text is longer than 200 characters', MAX_NOTATION_CHARACTERS + 1);
  }
  if (text.trim() === '') fail('nothing was typed', 1);

  const r: Reader = { text, i: 0 };
  const terms: DiceTerm[] = [];
  let diceCount = 0;
  let sign: 1 | -1 = 1;
  skipSpaces(r);
  for (;;) {
    const termStart = r.i;
    const term = readTerm(r, sign, terms.length === 0 ? '' : sign === 1 ? '+' : '-');
    if (term.type === 'dice') {
      diceCount += term.count;
      if (diceCount > MAX_DICE_TOTAL) fail('an expression cannot roll more than 10,000 dice', termStart + 1);
    }
    terms.push(term);
    skipSpaces(r);
    if (r.i >= text.length) break;
    const c = text.charCodeAt(r.i);
    if (c === 43) sign = 1;
    else if (c === 45) sign = -1;
    else fail('a + or - was expected', r.i + 1);
    r.i++;
    skipSpaces(r);
  }
  return { terms, diceCount };
}

/** How many of `dice` dice count, and whether the highest or the lowest ones do. */
function keepPlan(modifier: DiceModifier | null, dice: number): { keep: number; highest: boolean } {
  if (!modifier) return { keep: dice, highest: true };
  switch (modifier.kind) {
    case 'kh':
      return { keep: modifier.count, highest: true };
    case 'kl':
      return { keep: modifier.count, highest: false };
    case 'dh':
      // Dropping the highest n is keeping the lowest dice - n.
      return { keep: dice - modifier.count, highest: false };
    default:
      return { keep: dice - modifier.count, highest: true };
  }
}

function rollTerm(term: DiceDiceTerm, readByte: () => number): RolledTerm {
  const fudge = term.sides === 'F';
  const span = fudge ? 3 : (term.sides as number);
  const offset = fudge ? -1 : 1;
  const rolls: number[] = [];
  for (let i = 0; i < term.count; i++) rolls.push(drawUniformIntBounded(span, readByte) + offset);

  const { keep, highest } = keepPlan(term.modifier, term.count);
  // Order the dice from the ones that count first; equal dice keep their roll order, so the earliest rolled is kept.
  const order = Array.from({ length: rolls.length }, (_, index) => index);
  order.sort((a, b) => (highest ? rolls[b]! - rolls[a]! : rolls[a]! - rolls[b]!) || a - b);
  const isKept = new Array<boolean>(rolls.length).fill(false);
  for (let i = 0; i < keep; i++) isKept[order[i]!] = true;

  const kept: number[] = [];
  const dropped: number[] = [];
  const keptIndexes: number[] = [];
  let sum = 0;
  rolls.forEach((value, index) => {
    if (isKept[index]) {
      kept.push(value);
      keptIndexes.push(index);
      sum += value;
    } else {
      dropped.push(value);
    }
  });
  return { notation: term.notation, rolls, kept, dropped, keptIndexes, subtotal: term.sign * sum };
}

/**
 * Rolls a parsed expression. Every die comes from the shared rejection sampler over the cryptographic source.
 * `byteSource` is for tests only: it replaces the source with a fixed byte sequence.
 */
export function rollDice(expression: DiceExpression, options?: { byteSource?: number[] }): DiceRoll {
  const readByte = newModeByteReader(options?.byteSource);
  const terms: RolledTerm[] = [];
  let total = 0;
  let diceRolled = 0;
  for (const term of expression.terms) {
    if (term.type === 'constant') {
      const subtotal = term.sign * term.value;
      terms.push({ notation: term.notation, rolls: [], kept: [], dropped: [], keptIndexes: [], subtotal });
      total += subtotal;
    } else {
      const rolled = rollTerm(term, readByte);
      terms.push(rolled);
      total += rolled.subtotal;
      diceRolled += term.count;
    }
  }
  return { terms, total, diceRolled };
}
