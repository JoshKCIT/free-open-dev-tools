/**
 * The fixed matrix that records every answer the Number Base Converter gave before the programmer calculator was added.
 *
 * `runMatrix(api)` calls every earlier export over a fixed set of inputs and returns one row per call: the function name,
 * the arguments as plain text, and either the result or the message of the error it threw. A bigint is written as its
 * decimal digits followed by `n`, so the rows are plain JSON and compare byte for byte.
 *
 * The rows in `fixtures/legacy-outputs.json` were recorded from the module as it stood before `src/expression.ts`
 * existed. `legacy-outputs.test.ts` reruns this matrix on the finished module and requires the same rows.
 */

/** The earlier exports the matrix calls. A later export is never listed here, so adding one cannot change a row. */
export interface LegacyApi {
  parseInBase(text: string, base: number): unknown;
  toBase(value: bigint, base: number, uppercase?: boolean): string;
  convertAll(value: bigint, uppercase?: boolean, bases?: number[]): unknown;
  group(rendered: string, base: number): string;
  widthReport(value: bigint): unknown;
  calculate(a: bigint, b: bigint, operation: never, width?: never): bigint;
  atWidth(value: bigint, width: never): unknown;
  fitsWidth(value: bigint, width: never): boolean;
  FIXED_WIDTHS: readonly number[];
  WIDTH_OPERATIONS: ReadonlySet<string>;
  UNARY_OPERATIONS: ReadonlySet<string>;
  FIXED_WIDTH_ONLY_OPERATIONS: ReadonlySet<string>;
}

export interface LegacyRow {
  fn: string;
  args: unknown[];
  result?: unknown;
  error?: string;
}

/** Bigints become `<digits>n`, everything else keeps its shape, so the whole row survives JSON. */
export function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = plain((value as Record<string, unknown>)[key]);
    return out;
  }
  if (value === undefined) return '__undefined__';
  return value;
}

const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Input strings for parseInBase: zero, negatives, prefixes, separators, a 64 digit hash and invalid text. */
export const INPUTS: string[] = [
  '0',
  '-0',
  '1',
  '7',
  '9',
  '10',
  '255',
  '-255',
  '+42',
  '  12  ',
  '1010',
  '102',
  '777',
  '0xff',
  '0XFF',
  '0b1010',
  '0B11',
  '0o777',
  '0O17',
  '-0x1F',
  '+0b1',
  '0x',
  '0b',
  '0o',
  'ff',
  'FF',
  'zz',
  'Zz',
  'z',
  'dead_beef',
  'dead beef',
  'dead,beef',
  "dead'beef",
  '1,000,000',
  '1_000_000',
  '000123',
  '0x00ff',
  '',
  '   ',
  '-',
  '+',
  '--1',
  '0xg',
  '12.5',
  '1e5',
  '1-1',
  'hello world',
  '#',
  HASH,
  '0x' + HASH,
  '18446744073709551616',
  '-18446744073709551616',
  '340282366920938463463374607431768211456',
  '1'.repeat(300),
  'z'.repeat(80),
  String.fromCodePoint(0x663),
  String.fromCodePoint(0xff10),
  `12${String.fromCodePoint(0xa0)}34`,
  '0x0x1',
  '0b0b1',
];

const BASES = Array.from({ length: 35 }, (_, i) => i + 2);
const BAD_BASES = [0, 1, 37, -2, 2.5, Number.NaN, 100];

/** Values for toBase, convertAll, widthReport, atWidth and fitsWidth, around every width edge. */
export const VALUES: bigint[] = (() => {
  const out = new Set<bigint>([0n, 1n, -1n, 2n, 7n, 10n, 35n, 36n, 255n, -255n, 3735928559n, -3735928559n]);
  for (const width of [8n, 16n, 32n, 64n, 128n, 256n]) {
    const top = 1n << width;
    const half = top >> 1n;
    for (const edge of [top, half]) {
      for (const delta of [-1n, 0n, 1n]) {
        out.add(edge + delta);
        out.add(-edge + delta);
      }
    }
  }
  out.add(BigInt(`0x${HASH}`));
  out.add(-BigInt(`0x${HASH}`));
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
})();

const OPERATIONS = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'modulo',
  'power',
  'and',
  'or',
  'xor',
  'not',
  'nand',
  'nor',
  'xnor',
  'shiftLeft',
  'shiftRight',
  'shiftRightLogical',
  'rotateLeft',
  'rotateRight',
  'byteSwap',
] as const;

const WIDTHS = ['unbounded', 8, 16, 32, 64, 128] as const;
const FIXED = [8, 16, 32, 64, 128] as const;

