import { meta, classesToCss, cssToClasses, TAILWIND_VERSION } from '@fodt/tailwind-css';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'tailwind-css',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'classes-to-css',
      options: [
        { value: 'classes-to-css', label: 'Classes to CSS' },
        { value: 'css-to-classes', label: 'CSS to classes' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'output',
      label: 'Output form',
      type: 'select',
      default: 'per-class',
      options: [
        { value: 'per-class', label: 'One rule per class' },
        { value: 'combined', label: 'Combined into one rule' },
      ],
      visible: (values) => str(values, 'direction', 'classes-to-css') === 'classes-to-css',
    },
    {
      name: 'remIs16px',
      label: 'Treat 1rem as 16px',
      type: 'checkbox',
      default: true,
      help: 'Matches a px length that is an exact multiple of 4 to the equivalent rem-based class.',
      visible: (values) => str(values, 'direction', 'classes-to-css') === 'css-to-classes',
    },
  ],
  examples: [
    { label: 'Classes to CSS', values: { direction: 'classes-to-css', input: 'p-4 text-sm bg-red-500/50' } },
    {
      label: 'CSS to classes',
      values: { direction: 'css-to-classes', input: 'padding: 1rem;\nfont-size: 0.875rem;' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const direction = str(values, 'direction', 'classes-to-css');

    if (direction === 'classes-to-css') {
      const output = str(values, 'output', 'per-class') as 'per-class' | 'combined';
      const result = classesToCss(input, { output });
      const outputs: OutputBlock[] = [];
      if (result.css !== '') outputs.push({ kind: 'code', label: 'Output', language: 'css', value: result.css });
      if (result.unknown.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Not converted',
          table: {
            headers: ['Class'],
            rows: result.unknown.map((c) => [c]),
            mono: [0],
          },
        });
        outputs.push({
          kind: 'note',
          label: 'Notes',
          tone: 'info',
          value: 'Variants, arbitrary values, plugins and user configuration are not converted.',
        });
      }
      return {
        outputs,
        stats: [
          ['Converted', String(result.converted.length)],
          ['Not converted', String(result.unknown.length)],
          ['Tailwind', TAILWIND_VERSION],
        ],
      };
    }

    const remIs16px = bool(values, 'remIs16px', true);
    const result = cssToClasses(input, { remIs16px });
    const outputs: OutputBlock[] = [];
    if (result.classes !== '')
      outputs.push({ kind: 'code', label: 'Classes', language: 'text', value: result.classes });
    if (result.unmatched.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Unmatched declarations',
        table: {
          headers: ['Property', 'Value'],
          rows: result.unmatched.map((d) => [d.property, d.value]),
          mono: [0, 1],
        },
      });
    }
    if (result.warnings.length > 0) {
      outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
    }
    const convertedCount = result.rules.reduce((sum, r) => sum + r.classes.length, 0);
    const unmatchedCount = result.rules.reduce((sum, r) => sum + r.unmatched.length, 0);
    return {
      outputs,
      stats: [
        ['Converted', String(convertedCount)],
        ['Not converted', String(unmatchedCount)],
        ['Tailwind', TAILWIND_VERSION],
      ],
    };
  },
});
