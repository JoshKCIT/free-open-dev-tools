import { EditorConfigError } from './errors';
import { MAX_RANGE_DIGITS, MAX_SECTION_NAME, WORK_BUDGET, withCommas } from './limits';

/**
 * EditorConfig glob matching without a regular expression.
 *
 * A section name is compiled once into a short list of instructions (a character, any character but a slash, a class, a
 * star, a double star, a number range, a split, a jump, a match). A path is matched by running the list as a set of
 * positions: one pass over the path, a flag for every instruction that can be reached at the current place, no
 * backtracking. Braces are never expanded: `{a,b}` is a split into two branches, so a run of braces costs the sum of its
 * parts and not their product. Matching costs about (instructions) x (path length), and that product is charged against a
 * work budget before the path is looked at, so no pasted pattern can keep the page busy.
 *
 * The rules the specification does not spell out but the published core tests require are kept (see test/glob.test.ts):
 * a bracket pair that holds a slash is not a class and its `[` is an ordinary character; a double star between two slashes
 * matches zero or more folders; `{one}`, `{}` and a `{` with no closing `}` are ordinary text; `{a,b,}` keeps the empty branch;
 * `{n..m}` matches the integers from n to m written without leading zeros, and is ordinary text when n is not below m.
 */

const OP_CHAR = 0;
const OP_ANY = 1;
const OP_CLASS = 2;
const OP_STAR = 3;
const OP_DSTAR = 4;
const OP_NUMBER = 5;
const OP_SPLIT = 6;
const OP_JUMP = 7;
const OP_MATCH = 8;

const SLASH = 47;
const BACKSLASH = 92;
const STAR = 42;
const QUESTION = 63;
const LBRACKET = 91;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;
const COMMA = 44;
const BANG = 33;
const DASH = 45;
const PLUS = 43;
const DOT = 46;
const ZERO = 48;
const NINE = 57;

/** How many characters a number range looks at where it starts: a sign and nine digits are all a range can hold. */
const NUMBER_LOOKAHEAD = MAX_RANGE_DIGITS + 2;
/** What one number range counts for in the work budget. */
const NUMBER_WEIGHT = NUMBER_LOOKAHEAD + 1;

interface Instruction {
  op: number;
  /** A character code, the low end of a range, a branch target or a jump target. */
  a: number;
  /** The high end of a range or the second branch target. */
  b: number;
  /** A class: pairs of low and high code points, flat. */
  items: number[];
  negated: boolean;
}

function make(op: number, a = 0, b = 0): Instruction {
  return { op, a, b, items: [], negated: false };
}

/** A compiled section name. It holds no text of the pattern. */
export interface Program {
  readonly instructions: readonly Instruction[];
  /** The cost of running it over one place of the path. */
  readonly weight: number;
}

/** The work still allowed. `matchGlob` takes its cost from `remaining` before it looks at a path. */
export interface Budget {
  remaining: number;
}

export function newBudget(total: number = WORK_BUDGET): Budget {
  return { remaining: total };
}

function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

/** The code points of a text, one number each; a character outside the basic plane is one number. */
function codePoints(text: string): number[] {
  const points: number[] = [];
  for (const character of text) points.push(character.codePointAt(0) ?? 0);
  return points;
}

/** The instructions for "nothing, or any folders and a slash", put in front of a name that holds no slash. */
function emitOptionalFolders(out: Instruction[]): void {
  const start = out.length;
  out.push(make(OP_SPLIT, start + 1, start + 2));
  out.push(make(OP_JUMP, start + 4));
  out.push(make(OP_DSTAR));
  out.push(make(OP_CHAR, SLASH));
}

interface Range {
  low: number;
  high: number;
}

/**
 * Reads `n..m` between two positions of the pattern: an optional sign and digits, two dots, an optional sign and digits.
 * Returns null when the text between is anything else. An end of more than nine digits is refused.
 */