/** Operand pairs tried at every width: zero, negatives and amounts for shifts, rotates and powers. */
export const PAIRS: Array<[bigint, bigint]> = [
  [0n, 0n],
  [1n, 0n],
  [0n, 1n],
  [5n, 3n],
  [-7n, 2n],
  [7n, -2n],
  [-7n, 3n],
  [255n, 1n],
  [256n, 8n],
  [-1n, 9n],
  [0x80000001n, 1n],
  [0x12345678n, 4n],
  [0xdeadbeefn, 0n],
  [3n, 100001n],
  [2n, 4097n],
  [-8n, -1n],
];

/** Pairs at the edges of one width, tried at that width and at the unbounded width. */
export function edgePairs(width: number): Array<[bigint, bigint]> {
  const w = BigInt(width);
  const top = 1n << w;
  const half = top >> 1n;
  return [
    [half, 1n],
    [half - 1n, 1n],
    [top - 1n, 1n],
    [top, 1n],
    [-half, 1n],
    [-half - 1n, 1n],
    [top - 1n, w],
    [1n, w - 1n],
    [1n, w],
    [1n, w + 3n],
    [half, w - 1n],
    [-half, w],
  ];
}

type Call = () => unknown;

/** Calls `call`, returning its result as plain data or the message of the error it threw. */
function record(rows: LegacyRow[], fn: string, args: unknown[], call: Call): void {
  const shown = args.map(plain);
  try {
    rows.push({ fn, args: shown, result: plain(call()) });
  } catch (err) {
    rows.push({ fn, args: shown, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
}

/** Runs the whole matrix against `api` and returns its rows in a fixed order. */
export function runMatrix(api: LegacyApi): LegacyRow[] {
  const rows: LegacyRow[] = [];

  for (const input of INPUTS) {
    for (const base of BASES) record(rows, 'parseInBase', [input, base], () => api.parseInBase(input, base));
  }
  for (const base of BAD_BASES) {
    record(rows, 'parseInBase', ['10', base], () => api.parseInBase('10', base));
    record(rows, 'toBase', [10n, base], () => api.toBase(10n, base));
  }

  for (const value of VALUES) {
    // Every base for small values; a spread of bases for the large ones, so the file stays a reasonable size.
    for (const base of value > -4096n && value < 4096n ? BASES : [2, 3, 7, 8, 10, 16, 32, 36]) {
      record(rows, 'toBase', [value, base, false], () => api.toBase(value, base, false));
      record(rows, 'toBase', [value, base, true], () => api.toBase(value, base, true));
    }
    record(rows, 'convertAll', [value], () => api.convertAll(value));
    record(rows, 'convertAll', [value, true], () => api.convertAll(value, true));
    record(rows, 'convertAll', [value, false, [3, 12, 20, 36]], () => api.convertAll(value, false, [3, 12, 20, 36]));
    record(rows, 'convertAll', [value, true, [2, 16]], () => api.convertAll(value, true, [2, 16]));
    record(rows, 'convertAll', [value, false, []], () => api.convertAll(value, false, []));
    record(rows, 'widthReport', [value], () => api.widthReport(value));
    for (const width of FIXED) {
      record(rows, 'atWidth', [value, width], () => api.atWidth(value, width as never));
      record(rows, 'fitsWidth', [value, width], () => api.fitsWidth(value, width as never));
    }
  }

  for (const value of VALUES) {
    for (const base of [2, 8, 10, 16]) {
      const rendered = api.toBase(value, base);
      record(rows, 'group', [rendered, base], () => api.group(rendered, base));
    }
  }
  for (const text of ['', '0', '1', '12', '123', '1234', '-1', '-12345', '10101010101', 'ff', 'abcde']) {
    for (const base of [2, 8, 10, 16, 36]) record(rows, 'group', [text, base], () => api.group(text, base));
  }

  for (const operation of OPERATIONS) {
    for (const width of WIDTHS) {
      const pairs =
        width === 'unbounded' ? [...PAIRS, ...FIXED.flatMap((x) => edgePairs(x))] : [...PAIRS, ...edgePairs(width)];
      for (const [a, b] of pairs) {
        record(rows, 'calculate', [a, b, operation, width], () =>
          width === 'unbounded'
            ? api.calculate(a, b, operation as never)
            : api.calculate(a, b, operation as never, width as never),
        );
      }
    }
  }
  record(rows, 'calculate', [1n, 2n, 'add'], () => api.calculate(1n, 2n, 'add' as never));
  record(rows, 'calculate', [1n, 2n, 'noSuchOperation', 8], () =>
    api.calculate(1n, 2n, 'noSuchOperation' as never, 8 as never),
  );

  rows.push({ fn: 'FIXED_WIDTHS', args: [], result: plain([...api.FIXED_WIDTHS]) });
  for (const name of ['WIDTH_OPERATIONS', 'UNARY_OPERATIONS', 'FIXED_WIDTH_ONLY_OPERATIONS'] as const) {
    rows.push({ fn: name, args: [], result: [...api[name]].sort() });
  }
  return rows;
}
