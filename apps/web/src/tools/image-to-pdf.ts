import { meta } from '@fodt/image-to-pdf';
import { IMAGE_TO_PDF_STALL_LIMIT_MS, runImageToPdfInWorker } from '../lib/run-image-to-pdf-in-worker';
import { defineTool, files, str, num, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'image-to-pdf',
  autoRun: false,
  cancellable: true,
  runLimit: { ms: IMAGE_TO_PDF_STALL_LIMIT_MS, kind: 'quiet' },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'files',
      label: 'Images',
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
      multiple: true,
    },
    {
      name: 'pageSize',
      label: 'Page size',
      type: 'select',
      default: 'a4',
      options: [
        { value: 'a4', label: 'A4' },
        { value: 'a3', label: 'A3' },
        { value: 'a5', label: 'A5' },
        { value: 'letter', label: 'US Letter' },
        { value: 'legal', label: 'Legal' },
        { value: 'fit', label: 'Fit to image' },
      ],
    },
    {
      name: 'orientation',
      label: 'Orientation',
      type: 'radio',
      default: 'auto',
      options: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
        { value: 'auto', label: 'Automatic' },
      ],
    },
    { name: 'margin', label: 'Margin (mm)', type: 'number', default: 10, min: 0, max: 50, step: 1 },
    {
      name: 'fit',
      label: 'Fit',
      type: 'radio',
      default: 'contain',
      options: [
        { value: 'contain', label: 'Fit inside the margins' },
        { value: 'actual', label: 'Actual size' },
      ],
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

    const pageSize = str(values, 'pageSize', 'a4') as 'a3' | 'a4' | 'a5' | 'letter' | 'legal' | 'fit';
    const orientation = str(values, 'orientation', 'auto') as 'portrait' | 'landscape' | 'auto';
    const fit = str(values, 'fit', 'contain') === 'actual' ? 'actual' : 'contain';
    const order = str(values, 'order', 'as-picked') === 'by-name' ? 'by-name' : 'as-picked';
    const marginMm = num(values, 'margin', 10);
    const title = str(values, 'title').trim();

    let result;
    try {
      result = await runImageToPdfInWorker(
        picked,
        { pageSize, orientation, marginMm, fit, order, ...(title ? { title } : {}) },
        ctx,
      );
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'Could not place these images into a PDF.' }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'table',
        label: 'Pages',
        table: {
          headers: ['Image', 'Page size (pt)', 'Placed at', 'Note'],
          rows: result.pages.map((p) => [p.name, `${p.pageWidth} × ${p.pageHeight}`, p.placedAt, p.note ?? '']),
        },
      },
      { kind: 'files', label: 'PDF', files: [{ name: 'images.pdf', mime: 'application/pdf', content: result.bytes }] },
    ];
    for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });

    return {
      outputs,
      stats: [
        ['Images', String(picked.length)],
        ['Pages', String(result.pages.length)],
        ['Size', formatBytes(result.bytes.length)],
      ],
    };
  },
});
