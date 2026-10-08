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

/** One pass over the text with an index. */
function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < source.length && NUMBER_CHARACTERS.includes(source.charAt(j))) j++;
      tokens.push({ kind: 'number', text: source.slice(i, j), position: i + 1 });
      i = j;
    } else if (c === '<' && source.charAt(i + 1) === '<') {
      tokens.push({ kind: 'operator', text: '<<', position: i + 1 });
      i += 2;
    } else if (c === '>' && source.charAt(i + 1) === '>') {
      const triple = source.charAt(i + 2) === '>';
      tokens.push({ kind: 'operator', text: triple ? '>>>' : '>>', position: i + 1 });
      i += triple ? 3 : 2;
    } else if (OPERATOR_CHARACTERS.includes(c)) {
      tokens.push({ kind: 'operator', text: c, position: i + 1 });
      i++;
    } else if (c === '(') {
      tokens.push({ kind: 'open', text: c, position: i + 1 });
      i++;
    } else if (c === ')') {
      tokens.push({ kind: 'close', text: c, position: i + 1 });
      i++;
    } else {
      throw new ExpressionError('This character is not part of the calculator', i + 1);
    }
  }
  return tokens;
}

/** C precedence among the binary operators present, lowest first. All are left associative. */
const PRECEDENCE: Readonly<Record<string, number>> = {
  '|': 1,
  '^': 2,
  '&': 3,
  '<<': 4,
  '>>': 4,
  '>>>': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

function readLiteral(token: Token, type: ExpressionType): bigint {
  const text = token.text.split('_').join('').split("'").join('');
  const prefix = text.slice(0, 2).toLowerCase();
  let pattern: string;
  if (prefix === '0x' || prefix === '0b' || prefix === '0o') pattern = prefix + text.slice(2);
  else pattern = text;
  let value: bigint;
  try {
    value = BigInt(pattern);
  } catch {
    throw new ExpressionError('This number is not valid', token.position);
  }
  return type.wrap(value);
}

/** Evaluates one expression at a width, signed or unsigned for the whole expression. Throws ExpressionError. */
export function evaluateExpression(source: string, options: { width: number; signed: boolean }): ExpressionResult {
  if (source.length > MAX_EXPRESSION_CHARACTERS) {
    throw new ExpressionError(
      `The expression is ${source.length} characters; the limit is ${MAX_EXPRESSION_CHARACTERS}`,
      MAX_EXPRESSION_CHARACTERS + 1,
    );
  }
  const type = makeType(options.width, options.signed);
  const tokens = tokenise(source);
  const end = source.length + 1;
  const steps: Step[] = [];
  const notes: ExpressionNote[] = [];
  let stepCount = 0;
  let wrapped = 0;
  let firstWrapAt: number | undefined;
  let index = 0;
  let depth = 0;

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
      value = readLiteral(token, type);
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
      const result = applyUnary(op, value, type);
      value = op === '+' ? value : record(op, value, undefined, result, prefix.position);
    }
    return value;
  };

  const expression = (minimum: number): bigint => {
    let left = primary();
    for (;;) {
      const token = tokens[index];
      if (!token || token.kind !== 'operator') return left;
      const precedence = PRECEDENCE[token.text];
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
