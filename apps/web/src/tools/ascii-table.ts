import { meta, filterRows } from '@fodt/ascii-table';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ascii-table',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'filter',
      label: 'Filter',
      type: 'text',
      placeholder: 'A number (0x41, 65, 0o101, 0b1000001), a character, or a control name',
      help: 'Leave empty to see every row.',
    },
  ],
  examples: [
    { label: 'Find the letter A', values: { filter: '0x41' } },
    { label: 'Find a control code', values: { filter: 'BEL' } },
  ],
  run(values): ToolResult {
    const filter = str(values, 'filter');
    const rows = filterRows(filter);

    const outputs: OutputBlock[] = [];
    if (rows.length === 0) {
      outputs.push({ kind: 'note', tone: 'info', value: 'No ASCII code matches that filter.' });
      return { outputs };
    }

    outputs.push({
      kind: 'table',
      label: 'ASCII table',
      table: {
        headers: ['Dec', 'Hex', 'Oct', 'Bin', 'Char', 'Name'],
        rows: rows.map((row) => [row.dec, row.hex, row.oct, row.bin, row.char, row.name ?? '']),
        mono: [0, 1, 2, 3, 4],
      },
    });

    return { outputs };
  },
});
