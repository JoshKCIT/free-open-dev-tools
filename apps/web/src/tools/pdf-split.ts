import { meta } from '@fodt/pdf-split';
import type { OrganizeOperation } from '@fodt/pdf-split';
import { runPdfSplitInWorker, PdfSplitRunError } from '../lib/run-pdf-split-in-worker';
import { defineTool, files, str, num, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

function isOperation(values: Values, kind: string): boolean {
  return str(values, 'operation', 'split-each') === kind;
}

function toOperation(values: Values): OrganizeOperation {
  const kind = str(values, 'operation', 'split-each');
  if (kind === 'split-ranges') return { kind: 'split-ranges', ranges: str(values, 'ranges') };
  if (kind === 'extract') return { kind: 'extract', pages: str(values, 'pages') };
  if (kind === 'delete') return { kind: 'delete', pages: str(values, 'pages') };
  if (kind === 'reorder') return { kind: 'reorder', order: str(values, 'order') };
  if (kind === 'rotate') {
    const degreesValue = num(values, 'degrees', 90);
    const degrees: 90 | 180 | 270 = degreesValue === 180 ? 180 : degreesValue === 270 ? 270 : 90;
    return { kind: 'rotate', pages: str(values, 'pages'), degrees };
  }
  return { kind: 'split-each' };
}

export default defineTool({
  id: 'pdf-split',
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'file', label: 'PDF file', type: 'file', accept: 'application/pdf,.pdf' },
    {
      name: 'operation',
      label: 'Operation',
      type: 'radio',
      default: 'split-each',
      options: [
        { value: 'split-each', label: 'Split every page' },
        { value: 'split-ranges', label: 'Split by ranges' },
        { value: 'extract', label: 'Extract' },
        { value: 'delete', label: 'Delete' },
        { value: 'reorder', label: 'Reorder' },
        { value: 'rotate', label: 'Rotate' },
      ],
    },
    {
      name: 'ranges',
      label: 'Ranges',
      type: 'text',
      placeholder: '1-2;3',
      help: 'Semicolon-separated page lists, one output document per list, for example 1-2;3.',
      visible: (v) => isOperation(v, 'split-ranges'),
    },
    {
      name: 'pages',
      label: 'Pages',
      type: 'text',
      placeholder: '1-3,5',
      help: 'A page list such as 1-3,5. For Rotate, leave empty to rotate every page.',
      visible: (v) => isOperation(v, 'extract') || isOperation(v, 'delete') || isOperation(v, 'rotate'),
    },
    {
      name: 'order',
      label: 'New order',
      type: 'text',
      placeholder: '3,1,2',
      help: 'Every page named exactly once, in the new order, for example 3,1,2.',
      visible: (v) => isOperation(v, 'reorder'),
    },
    {
      name: 'degrees',
      label: 'Rotate by',
      type: 'select',
      default: '90',
      options: [
        { value: '90', label: '90 degrees' },
        { value: '180', label: '180 degrees' },
        { value: '270', label: '270 degrees' },
      ],
      visible: (v) => isOperation(v, 'rotate'),
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;
    const operation = toOperation(values);

    let result;
    try {
      result = await runPdfSplitInWorker(file, operation, ctx);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof PdfSplitRunError) {
        return { outputs: [], errors: [{ message: err.message, line: 1, column: err.position }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : `Could not organise '${file.name}'.` }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Documents',
        table: { headers: ['File', 'Pages'], rows: result.files.map((f) => [f.name, f.pages.join(', ')]) },
      },
      {
        kind: 'files',
        label: 'Output',
        files: result.files.map((f) => ({ name: f.name, mime: 'application/pdf', content: f.bytes })),
      },
    ];
    for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });

    return {
      outputs,
      stats: [
        ['Source pages', String(result.sourcePageCount)],
        ['Documents written', String(result.files.length)],
      ],
    };
  },
});
