import { meta } from '@fodt/pdf-merge';
import { PDF_MERGE_STALL_LIMIT_MS, runPdfMergeInWorker, PdfMergeRunError } from '../lib/run-pdf-merge-in-worker';
import { defineTool, files, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'pdf-merge',
  // Merging is real background work over picked files (BQ): this waits for
  // a deliberate Run press rather than starting the moment files are
  // picked, and offers a Cancel button while that work is in flight.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: PDF_MERGE_STALL_LIMIT_MS, kind: 'quiet' },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'files', label: 'PDF files', type: 'file', accept: 'application/pdf,.pdf', multiple: true },
    {
      name: 'pages',
      label: 'Pages from each file',
      type: 'textarea',
      rows: 4,
      help: 'One line per file, in the order picked, for example 1-3,5. Leave a line empty for every page.',
    },
    {
      name: 'order',
      label: 'Order',
      type: 'radio',
      default: 'as-picked',
      options: [
        { value: 'as-picked', label: 'As picked' },
        { value: 'by-name', label: 'By file name' },
      ],
    },
    { name: 'title', label: 'Title', type: 'text', placeholder: 'Optional' },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'files');
    if (picked.length === 0) return { outputs: [] };

    const pagesText = str(values, 'pages');
    const pagesLines = pagesText.split('\n');
    const pages = picked.map((_, i) => (pagesLines[i] ?? '').trim());
    const order = str(values, 'order', 'as-picked') === 'by-name' ? 'by-name' : 'as-picked';
    const title = str(values, 'title').trim();

    let result;
    try {
      result = await runPdfMergeInWorker(picked, pages, { order, ...(title ? { title } : {}) }, ctx);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof PdfMergeRunError && err.fileName !== undefined) {
        const line = picked.findIndex((f) => f.name === err.fileName) + 1;
        return {
          outputs: [],
          errors: [{ message: err.message, line: line > 0 ? line : undefined, column: err.position }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'Could not merge these PDFs.' }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Pages taken',
        table: {
          headers: ['File', 'Pages'],
          rows: result.parts.map((p) => [p.name, p.pages.join(', ')]),
        },
      },
      {
        kind: 'files',
        label: 'Merged PDF',
        files: [{ name: 'merged.pdf', mime: 'application/pdf', content: result.bytes }],
      },
    ];
    for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });

    return {
      outputs,
      stats: [
        ['Documents', String(picked.length)],
        ['Pages', String(result.pageCount)],
        ['Size', formatBytes(result.bytes.length)],
      ],
    };
  },
});
