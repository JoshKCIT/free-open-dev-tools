/**
 * A fixed-width integer calculator that follows C.
 *
 * An expression such as `(0xFF & ~0x0F) >> 2` is read by a hand-written tokeniser and a precedence-climbing parser and
 * evaluated with BigInt. It is never run as code and no regular expression is built from it. Every operation is computed
 * exactly and then wrapped to the chosen width in two's complement, as if its result were stored back into a variable of
 * that type, so a step that does not fit is flagged instead of being rounded or lost.
 *
 * This file does not import from `./index`: `index.ts` re-exports it, and a class here that extended the one in `index.ts`
 * would read it before it exists.
 */

/** The widths the calculator offers. Not the same list as the fixed widths of the bitwise operations. */
export const EXPRESSION_WIDTHS = [8, 16, 32, 64, 128, 256] as const;
export type ExpressionWidth = (typeof EXPRESSION_WIDTHS)[number];

/** An expression longer than this is refused before it is read. */
export const MAX_EXPRESSION_CHARACTERS = 2_000;
/** Parentheses nested deeper than this are refused. */
export const MAX_NESTING = 64;
/** The most steps listed in a result; the rest are only counted. */
export const MAX_STEPS_SHOWN = 200;

/** A refusal. The message holds a fixed phrase and a position, never any of the text that was typed. */
export class ExpressionError extends Error {
  /** The 1-based position in the expression that the refusal is about. */
  readonly position: number;

