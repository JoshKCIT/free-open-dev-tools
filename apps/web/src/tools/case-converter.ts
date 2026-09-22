import { meta, convertLines, convertAll, splitWords, CASES, type CaseName } from '@fodt/case-converter';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'case-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Text or identifier',
      type: 'textarea',
      rows: 6,
      placeholder: 'XMLHttpRequest handler\nuser_first_name',
      help: 'Each line is converted on its own, so a pasted list works.',
    },
    {
      name: 'target',
      label: 'Convert to',
      type: 'select',
      default: 'snake',
      options: CASES.map((c) => ({ value: c.id, label: `${c.label} — ${c.example}` })),
    },
    {
      name: 'splitOnNumbers',
      label: 'Treat a run of digits as its own word (utf_8 rather than utf8)',
      type: 'checkbox',
      default: false,
    },
    {
      name: 'locale',
      label: 'Locale for case mapping',
      type: 'select',
      default: '',
      options: [
        { value: '', label: 'Default (invariant)' },
        { value: 'tr', label: 'Turkish — i maps to İ' },
        { value: 'az', label: 'Azerbaijani' },
        { value: 'lt', label: 'Lithuanian' },
        { value: 'de', label: 'German' },
      ],
      help: 'Only matters for a handful of languages, but it matters a lot there.',
    },
  ],
  examples: [
    { label: 'Acronym', values: { input: 'XMLHttpRequest', target: 'snake' } },
    { label: 'List of fields', values: { input: 'first_name\nlast_name\nemail_address', target: 'camel' } },
    { label: 'Title', values: { input: 'the name of the wind', target: 'titleAp' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const options = {
      splitOnNumbers: bool(values, 'splitOnNumbers'),
      ...(str(values, 'locale') ? { locale: str(values, 'locale') } : {}),
    };
    const target = str(values, 'target', 'snake') as CaseName;
    const output = convertLines(input, target, options);

    const firstLine = input.split('\n').find((l) => l.trim() !== '') ?? '';
    const words = splitWords(firstLine, options);
    const all = convertAll(firstLine, options);

    return {
      outputs: [
        {
          kind: 'code',
          label: CASES.find((c) => c.id === target)?.label ?? target,
          value: output,
          download: 'converted.txt',
        },
        {
          kind: 'keyvalue',
          label: 'How the first line was split into words',
          pairs: [['Words', words.length ? words.join(' | ') : '(none found)']],
        },
        {
          kind: 'table',
          label: 'Every case, for the first line',
          table: { headers: ['Case', 'Result'], rows: all.map((r) => [r.label, r.output]), mono: [1] },
        },
      ],
      stats: [['Lines', String(input.split('\n').filter((l) => l.trim() !== '').length)]],
    };
  },
});
