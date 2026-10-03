import {
  meta,
  isValid,
  checkDigit,
  identify,
  LuhnError,
  validateScheme,
  computeScheme,
  CheckDigitError,
  SCHEMES,
  type Scheme,
} from '@fodt/luhn';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the check part of a scheme is called in a sentence; every scheme not listed has a check digit. */
const CHECK_NAME: ReadonlyMap<string, string> = new Map([
  ['iban', 'check digits'],
  ['vin', 'check character'],
]);

/**
 * The number the Number box starts with. Choosing another scheme does not clear the box (a page cannot change one field
 * when another changes), so an error for a number that is still this sample says where it came from.
 */
const LUHN_SAMPLE = '79927398713';

/** The check digit pages for every scheme except Luhn. The Luhn path stays in run() exactly as it was. */
function runScheme(scheme: string, mode: string, input: string): ToolResult {
  try {
    const label = SCHEMES.get(scheme as Scheme)?.label ?? scheme;
    const word = CHECK_NAME.get(scheme) ?? 'check digit';
    if (mode === 'checkDigit') {
      const computed = computeScheme(scheme, input);
      const outputs: OutputBlock[] = [
        { kind: 'code', label: word[0]!.toUpperCase() + word.slice(1), value: computed.checkDigit },
        { kind: 'code', label: 'Full number', value: computed.full },
        { kind: 'keyvalue', label: 'Detail', pairs: computed.details },
      ];
      for (const note of computed.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
      return { outputs, stats: [['Characters', String(computed.full.length)]] };
    }
    const result = validateScheme(scheme, input);
    const outputs: OutputBlock[] = [
      {
        kind: 'note',
        tone: result.valid ? 'success' : 'error',
        value: result.valid
          ? `Valid ${label}.`
          : `Not valid: the ${word} should be ${result.expected}, not ${result.checkDigit}.`,
      },
      {
        kind: 'keyvalue',
        label: 'Detail',
        pairs: [...result.details, ['Verdict', result.valid ? 'valid' : 'invalid']],
      },
    ];
    for (const note of result.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
    return { outputs, stats: [['Characters', String(result.normalised.length)]] };
  } catch (err) {
    if (err instanceof CheckDigitError) {
      return {
        outputs: [],
        errors: [
          {
            message:
              input.trim() === LUHN_SAMPLE
                ? `${err.message} The Number box still holds the Luhn sample, ${LUHN_SAMPLE}: type a number for this scheme, or pick one of the examples.`
                : err.message,
            line: err.position === undefined ? undefined : 1,
            column: err.position === undefined ? undefined : err.position + 1,
          },
        ],
      };
    }
    throw err;
  }
}

export default defineTool({
  id: 'luhn',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'scheme',
      label: 'Scheme',
      type: 'select',
      default: 'luhn',
      help: 'Luhn is the original check. To compute a check digit, leave it off: 9 digits for ISBN-10, 12 for ISBN-13 or EAN-13, 7 for EAN-8, 11 for UPC-A, 11 characters for ISIN, 16 or 17 for VIN, and for IBAN the country code and the account part.',
      options: [
        { value: 'luhn', label: 'Luhn (card numbers and other identifiers)' },
        { value: 'isbn10', label: 'ISBN-10' },
        { value: 'isbn13', label: 'ISBN-13' },
        { value: 'ean8', label: 'EAN-8' },
        { value: 'ean13', label: 'EAN-13' },
        { value: 'upca', label: 'UPC-A' },
        { value: 'iban', label: 'IBAN (bank account number)' },
        { value: 'vin', label: 'VIN (vehicle identification number)' },
        { value: 'isin', label: 'ISIN (security identifier)' },
      ],
    },
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
      default: LUHN_SAMPLE,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Spaces and hyphens are accepted and stripped before checking.',
    },
  ],
  examples: [
    { label: 'Check a valid number', values: { mode: 'check', input: '79927398713' } },
    { label: 'Compute a check digit', values: { mode: 'checkDigit', input: '789372997' } },
    { label: 'A Visa test number', values: { mode: 'check', input: '4242424242424242' } },
    { label: 'An ISBN-13', values: { scheme: 'isbn13', mode: 'check', input: '978-0-11-000222-4' } },
    { label: 'An IBAN', values: { scheme: 'iban', mode: 'check', input: 'GB82 WEST 1234 5698 7654 32' } },
    { label: 'A VIN', values: { scheme: 'vin', mode: 'check', input: '1M8GDM9AXKP042788' } },
    { label: 'An ISIN', values: { scheme: 'isin', mode: 'check', input: 'US0378331005' } },
    { label: 'IBAN check digits', values: { scheme: 'iban', mode: 'checkDigit', input: 'GB WEST 1234 5698 7654 32' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };
    const mode = str(values, 'mode', 'check');
    const scheme = str(values, 'scheme', 'luhn');
    if (scheme !== 'luhn') return runScheme(scheme, mode, input);

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
