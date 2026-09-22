import { meta, slugify, PRESETS, DEFAULT_STOP_WORDS, type NonLatinPolicy } from '@fodt/slug-generator';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'slug-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Title, one per line',
      type: 'textarea',
      rows: 7,
      placeholder: 'My First Post: Café & Crème!',
      help: 'Each line becomes its own slug, so a list of titles works.',
    },
    {
      name: 'preset',
      label: 'Preset',
      type: 'select',
      default: 'url',
      options: [
        { value: 'url', label: 'URL slug' },
        { value: 'filename', label: 'File name' },
        { value: 'branch', label: 'Git branch name' },
        { value: 'anchor', label: 'Heading anchor (keeps non-Latin)' },
        { value: 'snake', label: 'snake_case' },
        { value: 'custom', label: 'Custom, set below' },
      ],
    },
    {
      name: 'separator',
      label: 'Separator',
      type: 'text',
      default: '-',
      mono: true,
      visible: (v) => v.preset === 'custom',
    },
    { name: 'lowercase', label: 'Lowercase', type: 'checkbox', default: true, visible: (v) => v.preset === 'custom' },
    {
      name: 'nonLatin',
      label: 'Characters with no Latin equivalent',
      type: 'radio',
      default: 'strip',
      options: [
        { value: 'strip', label: 'Drop them' },
        { value: 'keep', label: 'Keep them' },
      ],
      visible: (v) => v.preset === 'custom',
    },
    {
      name: 'expandSymbols',
      label: 'Expand & to "and", % to "percent" and so on',
      type: 'checkbox',
      default: true,
      visible: (v) => v.preset === 'custom',
    },
    { name: 'maxLength', label: 'Maximum length (0 for no limit)', type: 'number', default: 0, min: 0, max: 500 },
    { name: 'removeStopWords', label: 'Remove common English words', type: 'checkbox', default: false },
  ],
  examples: [
    { label: 'Blog title', values: { input: 'My First Post: Café & Crème!' } },
    { label: 'Accents', values: { input: 'Straße\nŁódź\nĐà Nẵng\nÆrøskøbing' } },
    { label: 'Non-Latin', values: { input: 'Привет мир\n日本語のテスト', preset: 'anchor' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const preset = str(values, 'preset', 'url');
    const base =
      preset === 'custom'
        ? {
            separator: str(values, 'separator', '-'),
            lowercase: bool(values, 'lowercase', true),
            nonLatin: str(values, 'nonLatin', 'strip') as NonLatinPolicy,
            expandSymbols: bool(values, 'expandSymbols', true),
          }
        : (PRESETS[preset] ?? PRESETS.url!);

    const options = {
      ...base,
      ...(num(values, 'maxLength', 0) > 0 ? { maxLength: num(values, 'maxLength', 0) } : {}),
      ...(bool(values, 'removeStopWords') ? { stopWords: DEFAULT_STOP_WORDS } : {}),
    };

    const lines = input.split('\n').filter((l) => l.trim() !== '');
    const results = lines.map((line) => ({ line, result: slugify(line, options) }));

    const outputs: OutputBlock[] = [
      {
        kind: 'code',
        label: results.length === 1 ? 'Slug' : `${results.length} slugs`,
        value: results.map((r) => r.result.slug).join('\n'),
        download: 'slugs.txt',
      },
    ];

    if (results.length > 1) {
      outputs.push({
        kind: 'table',
        label: 'Each title and its slug',
        table: {
          headers: ['Title', 'Slug', 'Length'],
          rows: results.map((r) => [r.line, r.result.slug, r.result.length]),
          mono: [1],
        },
      });
    }

    const dropped = [...new Set(results.flatMap((r) => r.result.droppedCharacters))];
    if (dropped.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `These characters were dropped because there is no Latin equivalent: ${dropped.join(' ')}. Switch to keeping non-Latin characters if you want them in the slug.`,
      });
    }

    if (results.some((r) => r.result.truncated)) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: 'One or more slugs were shortened at a word boundary to fit the length limit.',
      });
    }

    const nonAscii = results.filter((r) => !r.result.ascii);
    if (nonAscii.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'Some slugs contain characters outside ASCII. Modern browsers and servers handle these, but they have to be percent-encoded in some contexts and older systems may mangle them.',
      });
    }

    const empty = results.filter((r) => r.result.slug === '');
    if (empty.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `${empty.length} title${empty.length === 1 ? '' : 's'} produced an empty slug, because nothing survived. You will need to supply one by hand.`,
      });
    }

    const duplicates = results.map((r) => r.result.slug).filter((s, i, all) => s !== '' && all.indexOf(s) !== i);
    if (duplicates.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `These slugs are not unique: ${[...new Set(duplicates)].join(', ')}. Different titles can produce the same slug.`,
      });
    }

    return { outputs, stats: [['Titles', String(results.length)]] };
  },
});