function readNumberRange(g: readonly number[], from: number, to: number): Range | null {
  let p = from;
  let sign1 = 1;
  if (g[p] === PLUS || g[p] === DASH) {
    sign1 = g[p] === DASH ? -1 : 1;
    p += 1;
  }
  const digits1 = p;
  let low = 0;
  while (p < to && isDigit(g[p] ?? 0)) {
    low = low * 10 + ((g[p] ?? 0) - ZERO);
    p += 1;
  }
  const count1 = p - digits1;
  if (count1 === 0) return null;
  if (g[p] !== DOT || g[p + 1] !== DOT) return null;
  p += 2;
  let sign2 = 1;
  if (g[p] === PLUS || g[p] === DASH) {
    sign2 = g[p] === DASH ? -1 : 1;
    p += 1;
  }
  const digits2 = p;
  let high = 0;
  while (p < to && isDigit(g[p] ?? 0)) {
    high = high * 10 + ((g[p] ?? 0) - ZERO);
    p += 1;
  }
  const count2 = p - digits2;
  if (count2 === 0 || p !== to) return null;
  if (count1 > MAX_RANGE_DIGITS || count2 > MAX_RANGE_DIGITS) {
    throw new EditorConfigError(
      `a number range in a section name has an end of more than ${MAX_RANGE_DIGITS} digits, which this page does not read.`,
    );
  }
  return { low: sign1 * low, high: sign2 * high };
}

/**
 * Compiles a section name to a program. With a folder, the program matches the whole path from the top folder (the folder
 * and a slash come first); without one it matches a path relative to the folder of its file, which is what the resolver
 * does. A name with no slash outside brackets may match at any folder level below its file; a name with a slash is
 * anchored at its file's folder, and a leading slash is dropped.
 */
