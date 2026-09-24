import { meta, isValid, checkDigit, identify, LuhnError } from '@fodt/luhn';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'luhn',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'check',
      options: [
        { value: 'check', label: 'Check a number' },
        { value: 'checkDigit', label: 'Compute a check digit' },
      ],
    },
    {
      name: 'input',
      label: 'Number',
      type: 'text',
      mono: true,
      default: '79927398713',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Spaces and hyphens are accepted and stripped before checking.',
    },
  ],
  examples: [
    { label: 'Check a valid number', values: { mode: 'check', input: '79927398713' } },
    { label: 'Compute a check digit', values: { mode: 'checkDigit', input: '789372997' } },
    { label: 'A Visa test number', values: { mode: 'check', input: '4242424242424242' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };
    const mode = str(values, 'mode', 'check');

    try {
      const cleanedDigitCount = input.replace(/[^0-9]/g, '').length;
      const strippedCount = input.trim().length - cleanedDigitCount;

      if (mode === 'checkDigit') {
        const digit = checkDigit(input);
        const full = input.replace(/[^0-9]/g, '') + digit;
        return {
          outputs: [
            { kind: 'code', label: 'Check digit', value: digit },
            { kind: 'code', label: 'Full number', value: full },
          ],
          stats: [
            ['Digit count', String(cleanedDigitCount)],
            ['Separators stripped', String(strippedCount)],
          ],
        };
      }

      const valid = isValid(input);
      const matches = identify(input);
      const outputs: OutputBlock[] = [
        {
          kind: 'note',
          tone: valid ? 'success' : 'error',
          value: valid
            ? 'Passes the Luhn check. This means the digits are internally consistent -- it does not mean the number is real, active or usable.'
            : 'Fails the Luhn check.',
        },
        {
          kind: 'keyvalue',
          label: 'Detail',
          pairs: [
            ['Digit count', String(cleanedDigitCount)],
            ['Verdict', valid ? 'valid' : 'invalid'],
          ],
        },
      ];

      if (matches.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Matched issuer patterns',
          table: {
            headers: ['Issuer'],
            rows: matches.map((m) => [m.label]),
          },
        });
      }

      return {
        outputs,
        stats: [
          ['Digit count', String(cleanedDigitCount)],
          ['Separators stripped', String(strippedCount)],
        ],
      };
    } catch (err) {
      if (err instanceof LuhnError) {
        return {
          outputs: [],
          errors: [
            {
              message: err.message,
              line: err.position === undefined ? undefined : 1,
              column: err.position === undefined ? undefined : err.position + 1,
            },
          ],
        };
      }
      throw err;
    }
  },
});
