import { composeGitignore, listTemplates, meta } from '@fodt/gitignore-generator';
import { bool, defineTool, str, type ToolResult } from '../lib/tool-ui';

function splitNames(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export default defineTool({
  id: 'gitignore-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'templates',
      label: 'Templates',
      type: 'textarea',
      rows: 4,
      placeholder: 'Node, Python, macOS, VisualStudioCode',
    },
    {
      name: 'extra',
      label: 'Extra lines',
      type: 'textarea',
      rows: 4,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'header',
      label: 'Add a header comment naming the source commit and licence',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [{ label: 'Node, Python and macOS', values: { templates: 'Node, Python, macOS', header: true } }],
  run(values): ToolResult {
    const templatesText = str(values, 'templates');
    const names = splitNames(templatesText);
    const extra = str(values, 'extra');
    const header = bool(values, 'header', true);

    if (names.length === 0) {
      const available = listTemplates();
      return {
        outputs: [
          {
            kind: 'list',
            label: 'Available templates',
            items: available.map((t) => `${t.name} (${t.folder})`),
          },
        ],
      };
    }

    const result = composeGitignore({ templates: names, extra, header });

    const outputs: ToolResult['outputs'] = [
      { kind: 'code', label: '.gitignore', language: 'text', value: result.output, download: '.gitignore' },
    ];

    if (result.used.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Templates used',
        table: {
          headers: ['Template', 'Folder', 'Lines'],
          rows: result.used.map((u) => [u.name, u.folder, u.lines]),
        },
      });
    }

    if (result.unknown.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: result.unknown
          .map((u) =>
            u.suggestions.length > 0
              ? `"${u.name}" is not a known template. Did you mean: ${u.suggestions.join(', ')}?`
              : `"${u.name}" is not a known template.`,
          )
          .join(' '),
      });
    }

    return {
      outputs,
      stats: [
        ['Templates used', String(result.used.length)],
        ['Unknown names', String(result.unknown.length)],
      ],
    };
  },
});