export function compileGlob(name: string, folder = ''): Program {
  // The parser already refuses a name over 1,024 characters. The compiler checks again (a character outside the basic plane is
  // two UTF-16 units) so that no caller can make it follow an endless run of nested braces.
  if (name.length > 2 * MAX_SECTION_NAME) {
    throw new EditorConfigError(
      `A section name is longer than this page reads: at most ${withCommas(MAX_SECTION_NAME)} characters.`,
    );
  }
  const g = codePoints(name);
  const n = g.length;
  const out: Instruction[] = [];
  if (folder !== '') {
    for (const point of codePoints(folder)) out.push(make(OP_CHAR, point));
    out.push(make(OP_CHAR, SLASH));
  }

  let hasSlash = false;
  let inBracket = false;
  for (let i = 0; i < n; i++) {
    const c = g[i] ?? 0;
    if (c === BACKSLASH) {
      i += 1;
      continue;
    }
    if (c === LBRACKET) inBracket = true;
    else if (c === RBRACKET) inBracket = false;
    else if (c === SLASH && !inBracket) {
      hasSlash = true;
      break;
    }
  }
  let begin = 0;
  if (!hasSlash) emitOptionalFolders(out);
  else if (n > 0 && g[0] === SLASH) begin = 1;

  // One pass over the name finds, for every `{`, the `}` that closes it and the commas that split its branches, and for
  // every position the slashes before it. Escapes are skipped the same way everywhere.
  const closeOf = new Int32Array(n).fill(-1);
  const commasOf = new Map<number, number[]>();
  const slashesBefore = new Int32Array(n + 1);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) slashesBefore[i + 1] = (slashesBefore[i] ?? 0) + (g[i] === SLASH ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const c = g[i] ?? 0;
    if (c === BACKSLASH) {
      i += 1;
      continue;
    }
    if (c === LBRACE) stack.push(i);
    else if (c === RBRACE) {
      const open = stack.pop();
      if (open !== undefined) closeOf[open] = i;
    } else if (c === COMMA && stack.length > 0) {
      const top = stack[stack.length - 1] ?? 0;
      const list = commasOf.get(top);
      if (list === undefined) commasOf.set(top, [i]);
      else list.push(i);
    }
  }
  // stopAt[p]: where a class that starts scanning at p ends (the first `]` that no backslash escapes), or n when none.
  const stopAt = new Int32Array(n + 2).fill(n);
  for (let p = n - 1; p >= 0; p--) {
    const c = g[p] ?? 0;
    if (c === RBRACKET) stopAt[p] = p;
    else if (c === BACKSLASH) stopAt[p] = stopAt[Math.min(p + 2, n)] ?? n;
    else stopAt[p] = stopAt[p + 1] ?? n;
  }

  const emit = (from: number, to: number): void => {
    let i = from;
    while (i < to) {
      const c = g[i] ?? 0;
      if (c === BACKSLASH) {
        if (i + 1 < to) {
          out.push(make(OP_CHAR, g[i + 1] ?? 0));
          i += 2;
        } else {
          out.push(make(OP_CHAR, BACKSLASH));
          i += 1;
        }
        continue;
      }
      if (c === STAR) {
        if (g[i + 1] === STAR && i + 1 < to) {
          if (g[i + 2] === SLASH && i + 2 < to && (i === from || g[i - 1] === SLASH)) {
            emitOptionalFolders(out);
            i += 3;
          } else {
            out.push(make(OP_DSTAR));
            i += 2;
          }
        } else {
          out.push(make(OP_STAR));
          i += 1;
        }
        continue;
      }
      if (c === QUESTION) {
        out.push(make(OP_ANY));
        i += 1;
        continue;
      }
      if (c === LBRACKET) {
        let j = i + 1;
        if (g[j] === BANG && j < to) j += 1;
        let k = j;
        if (g[k] === RBRACKET && k < to) k += 1;
        k = stopAt[k] ?? n;
        if (k >= to || (slashesBefore[k] ?? 0) - (slashesBefore[i + 1] ?? 0) > 0) {
          out.push(make(OP_CHAR, LBRACKET));
          i += 1;
          continue;
        }
        let bodyStart = i + 1;
        const item = make(OP_CLASS);
        if (g[bodyStart] === BANG) {
          item.negated = true;
          bodyStart += 1;
        }
        for (let m = bodyStart; m < k; m++) {
          let low = g[m] ?? 0;
          if (low === BACKSLASH && m + 1 < k) {
            low = g[m + 1] ?? 0;
            m += 1;
          }
          if (g[m + 1] === DASH && m + 2 < k) {
            let high = g[m + 2] ?? 0;
            if (high === BACKSLASH && m + 3 < k) {
              high = g[m + 3] ?? 0;
              m += 1;
            }
            item.items.push(low, high);
            m += 2;
          } else {
            item.items.push(low, low);
          }
        }
        out.push(item);
        i = k + 1;
        continue;
      }
      if (c === LBRACE) {
        const close = closeOf[i] ?? -1;
        if (close < 0) {
          out.push(make(OP_CHAR, LBRACE));
          i += 1;
          continue;
        }
        const commas = commasOf.get(i);
        if (commas === undefined) {
          const range = readNumberRange(g, i + 1, close);
          if (range !== null && range.low < range.high) {
            out.push(make(OP_NUMBER, range.low, range.high));
          } else {
            out.push(make(OP_CHAR, LBRACE));
            emit(i + 1, close);
            out.push(make(OP_CHAR, RBRACE));
          }
          i = close + 1;
          continue;
        }
        const starts = [i + 1, ...commas.map((comma) => comma + 1)];
        const ends = [...commas, close];
        const jumps: Instruction[] = [];
        for (let branch = 0; branch < starts.length; branch++) {
          if (branch < starts.length - 1) {
            const split = make(OP_SPLIT);
            out.push(split);
            split.a = out.length;
            emit(starts[branch] ?? 0, ends[branch] ?? 0);
            const jump = make(OP_JUMP);
            out.push(jump);
            jumps.push(jump);
            split.b = out.length;
          } else {
            emit(starts[branch] ?? 0, ends[branch] ?? 0);
          }
        }
        for (const jump of jumps) jump.a = out.length;
        i = close + 1;
        continue;
      }
      out.push(make(OP_CHAR, c));
      i += 1;
    }
  };
  emit(begin, n);
  out.push(make(OP_MATCH));

  let weight = 0;
  for (const instruction of out) weight += instruction.op === OP_NUMBER ? NUMBER_WEIGHT : 1;
  return { instructions: out, weight };
}

function classHas(instruction: Instruction, point: number): boolean {
  const items = instruction.items;
  let hit = false;
  for (let i = 0; i < items.length; i += 2) {
    if (point >= (items[i] ?? 0) && point <= (items[i + 1] ?? -1)) {
      hit = true;
      break;
    }
  }
  return instruction.negated ? !hit : hit;
}

