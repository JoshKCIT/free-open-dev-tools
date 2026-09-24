import { meta, inspectFloat, Ieee754Error, type FloatFormat, type InputMode, type FloatReport } from '@fodt/ieee754';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

function specialCaseText(report: FloatReport): string {
  switch (report.label) {
    case 'positive infinity':
      return '+Infinity';
    case 'negative infinity':
      return '-Infinity';
    case 'quiet NaN':
      return 'NaN (quiet)';
    case 'signalling NaN':
      return 'NaN (signalling)';
    case 'subnormal':
      return 'subnormal';
    case 'negative zero':
      return '-0';
    default:
      return 'none';
  }
}

export default defineTool({
  id: 'ieee754',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'binary32',
      options: [
        { value: 'binary32', label: 'binary32 (single precision)' },
        { value: 'binary64', label: 'binary64 (double precision)' },
      ],
    },
    {
      name: 'mode',
      label: 'Interpret the input as',
      type: 'radio',
      default: 'value',
      options: [
        { value: 'value', label: 'A decimal value' },
        { value: 'bits', label: 'A hexadecimal bit pattern' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'text',
      mono: true,
      default: '3.14',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A decimal value such as 3.14, or a hexadecimal bit pattern such as 40490fdb, with or without a 0x prefix.',
    },
  ],
  examples: [
    { label: 'Ordinary value, binary32', values: { format: 'binary32', mode: 'value', input: '3.14' } },
    { label: 'Signalling NaN, binary32', values: { format: 'binary32', mode: 'bits', input: '7f800001' } },
    { label: 'Negative zero, binary64', values: { format: 'binary64', mode: 'value', input: '-0' } },
    {
      label: 'Smallest positive binary32 subnormal',
      values: { format: 'binary32', mode: 'bits', input: '00000001' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const format = str(values, 'format', 'binary32') as FloatFormat;
    const mode = str(values, 'mode', 'value') as InputMode;

    try {
      const report = inspectFloat(input, format, mode);
      const bitWidth = report.bits.length;

      return {
        outputs: [
          {
            kind: 'keyvalue',
            label: 'Value',
            pairs: [
              ['Decoded', report.decodedValue],
              ['Format', format === 'binary32' ? 'binary32 (single precision)' : 'binary64 (double precision)'],
              ['Special case', specialCaseText(report)],
            ],
          },
          {
            kind: 'table',
            label: 'Bit layout',
            table: {
              headers: ['Field', 'Width', 'Bits', 'Decimal'],
              rows: [
                ['Sign', '1 bit', report.signBit, report.signBit === '1' ? 'negative' : 'positive'],
                [
                  'Exponent',
                  `${report.exponentField.length} bits`,
                  report.exponentField,
                  `${report.biasedExponent} (biased)`,
                ],
                ['Mantissa', `${report.mantissaField.length} bits`, report.mantissaField, report.mantissa.toString()],
              ],
              mono: [2],
            },
          },
          {
            kind: 'code',
            label: `Raw ${bitWidth} bits`,
            value: `${report.signBit} ${report.exponentField} ${report.mantissaField}`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof Ieee754Error) {
        return { outputs: [], errors: [{ message: err.message, line: 1, column: 1 }] };
      }
      throw err;
    }
  },
});
