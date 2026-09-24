import { meta, searchStatusCodes } from '@fodt/http-status-codes';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'http-status-codes',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'query',
      label: 'Search',
      type: 'text',
      placeholder: 'A code (451), a class (4xx or 4), an RFC number (7725 or rfc 7725), or a phrase',
    },
  ],
  examples: [
    { label: 'A code', values: { query: '451' } },
    { label: 'A class', values: { query: '4xx' } },
    { label: 'An RFC number', values: { query: 'rfc 9110' } },
  ],
  run(values): ToolResult {
    const query = str(values, 'query');
    if (!query.trim()) return { outputs: [] };
    const { rows, note } = searchStatusCodes(query);

    const outputs: OutputBlock[] = [];

    if (rows.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Status codes',
        table: {
          headers: ['Code', 'Reason phrase', 'Class', 'Defined in', 'Status'],
          rows: rows.map((r) => [
            r.code,
            r.phrase,
            r.statusClass,
            r.definedIn.map((d) => d.label).join(', ') || '—',
            r.statusLabel,
          ]),
          mono: [0, 2],
        },
      });
    }

    if (note) {
      outputs.push({ kind: 'note', tone: rows.length === 0 ? 'warn' : 'info', value: note });
    }

    return { outputs, stats: [['Results', String(rows.length)]] };
  },
});