  constructor(phrase: string, position: number) {
    super(`${phrase} (position ${position})`);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

export interface ExpressionType {
  width: number;
  signed: boolean;
  /** The smallest and largest value of the type. */
  min: bigint;
  max: bigint;
  /** Reduces any integer to the type, two's complement. */
  wrap(x: bigint): bigint;
}

export function makeType(width: number, signed: boolean): ExpressionType {
  const w = BigInt(width);
  return {
    width,
    signed,
    min: signed ? -(1n << (w - 1n)) : 0n,
    max: signed ? (1n << (w - 1n)) - 1n : (1n << w) - 1n,
    wrap: (x) => (signed ? BigInt.asIntN(width, x) : BigInt.asUintN(width, x)),
  };
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^' | '<<' | '>>' | '>>>';
export type UnaryOperator = '-' | '+' | '~';

/** Why a step is worth a second look. */
export type StepNote = 'undefined-in-c' | 'shift-at-or-over-width';

export interface OperationResult {
  value: bigint;
  /** The exact result did not fit the type and was wrapped. */
  wrapped: boolean;
  note?: StepNote;
}

/**
 * One binary operation on two values already in the type's range. Division and remainder by zero and a negative shift
 * count are refused (the caller passes the position of the operator).
 */
export function applyBinary(
  op: BinaryOperator,
  a: bigint,
  b: bigint,
  type: ExpressionType,
  position = 1,
): OperationResult {
  const exact = (math: bigint, note?: StepNote): OperationResult => {
    const value = type.wrap(math);
    const result: OperationResult = { value, wrapped: value !== math };
    if (note) result.note = note;
    return result;
  };
  const width = BigInt(type.width);
  switch (op) {
    case '+':
      return exact(a + b);
    case '-':
      return exact(a - b);
    case '*':
      return exact(a * b);
    case '/': {
      if (b === 0n) throw new ExpressionError('Division by zero', position);
      // BigInt division truncates toward zero, as C does.
      const result = exact(a / b);
      if (result.wrapped) result.note = 'undefined-in-c';
      return result;
    }
    case '%': {
      if (b === 0n) throw new ExpressionError('Remainder by zero', position);
      const result = exact(a % b);
      if (type.signed && b === -1n && a === type.min) result.note = 'undefined-in-c';
      return result;
    }
    case '&':
      return { value: type.wrap(a & b), wrapped: false };
    case '|':
      return { value: type.wrap(a | b), wrapped: false };
    case '^':
      return { value: type.wrap(a ^ b), wrapped: false };
    case '<<': {
      if (b < 0n) throw new ExpressionError('A shift count cannot be negative', position);
      if (b >= width) return { value: 0n, wrapped: false, note: 'shift-at-or-over-width' };
      return exact(a << b);
    }
    case '>>': {
      if (b < 0n) throw new ExpressionError('A shift count cannot be negative', position);
      if (b >= width) return { value: a < 0n ? -1n : 0n, wrapped: false, note: 'shift-at-or-over-width' };
      return { value: type.wrap(a >> b), wrapped: false };
    }
    case '>>>': {
      if (b < 0n) throw new ExpressionError('A shift count cannot be negative', position);
      if (b >= width) return { value: 0n, wrapped: false, note: 'shift-at-or-over-width' };
      return { value: type.wrap(BigInt.asUintN(type.width, a) >> b), wrapped: false };
    }
  }
}

/** One unary operation on a value already in the type's range. */
export function applyUnary(op: UnaryOperator, a: bigint, type: ExpressionType): OperationResult {
  if (op === '~') return { value: type.wrap(~a), wrapped: false };
  if (op === '+') return { value: a, wrapped: false };
  const math = -a;
  const value = type.wrap(math);
  const result: OperationResult = { value, wrapped: value !== math };
  if (type.signed && a === type.min) result.note = 'undefined-in-c';
  return result;
}

export interface Step {
  /** 1-based, in the order the steps were done. */
  step: number;
  operation: string;
  left: bigint;
  /** Absent for a unary operation. */
  right?: bigint;
  result: bigint;
  wrapped: boolean;
  note?: StepNote;
  /** The 1-based position of the operator in the expression. */
  position: number;
}

export interface ExpressionNote {
  kind: 'wrapped' | 'shift' | 'undefined-in-c' | 'leading-zero';
  message: string;
  position: number;
}

export interface ExpressionResult {
  /** In the type's range: negative only when signed. */
  value: bigint;
  /** The same bits as an unsigned pattern of the width. */
  bits: bigint;
  /** How many steps wrapped. */
  wrapped: number;
  /** The position of the operator of the first step that wrapped. */
  firstWrapAt?: number;
  steps: Step[];
  /** Steps done but not listed because the list stops at MAX_STEPS_SHOWN. */
  stepsOmitted: number;
  notes: ExpressionNote[];
}

interface Token {
  kind: 'number' | 'operator' | 'open' | 'close';
  text: string;
  position: number;
}

const OPERATOR_CHARACTERS = '+-*/%&|^~';
const NUMBER_CHARACTERS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'";
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
/** Operators that can be written with an equals sign after them, which would make an assignment. */
const ASSIGNABLE = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>'];

/** 2000 as 2,000. Only ever given a number. */
function withCommas(n: number): string {
  const digits = String(n);
  let out = '';
  for (let k = 0; k < digits.length; k++) {
    if (k > 0 && (digits.length - k) % 3 === 0) out += ',';
    out += digits.charAt(k);
  }
  return out;
}

/** One pass over the text with an index. Every refusal is a fixed phrase with a position. */
function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (token: Token): void => {
    tokens.push(token);
    if (ASSIGNABLE.includes(token.text) && source.charAt(token.position - 1 + token.text.length) === '=') {
      throw new ExpressionError(
        'Assignment is not part of the calculator; it only evaluates one expression',
        token.position,
      );
    }
  };
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < source.length && NUMBER_CHARACTERS.includes(source.charAt(j))) j++;
      tokens.push({ kind: 'number', text: source.slice(i, j), position: i + 1 });
      i = j;
    } else if (c === '<' && next === '<') {
      push({ kind: 'operator', text: '<<', position: i + 1 });
      i += 2;
    } else if (c === '>' && next === '>') {
      const triple = source.charAt(i + 2) === '>';
      push({ kind: 'operator', text: triple ? '>>>' : '>>', position: i + 1 });
      i += triple ? 3 : 2;
    } else if (c === '*' && next === '*') {
      throw new ExpressionError('There is no power operator; multiply instead', i + 1);
    } else if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
      throw new ExpressionError('Logical AND and OR are not part of the calculator; use & and | on the bits', i + 1);
    } else if (OPERATOR_CHARACTERS.includes(c)) {
      push({ kind: 'operator', text: c, position: i + 1 });
      i++;
    } else if (c === '(') {
      tokens.push({ kind: 'open', text: c, position: i + 1 });
      i++;
    } else if (c === ')') {
      tokens.push({ kind: 'close', text: c, position: i + 1 });
      i++;
    } else if (c === '!') {
      throw new ExpressionError('Logical NOT and not-equal are not part of the calculator; use ~ for the bits', i + 1);
    } else if (c === '<' || c === '>') {
      throw new ExpressionError(
        'Comparisons are not part of the calculator; it gives a number, not true or false',
        i + 1,
      );
    } else if (c === '=') {
      throw new ExpressionError('Assignment and comparison are not part of the calculator', i + 1);
    } else if (c === '?' || c === ':') {
      throw new ExpressionError('The conditional operator is not part of the calculator', i + 1);
    } else if (c === '.') {
      throw new ExpressionError('Only whole numbers are read; a decimal point is not part of the calculator', i + 1);
    } else if (c === ',' || c === ';') {
      throw new ExpressionError('Write one expression; a comma or semicolon is not part of the calculator', i + 1);
    } else if (LETTERS.includes(c)) {
      throw new ExpressionError('Variables, names and functions are not part of the calculator', i + 1);
    } else {
      throw new ExpressionError('This character is not part of the calculator', i + 1);
    }
  }
  return tokens;
}

