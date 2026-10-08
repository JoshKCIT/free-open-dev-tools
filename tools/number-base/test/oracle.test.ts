import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import {
  applyBinary,
  applyUnary,
  evaluateExpression,
  makeType,
  ExpressionError,
  type BinaryOperator,
  type UnaryOperator,
} from '../src/index';

// Every expected value in this file is a recording made by a program other than the calculator: C compiled by clang 21.1.0
// (flags -std=gnu11 -O0 -fwrapv -fno-sanitize=undefined, from a scratch ziglang environment) or Python 3.14.3 integers
// masked to the width. The recorder and the recordings are in test/fixtures/oracle/ with a README. The tests only read them.

const dir = (name: string) => fileURLToPath(new URL(`./fixtures/oracle/${name}`, import.meta.url));

interface Table {
  type: string;
  op: string;
  results: string;
  undefined: string;
}

const OPERATOR_OF: Record<string, BinaryOperator> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  rem: '%',
  and: '&',
  or: '|',
  xor: '^',
  shl: '<<',
  shr: '>>',
  ushr: '>>>',
};
const UNARY_OF: Record<string, UnaryOperator> = { not: '~', neg: '-' };

const hexToValue = (hex: string, width: number, signed: boolean): bigint => {
  const bits = BigInt(`0x${hex}`);
  return signed ? BigInt.asIntN(width, bits) : bits;
};

interface WideRow {
  width: number;
  signed: boolean;
  op: BinaryOperator;
  a: string;
  b: string;
  result: string;
  source: string;
}

function readWide(): WideRow[] {
  const text = readFileSync(dir('wide-vectors.txt'), 'utf8');
  const rows: WideRow[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const [width, sign, op, a, b, result, source] = line.split(' ');
    rows.push({
      width: Number(width),
      signed: sign === 's',
      op: op as BinaryOperator,
      a: a as string,
      b: b as string,
      result: result as string,
      source: source as string,
    });
  }
  return rows;
}

/** Runs one recorded row through applyBinary and returns the result pattern in hex, or '!' when it is refused. */
function runRow(row: WideRow): string {
  const type = makeType(row.width, row.signed);
  const a = hexToValue(row.a, row.width, row.signed);
  const b = hexToValue(row.b, row.width, row.signed);
  try {
    const value = applyBinary(row.op, a, b, type).value;
    return BigInt.asUintN(row.width, value)
      .toString(16)
      .padStart(row.width / 4, '0');
  } catch (err) {
    if (err instanceof ExpressionError) return '!';
    throw err;
  }
}

it('the exhaustive 8-bit cells of 13 operations signed and unsigned equal the clang recording', () => {
  const recording = JSON.parse(readFileSync(dir('oracle8.json'), 'utf8')) as {
    compiler: string;
    flags: string;
    tables: Table[];
  };
  expect(recording.compiler).toContain('clang version 21.1.0');
  expect(recording.flags).toContain('-fwrapv');
  expect(recording.flags).toContain('-fno-sanitize=undefined');
  expect(recording.tables.length).toBe(26);

  let compared = 0;
  let undefinedCells = 0;
  const mismatches: string[] = [];
  for (const table of recording.tables) {
    const signed = table.type === 'int8';
    const type = makeType(8, signed);
    const results = gunzipSync(Buffer.from(table.results, 'base64'));
    const mask = gunzipSync(Buffer.from(table.undefined, 'base64'));
    expect(results.length).toBe(65536);
    expect(mask.length).toBe(65536);
    const binary = OPERATOR_OF[table.op];
    const unary = UNARY_OF[table.op];
    for (let ia = 0; ia < 256; ia++) {
      const a = signed ? BigInt.asIntN(8, BigInt(ia)) : BigInt(ia);
      for (let ib = 0; ib < 256; ib++) {
        const cell = ia * 256 + ib;
        if (mask[cell] === 1) {
          undefinedCells++;
          continue;
        }
        const b = signed ? BigInt.asIntN(8, BigInt(ib)) : BigInt(ib);
        const got = binary ? applyBinary(binary, a, b, type).value : applyUnary(unary as UnaryOperator, a, type).value;
        compared++;
        if (Number(BigInt.asUintN(8, got)) !== results[cell]) {
          if (mismatches.length < 5) mismatches.push(`${table.type} ${table.op} ${ia} ${ib}`);
        }
      }
    }
  }
  expect(mismatches).toEqual([]);
  // 26 tables of 65,536 cells; C leaves 345,088 of them undefined (a zero divisor, a shift count below 0 or above 31).
  expect(undefinedCells).toBe(345088);
  expect(compared).toBe(1358848);
});

it('the sampled 16, 32, 64 and 128 bit C vectors equal the clang recording', () => {
  const rows = readWide().filter((r) => r.source === 'c');
  expect(rows.length).toBeGreaterThan(8000);
  const widths = new Set(rows.map((r) => r.width));
  expect([...widths].sort((x, y) => x - y)).toEqual([16, 32, 64, 128]);
  const wrong = rows.filter((r) => runRow(r) !== r.result);
  expect(wrong.slice(0, 5)).toEqual([]);
});

it('the 128 and 256 bit vectors and the cells C leaves undefined equal the Python reference', () => {
  const rows = readWide().filter((r) => r.source === 'python');
  expect(rows.length).toBeGreaterThan(3000);
  expect(new Set(rows.map((r) => r.width)).has(256)).toBe(true);
  // Cells C leaves undefined at the smaller widths are in the Python rows too, and a row marked ! must be refused.
  expect(rows.some((r) => r.width === 32 && r.result !== '!')).toBe(true);
  expect(rows.filter((r) => r.result === '!').length).toBeGreaterThan(500);
  const wrong = rows.filter((r) => runRow(r) !== r.result);
  expect(wrong.slice(0, 5)).toEqual([]);
  // The 128 bit rows that C answered are in the test above; Python answers the 128 bit rows C skipped.
  expect(rows.some((r) => r.width === 128)).toBe(true);
});

it('the recorded C precedence corpus at 32 and 64 bits gives the C results', () => {
  const corpus = JSON.parse(readFileSync(dir('precedence.json'), 'utf8')) as {
    compiler: string;
    rows: { type: string; expr: string; result: string }[];
  };
  expect(corpus.compiler).toContain('clang version 21.1.0');
  expect(corpus.rows.length).toBeGreaterThan(1000);
  const types: Record<string, { width: number; signed: boolean }> = {
    uint32: { width: 32, signed: false },
    int32: { width: 32, signed: true },
    uint64: { width: 64, signed: false },
    int64: { width: 64, signed: true },
  };
  expect(new Set(corpus.rows.map((r) => r.type))).toEqual(new Set(Object.keys(types)));
  const wrong: string[] = [];
  for (const row of corpus.rows) {
    const kind = types[row.type] as { width: number; signed: boolean };
    const got = evaluateExpression(row.expr, kind).bits.toString(16);
    if (got !== row.result) wrong.push(`${row.type} ${row.expr} gave ${got}, C gave ${row.result}`);
  }
  expect(wrong.slice(0, 5)).toEqual([]);
});