/**
 * Whether a path matches a compiled name. The cost (instructions times places, a number range counting for several) is
 * taken from the budget first; a budget that cannot pay it refuses the match instead of running. Neither the program nor
 * the path is changed, so the same arguments always give the same answer.
 */
export function matchGlob(program: Program, path: string, budget: Budget): boolean {
  const chars = codePoints(path);
  const length = chars.length;
  const cost = program.weight * (length + 1);
  if (cost > budget.remaining) {
    throw new EditorConfigError(
      `Matching these section names against this path would take more work than this page allows (a work budget of ${withCommas(WORK_BUDGET)} steps). Paste fewer sections or shorter patterns, or use a shorter path.`,
    );
  }
  budget.remaining -= cost;

  const instructions = program.instructions;
  const count = instructions.length;
  const mark = new Int32Array(count);
  const consumers: number[] = [];
  const work: number[] = [];
  const ahead = new Map<number, number[]>();
  let seeds: number[] = [0];
  for (let pos = 0; pos <= length; pos++) {
    const stamp = pos + 1;
    consumers.length = 0;
    for (const pc of seeds) work.push(pc);
    const jumped = ahead.get(pos);
    if (jumped !== undefined) {
      for (const pc of jumped) work.push(pc);
      ahead.delete(pos);
    }
    while (work.length > 0) {
      const pc = work.pop() ?? 0;
      if (mark[pc] === stamp) continue;
      mark[pc] = stamp;
      const instruction = instructions[pc];
      if (instruction === undefined) continue;
      switch (instruction.op) {
        case OP_SPLIT:
          work.push(instruction.a, instruction.b);
          break;
        case OP_JUMP:
          work.push(instruction.a);
          break;
        case OP_STAR:
        case OP_DSTAR:
          work.push(pc + 1);
          consumers.push(pc);
          break;
        case OP_NUMBER:
          scheduleNumber(instruction, pc, pos, chars, ahead);
          break;
        case OP_MATCH:
          if (pos === length) return true;
          break;
        default:
          consumers.push(pc);
      }
    }
    if (pos === length) return false;
    const point = chars[pos] ?? 0;
    const next: number[] = [];
    for (const pc of consumers) {
      const instruction = instructions[pc];
      if (instruction === undefined) continue;
      switch (instruction.op) {
        case OP_CHAR:
          if (point === instruction.a) next.push(pc + 1);
          break;
        case OP_ANY:
          if (point !== SLASH) next.push(pc + 1);
          break;
        case OP_CLASS:
          if (classHas(instruction, point)) next.push(pc + 1);
          break;
        case OP_STAR:
          if (point !== SLASH) next.push(pc);
          break;
        case OP_DSTAR:
          next.push(pc);
          break;
        default:
          break;
      }
    }
    seeds = next;
    if (seeds.length === 0 && ahead.size === 0) return false;
  }
  return false;
}

/**
 * A number range at place `pos`: finds every way the integers from its low to its high end can be written there (an
 * optional sign, then digits with no leading zero, or a lone 0) and files the instruction after the range under the place
 * each way ends.
 */
function scheduleNumber(
  instruction: Instruction,
  pc: number,
  pos: number,
  chars: readonly number[],
  ahead: Map<number, number[]>,
): void {
  const length = chars.length;
  let p = pos;
  let sign = 1;
  let signed = false;
  const lead = chars[p];
  if (lead === DASH || lead === PLUS) {
    sign = lead === DASH ? -1 : 1;
    signed = true;
    p += 1;
  }
  const first = p;
  let value = 0;
  while (p < length && p - first < MAX_RANGE_DIGITS + 1 && isDigit(chars[p] ?? 0)) {
    const digit = (chars[p] ?? 0) - ZERO;
    if (p === first && digit === 0 && signed) return;
    value = value * 10 + digit;
    p += 1;
    if (sign * value >= instruction.a && sign * value <= instruction.b) {
      const target = p;
      const list = ahead.get(target);
      if (list === undefined) ahead.set(target, [pc + 1]);
      else list.push(pc + 1);
    }
    if (value === 0) return;
  }
}