/** C precedence among the binary operators present, lowest first. All are left associative. */
const PRECEDENCE: ReadonlyMap<string, number> = new Map([
  ['|', 1],
  ['^', 2],
  ['&', 3],
  ['<<', 4],
  ['>>', 4],
  ['>>>', 4],
  ['+', 5],
  ['-', 5],
  ['*', 6],
  ['/', 6],
  ['%', 6],
]);

const DIGITS = '0123456789abcdef';

interface Literal {
  value: bigint;
  /** A decimal written with a leading zero, which C would read as octal. */
  leadingZero: boolean;
  /** The decimal 2^(w-1), read as the smallest value because a minus sign stands directly in front of it. */
  usedMinus: boolean;
}

/** The range of the type in words, with the numbers only where they are short. */
function rangeText(type: ExpressionType): string {
  const kind = `${type.width} bits ${type.signed ? 'signed' : 'unsigned'}`;
  return type.width <= 64 ? `${kind}, ${type.min} to ${type.max}` : kind;
}

/** How many significant digits a number of this base can have and still be tested against the width. */
function digitLimit(base: number, width: number): number {
  if (base === 16) return Math.ceil((width + 2) / 4);
  if (base === 8) return Math.ceil((width + 2) / 3);
  if (base === 2) return width + 2;
  return Math.floor((width + 2) * 0.30103) + 2;
}

/**
 * Reads one number token. A hexadecimal, octal or binary number is a bit pattern of the width, read in the chosen
 * signedness. A decimal number must lie in the type's range; the one exception is the smallest value of a signed type,
 * which can only be written with a minus sign directly in front of the decimal (`allowMinimum`).
 */
function readLiteral(token: Token, type: ExpressionType, allowMinimum: boolean): Literal {
  const text = token.text;
  const marker = text.length > 1 && text.charAt(0) === '0' ? text.charAt(1).toLowerCase() : '';
  const base = marker === 'x' ? 16 : marker === 'b' ? 2 : marker === 'o' ? 8 : 10;
  const body = base === 10 ? text : text.slice(2);
  if (body === '') throw new ExpressionError('A number needs digits after its prefix', token.position);
  let digits = '';
  for (let k = 0; k < body.length; k++) {
    const ch = body.charAt(k);
    if (ch === '_' || ch === "'") {
      const before = k > 0 ? body.charAt(k - 1) : '';
      const after = k + 1 < body.length ? body.charAt(k + 1) : '';
      if (before === '' || before === '_' || before === "'" || after === '' || after === '_' || after === "'") {
        throw new ExpressionError('A digit separator must sit between two digits', token.position);
      }
      continue;
    }
    const digit = DIGITS.indexOf(ch.toLowerCase());
    if (digit < 0 || digit >= base) {
      throw new ExpressionError(
        base === 10
          ? 'Only whole decimal numbers are read; suffixes such as u or L and exponents are not part of the calculator'
          : `This digit is not valid in a ${base === 16 ? 'hexadecimal' : base === 8 ? 'octal' : 'binary'} number`,
        token.position,
      );
    }
    digits += ch;
  }
  let first = 0;
  while (first < digits.length - 1 && digits.charAt(first) === '0') first++;
  const significant = digits.slice(first);
  // Checked against the width before BigInt reads the digits, so a huge run of digits costs nothing more.
  if (significant.length > digitLimit(base, type.width)) {
    throw new ExpressionError(`This number does not fit in ${type.width} bits`, token.position);
  }
  const parsed = BigInt((base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : '') + significant);
  if (base !== 10) {
    if (parsed >= 1n << BigInt(type.width)) {
      throw new ExpressionError(`This bit pattern does not fit in ${type.width} bits`, token.position);
    }
    return { value: type.signed ? BigInt.asIntN(type.width, parsed) : parsed, leadingZero: false, usedMinus: false };
  }
  const leadingZero = digits.length > 1 && digits.charAt(0) === '0';
  if (parsed <= type.max) return { value: parsed, leadingZero, usedMinus: false };
  if (type.signed && allowMinimum && parsed === type.max + 1n) return { value: type.min, leadingZero, usedMinus: true };
  const asPattern = type.signed && parsed < 1n << BigInt(type.width);
  const advice = asPattern
    ? ` Write 0x${parsed
        .toString(16)
        .toUpperCase()
        .padStart(type.width / 4, '0')} for the bit pattern.`
    : '';
  throw new ExpressionError(`This number is outside the range of ${rangeText(type)}.${advice}`, token.position);
}

