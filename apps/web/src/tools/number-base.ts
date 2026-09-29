import {
  meta,
  parseInBase,
  toBase,
  convertAll,
  group,
  widthReport,
  calculate,
  atWidth,
  fitsWidth,
  BaseError,
  WIDTH_OPERATIONS,
  UNARY_OPERATIONS,
  FIXED_WIDTHS,
  type Operation,
  type FixedWidth,
} from '@fodt/number-base';
import { defineTool, str, num, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const BASES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20, 32, 36];

/** and/or/xor/nand/nor/xnor: both operands are values, so both are checked against fitsWidth. Every other width operation's second operand is an amount, never wrapped. */
const BINARY_BITWISE_OPERATIONS = new Set<Operation>(['and', 'or', 'xor', 'nand', 'nor', 'xnor']);

export default defineTool({
  id: 'number-base',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'convert',
      options: [
        { value: 'convert', label: 'Convert' },
        { value: 'calculate', label: 'Calculate' },
      ],
    },
    {
      name: 'input',
      label: 'Number',
      type: 'text',
      mono: true,
      default: '255',
      placeholder: '255, 0xff, 0b1010, or dead_beef',
      help: 'A 0x, 0o or 0b prefix and underscore, space or comma separators are all accepted.',
    },
    {
      name: 'fromBase',
      label: 'Base of the input',
      type: 'select',
      default: '10',
      options: BASES.map((b) => ({
        value: String(b),
        label: `Base ${b}${b === 2 ? ' (binary)' : b === 8 ? ' (octal)' : b === 10 ? ' (decimal)' : b === 16 ? ' (hexadecimal)' : ''}`,
      })),
    },
    {
      name: 'operation',
      label: 'Operation',
      type: 'select',
      default: 'add',
      options: [
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'divide', label: 'Divide (truncating)' },
        { value: 'modulo', label: 'Remainder' },
        { value: 'power', label: 'Power' },
        { value: 'and', label: 'Bitwise AND' },
        { value: 'or', label: 'Bitwise OR' },
        { value: 'xor', label: 'Bitwise XOR' },
        { value: 'not', label: 'Bitwise NOT (one number)' },
        { value: 'nand', label: 'Bitwise NAND' },
        { value: 'nor', label: 'Bitwise NOR' },
        { value: 'xnor', label: 'Bitwise XNOR' },
        { value: 'shiftLeft', label: 'Shift left' },
        { value: 'shiftRight', label: 'Shift right (arithmetic, sign fill)' },
        { value: 'shiftRightLogical', label: 'Shift right, logical (zero fill, fixed width)' },
        { value: 'rotateLeft', label: 'Rotate left (fixed width)' },
        { value: 'rotateRight', label: 'Rotate right (fixed width)' },
        { value: 'byteSwap', label: 'Byte swap (fixed width, one number)' },
      ],
      visible: (v) => v.mode === 'calculate',
    },
    {
      name: 'width',
      label: 'Width',
      type: 'select',
      default: 'unbounded',
      options: [
        { value: 'unbounded', label: 'Unbounded (arbitrary precision)' },
        ...FIXED_WIDTHS.map((w) => ({ value: String(w), label: `${w} bits` })),
      ],
      visible: (v) => v.mode === 'calculate' && WIDTH_OPERATIONS.has(v.operation as Operation),
    },
    {
      name: 'second',
      label: 'Second number, in the same base',
      type: 'text',
      mono: true,
      default: '1',
      visible: (v) => v.mode === 'calculate' && !UNARY_OPERATIONS.has(v.operation as Operation),
    },
    { name: 'uppercase', label: 'Uppercase letters', type: 'checkbox', default: false },
    { name: 'grouped', label: 'Group digits for readability', type: 'checkbox', default: true },
    {
      name: 'customBase',
      label: 'Also show this base',
      type: 'number',
      default: 0,
      min: 0,
      max: 36,
      help: '0 to skip. Any base from 2 to 36.',
    },
  ],
  examples: [
    { label: 'Hex to decimal', values: { input: 'dead_beef', fromBase: '16' } },
    { label: 'A 256-bit value', values: { input: 'f'.repeat(64), fromBase: '16' } },
    { label: 'Negative', values: { input: '-1', fromBase: '10' } },
    { label: 'Shift', values: { mode: 'calculate', input: '1', fromBase: '10', operation: 'shiftLeft', second: '64' } },
    {
      label: 'Rotate a 32-bit value',
      values: {
        mode: 'calculate',
        input: '80000001',
        fromBase: '16',
        operation: 'rotateLeft',
        second: '1',
        width: '32',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const fromBase = Number(str(values, 'fromBase', '10'));
    const uppercase = bool(values, 'uppercase');
    const grouped = bool(values, 'grouped', true);

    try {
      const parsed = parseInBase(input, fromBase);
      let value = parsed.negative ? -parsed.value : parsed.value;
      const outputs: OutputBlock[] = [];

      if (values.mode === 'calculate') {
        const operation = str(values, 'operation', 'add') as Operation;
        const isWidthOp = WIDTH_OPERATIONS.has(operation);
        const isUnary = UNARY_OPERATIONS.has(operation);
        const widthField = str(values, 'width', 'unbounded');
        const fixedWidth = isWidthOp && widthField !== 'unbounded' ? (Number(widthField) as FixedWidth) : undefined;

        const secondParsed = isUnary ? undefined : parseInBase(str(values, 'second', '0'), fromBase);
        const second = secondParsed ? (secondParsed.negative ? -secondParsed.value : secondParsed.value) : 0n;

        if (fixedWidth !== undefined) {
          if (!fitsWidth(value, fixedWidth)) {
            outputs.push({
              kind: 'note',
              tone: 'warn',
              value: `The first number does not fit in ${fixedWidth} bits and was wrapped modulo 2^${fixedWidth}.`,
            });
          }
          if (!isUnary && BINARY_BITWISE_OPERATIONS.has(operation) && !fitsWidth(second, fixedWidth)) {
            outputs.push({
              kind: 'note',
              tone: 'warn',
              value: `The second number does not fit in ${fixedWidth} bits and was wrapped modulo 2^${fixedWidth}.`,
            });
          }
        }

        const result = calculate(value, second, operation, fixedWidth ?? 'unbounded');

        if (fixedWidth !== undefined) {
          const report = atWidth(result, fixedWidth);
          outputs.push({
            kind: 'keyvalue',
            label: `Result at ${fixedWidth} bits`,
            pairs: [
              ['In base ' + fromBase + ' (unsigned)', toBase(report.unsigned, fromBase, uppercase)],
              ['Unsigned (decimal)', report.unsigned.toString()],
              ['Signed, two complement (decimal)', report.signed.toString()],
              ['Hexadecimal', '0x' + (uppercase ? report.hex.toUpperCase() : report.hex)],
              ['Binary', grouped ? group(report.binary, 2) : report.binary],
            ],
          });
        } else {
          outputs.push({
            kind: 'keyvalue',
            label: 'Result',
            pairs: [
              ['In base ' + fromBase, toBase(result, fromBase, uppercase)],
              ['Decimal', result.toString()],
            ],
          });
        }
        value = result;
      }

      if (parsed.prefixBase !== undefined && parsed.prefixBase !== fromBase) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: `The prefix says base ${parsed.prefixBase} but you selected base ${fromBase}. The digits were read in base ${fromBase}.`,
        });
      }

      const bases =
        num(values, 'customBase', 0) >= 2 ? [2, 8, 10, 16, 36, num(values, 'customBase', 0)] : [2, 8, 10, 16, 36];
      const conversions = convertAll(
        value,
        uppercase,
        [...new Set(bases)].sort((a, b) => a - b),
      );

      outputs.push({
        kind: 'table',
        label: 'Converted',
        table: {
          headers: ['Base', 'Value', 'With prefix'],
          rows: conversions.map((c) => [
            c.label,
            grouped && (c.base === 2 || c.base === 16) ? group(c.value, c.base) : c.value,
            c.prefixed,
          ]),
          mono: [1, 2],
        },
      });

      const width = widthReport(value);
      outputs.push({
        kind: 'keyvalue',
        label: 'Size',
        pairs: [
          ['Bits needed', String(width.bits)],
          ['Bytes needed', String(width.bytes)],
          ['Smallest unsigned type', width.fitsUnsigned ? `uint${width.fitsUnsigned}` : 'none (value is negative)'],
          ['Smallest signed type', width.fitsSigned ? `int${width.fitsSigned}` : 'larger than 256 bits'],
        ],
      });

      if (width.twosComplement.length > 0) {
        outputs.push({
          kind: 'table',
          label: value < 0n ? 'Two complement representation' : 'Fixed-width representation',
          table: {
            headers: ['Width', 'Hexadecimal', 'Binary'],
            rows: width.twosComplement
              .slice(0, 4)
              .map((t) => [`${t.width}-bit`, t.hex, grouped ? group(t.binary, 2) : t.binary]),
            mono: [1, 2],
          },
        });
      }

      return { outputs };
    } catch (err) {
      if (err instanceof BaseError) return { outputs: [], errors: [{ message: err.message }] };
      throw err;
    }
  },
});
