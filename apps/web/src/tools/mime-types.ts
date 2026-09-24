import { meta, lookup, citationFor } from '@fodt/mime-types';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'mime-types',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'query',
      label: 'Extension, filename or media type',
      type: 'text',
      default: 'json',
      placeholder: 'json, .json, report.JSON, or application/json',
    },
  ],
  examples: [
    { label: 'Extension', values: { query: 'png' } },
    { label: 'Filename', values: { query: 'photo.PNG' } },
    { label: 'Media type', values: { query: 'application/json' } },
  ],
  run(values): ToolResult {
    const query = str(values, 'query');
    if (!query.trim()) return { outputs: [] };

    const { rows } = lookup(query);
    const outputs: OutputBlock[] = [];

    if (rows.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Media types',
        table: {
          headers: ['Media type', 'Extensions', 'Source', 'Charset', 'Compressible'],
          rows: rows.map((r) => [
            r.type,
            r.extensions.length > 0 ? r.extensions.join(', ') : '—',
            citationFor(r).label,
            r.charset ?? '—',
            r.compressible === undefined ? 'unknown' : r.compressible ? 'yes' : 'no',
          ]),
          mono: [0, 1],
        },
      });
    } else {
      outputs.push({ kind: 'note', tone: 'warn', value: `"${query}" was not found in the bundled mime-db table.` });
    }

    return { outputs, stats: [['Results', String(rows.length)]] };
  },
});