/** Counts one kind of note over the whole expression and remembers where the first one was. */
class Tally {
  count = 0;
  first = 0;
  add(position: number): void {
    if (this.count === 0) this.first = position;
    this.count++;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Evaluates one expression at a width, signed or unsigned for the whole expression. Throws ExpressionError. */
export function evaluateExpression(source: string, options: { width: number; signed: boolean }): ExpressionResult {
  if (!(EXPRESSION_WIDTHS as readonly number[]).includes(options.width)) {
    throw new ExpressionError(`The width must be one of ${EXPRESSION_WIDTHS.join(', ')} bits`, 1);
  }
  if (source.length > MAX_EXPRESSION_CHARACTERS) {
    throw new ExpressionError(
      `The expression is ${withCommas(source.length)} characters; the limit is ${withCommas(MAX_EXPRESSION_CHARACTERS)}`,
      MAX_EXPRESSION_CHARACTERS + 1,
    );
  }
  const type = makeType(options.width, options.signed);
  const tokens = tokenise(source);
  const end = source.length + 1;
  const steps: Step[] = [];
  let stepCount = 0;
  let wrapped = 0;
  let firstWrapAt: number | undefined;
  let index = 0;
  let depth = 0;
  const shifts = new Tally();
  const undefinedInC = new Tally();
  const leadingZeros = new Tally();

  const record = (
    operation: string,
    left: bigint,
    right: bigint | undefined,
    result: OperationResult,
    position: number,
  ): bigint => {
    stepCount++;
    if (result.wrapped) {
      wrapped++;
      firstWrapAt ??= position;
    }
    if (result.note === 'shift-at-or-over-width') shifts.add(position);
    if (result.note === 'undefined-in-c') undefinedInC.add(position);
    if (steps.length < MAX_STEPS_SHOWN) {
      const step: Step = { step: stepCount, operation, left, result: result.value, wrapped: result.wrapped, position };
      if (right !== undefined) step.right = right;
      if (result.note) step.note = result.note;
      steps.push(step);
    }
    return result.value;
  };

  const primary = (): bigint => {
    // Unary prefixes are collected in a loop and applied from the nearest one outwards, so a long chain uses no recursion.
    const prefixes: Token[] = [];
    let token = tokens[index];
    while (token && token.kind === 'operator' && (token.text === '-' || token.text === '+' || token.text === '~')) {
      prefixes.push(token);
      index++;
      token = tokens[index];
    }
    if (!token) throw new ExpressionError('An operand is missing', end);
    let value: bigint;
    if (token.kind === 'number') {
      const nearest = prefixes[prefixes.length - 1];
      const literal = readLiteral(token, type, nearest !== undefined && nearest.text === '-');
      if (literal.leadingZero) leadingZeros.add(token.position);
      value = literal.value;
      // The smallest value of a signed type is the literal with its own minus sign: that sign is not a separate step.
      if (literal.usedMinus) prefixes.pop();
      index++;
    } else if (token.kind === 'open') {
      depth++;
      if (depth > MAX_NESTING) {
        throw new ExpressionError(`Nesting is deeper than ${MAX_NESTING} levels`, token.position);
      }
      index++;
      value = expression(1);
      const close = tokens[index];
      if (!close || close.kind !== 'close') throw new ExpressionError('This parenthesis is not closed', token.position);
      index++;
      depth--;
    } else {
      throw new ExpressionError('An operand is expected here', token.position);
    }
    for (let k = prefixes.length - 1; k >= 0; k--) {
      const prefix = prefixes[k] as Token;
      const op = prefix.text as UnaryOperator;
      if (op === '+') continue;
      value = record(op, value, undefined, applyUnary(op, value, type), prefix.position);
    }
    return value;
  };

  const expression = (minimum: number): bigint => {
    let left = primary();
    for (;;) {
      const token = tokens[index];
      if (!token || token.kind !== 'operator') return left;
      const precedence = PRECEDENCE.get(token.text);
      if (precedence === undefined || precedence < minimum) return left;
      index++;
      const right = expression(precedence + 1);
      const op = token.text as BinaryOperator;
      left = record(op, left, right, applyBinary(op, left, right, type, token.position), token.position);
    }
  };

  const value = expression(1);
  const rest = tokens[index];
  if (rest) {
    throw new ExpressionError(
      rest.kind === 'close' ? 'This parenthesis has no match' : 'An operator is expected here',
      rest.position,
    );
  }

  // Notes hold counts, positions and fixed words, never any of the text that was typed.
  const notes: ExpressionNote[] = [];
  if (firstWrapAt !== undefined) {
    notes.push({
      kind: 'wrapped',
      message: `${plural(wrapped, 'step', 'steps')} did not fit in ${type.width} bits and ${wrapped === 1 ? 'was' : 'were'} wrapped; the first is the operator at position ${firstWrapAt}.`,
      position: firstWrapAt,
    });
  }
  if (shifts.count > 0) {
    notes.push({
      kind: 'shift',
      message: `${plural(shifts.count, 'shift uses', 'shifts use')} a count at or above the width of ${type.width} bits, which C leaves undefined; the result is 0, or -1 for a negative value shifted right. The first is the operator at position ${shifts.first}.`,
      position: shifts.first,
    });
  }
  if (undefinedInC.count > 0) {
    notes.push({
      kind: 'undefined-in-c',
      message: `${plural(undefinedInC.count, 'step is', 'steps are')} undefined in C (the smallest value divided by -1, or with its sign changed); the wrapped result is shown. The first is the operator at position ${undefinedInC.first}.`,
      position: undefinedInC.first,
    });
  }
  if (leadingZeros.count > 0) {
    notes.push({
      kind: 'leading-zero',
      message: `${plural(leadingZeros.count, 'number starts', 'numbers start')} with 0 and ${leadingZeros.count === 1 ? 'is' : 'are'} read as decimal; C would read it as octal. Write 0o for octal. The first is at position ${leadingZeros.first}.`,
      position: leadingZeros.first,
    });
  }

  const result: ExpressionResult = {
    value,
    bits: BigInt.asUintN(options.width, value),
    wrapped,
    steps,
    stepsOmitted: stepCount - steps.length,
    notes,
  };
  if (firstWrapAt !== undefined) result.firstWrapAt = firstWrapAt;
  return result;
}

export interface FormattedResult {
  /** `0x` and width/4 digits. */
  hex: string;
  /** The bit pattern as an unsigned decimal. */
  unsigned: string;
  /** The same bits read as two's complement. */
  signed: string;
  /** `0o` and the octal digits. */
  octal: string;
  /** The width in binary digits, ungrouped. */
  binary: string;
}

/** Writes a result in every base the page shows. Upper case changes the hexadecimal digits only. */
export function formatResult(
  result: Pick<ExpressionResult, 'bits'>,
  width: number,
  options: { uppercase?: boolean } = {},
): FormattedResult {
  const bits = BigInt.asUintN(width, result.bits);
  const digits = bits.toString(16).padStart(width / 4, '0');
  return {
    hex: `0x${options.uppercase ? digits.toUpperCase() : digits}`,
    unsigned: bits.toString(10),
    signed: BigInt.asIntN(width, bits).toString(10),
    octal: `0o${bits.toString(8)}`,
    binary: bits.toString(2).padStart(width, '0'),
  };
}
