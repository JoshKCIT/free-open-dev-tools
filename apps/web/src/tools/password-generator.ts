import {
  meta,
  generate,
  PasswordGeneratorError,
  type CharacterClass,
  type Capitalisation,
  type PasswordGeneratorResult,
} from '@fodt/password-generator';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const CLASS_LABELS: Record<CharacterClass, string> = {
  lower: 'lower-case letters',
  upper: 'upper-case letters',
  digits: 'digits',
  symbols: 'symbols',
};

export default defineTool({
  id: 'password-generator',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'characters',
      options: [
        { value: 'characters', label: 'Password (characters)' },
        { value: 'passphrase', label: 'Passphrase (words)' },
      ],
    },
    {
      name: 'length',
      label: 'Length',
      type: 'number',
      default: 16,
      min: 1,
      max: 512,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'classLower',
      label: 'Lower-case letters (a-z)',
      type: 'checkbox',
      default: true,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'classUpper',
      label: 'Upper-case letters (A-Z)',
      type: 'checkbox',
      default: true,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'classDigits',
      label: 'Digits (0-9)',
      type: 'checkbox',
      default: true,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'classSymbols',
      label: 'Symbols (!@#$...)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'excludeLookAlikes',
      label: 'Exclude look-alike characters (0/O/o, 1/l/I)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'requireOneOfEach',
      label: 'Require at least one of every selected class',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'characters',
    },
    {
      name: 'words',
      label: 'Number of words',
      type: 'number',
      default: 6,
      min: 1,
      max: 20,
      visible: (v) => v.mode === 'passphrase',
    },
    { name: 'separator', label: 'Separator', type: 'text', default: '-', visible: (v) => v.mode === 'passphrase' },
    {
      name: 'capitalisation',
      label: 'Capitalisation',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'None (all lower case)' },
        { value: 'first-word', label: 'First word only' },
        { value: 'each-word', label: 'Every word' },
      ],
      visible: (v) => v.mode === 'passphrase',
    },
    { name: 'count', label: 'How many', type: 'number', default: 1, min: 1, max: 1000 },
  ],
  examples: [
    { label: '16-character password', values: { mode: 'characters', length: 16 } },
    { label: 'Six-word passphrase', values: { mode: 'passphrase', words: 6, separator: '-' } },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'characters');
    const count = Math.min(Math.max(num(values, 'count', 1), 1), 1000);

    if (mode === 'passphrase') {
      const words = Math.min(Math.max(num(values, 'words', 6), 1), 20);
      const separator = str(values, 'separator', '-');
      const capitalisation = str(values, 'capitalisation', 'none') as Capitalisation;

      let result: PasswordGeneratorResult;
      try {
        result = generate({ mode: 'passphrase', words, separator, capitalisation, count });
      } catch (err) {
        return {
          outputs: [],
          errors: [
            { message: err instanceof PasswordGeneratorError ? err.message : 'Could not generate a passphrase.' },
          ],
        };
      }

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: count === 1 ? 'Generated passphrase' : `${count} generated passphrases`,
          value: result.values.join('\n'),
        },
      ];

      return {
        outputs,
        stats: [
          ['Words', String(words)],
          [
            'Entropy',
            `${result.entropy.bits.toFixed(1)} bits (${words} x ${(result.entropy.bits / words).toFixed(2)} bits, EFF long word list)`,
          ],
          ['Source of randomness', result.source],
        ],
      };
    }

    const classes: CharacterClass[] = [];
    if (bool(values, 'classLower', true)) classes.push('lower');
    if (bool(values, 'classUpper', true)) classes.push('upper');
    if (bool(values, 'classDigits', true)) classes.push('digits');
    if (bool(values, 'classSymbols')) classes.push('symbols');

    const length = Math.min(Math.max(num(values, 'length', 16), 1), 512);
    const excludeLookAlikes = bool(values, 'excludeLookAlikes');
    const requireOneOfEach = bool(values, 'requireOneOfEach');

    let result: PasswordGeneratorResult;
    try {
      result = generate({ mode: 'characters', length, classes, excludeLookAlikes, requireOneOfEach, count });
    } catch (err) {
      return {
        outputs: [],
        errors: [{ message: err instanceof PasswordGeneratorError ? err.message : 'Could not generate a password.' }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'code',
        label: count === 1 ? 'Generated password' : `${count} generated passwords`,
        value: result.values.join('\n'),
      },
    ];

    if (requireOneOfEach) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'Requiring one character from every selected class trades a small amount of entropy for compatibility with password rules that demand it. The entropy figure below is an upper bound, not the exact figure.',
      });
    }

    return {
      outputs,
      stats: [
        ['Length', `${length} characters`],
        ['Entropy', `${result.entropy.bits.toFixed(1)} bits${result.entropy.exact ? '' : ' (upper bound)'}`],
        ['Alphabet', classes.map((c) => CLASS_LABELS[c]).join(', ') || 'none selected'],
        ['Source of randomness', result.source],
      ],
    };
  },
});
