import { meta, checkContrast } from '@fodt/contrast-checker';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'contrast-checker',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'foreground',
      label: 'Foreground colour',
      type: 'text',
      default: '#1f2937',
      placeholder: '#1f2937, rgb(31 41 55), hsl(215 25% 17%)',
    },
    {
      name: 'background',
      label: 'Background colour',
      type: 'text',
      default: '#ffffff',
      placeholder: '#ffffff, white, rgb(255 255 255)',
    },
  ],
  examples: [
    { label: 'Default pair', values: { foreground: '#1f2937', background: '#ffffff' } },
    { label: 'Swap', values: { foreground: '#ffffff', background: '#1f2937' } },
    { label: 'Low contrast pair', values: { foreground: '#777777', background: '#888888' } },
  ],
  run(values): ToolResult {
    const foreground = str(values, 'foreground', '#1f2937');
    const background = str(values, 'background', '#ffffff');
    const result = checkContrast(foreground, background);

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'contrast.css',
      },
      {
        kind: 'keyvalue',
        label: 'WCAG 2.2 contrast ratio',
        pairs: [['Ratio', `${result.wcag.ratio.toFixed(2)}:1`]],
      },
      {
        kind: 'table',
        label: 'WCAG 2.2',
        table: {
          headers: ['Criterion', 'Applies to', 'Needs', 'Result'],
          rows: result.wcag.results.map((r) => [r.criterion, r.appliesTo, `${r.needs}:1`, r.result]),
        },
      },
      {
        kind: 'keyvalue',
        label: result.apca.label,
        pairs: [
          ['Lc', result.apca.lc.toFixed(2)],
          ['Version', result.apca.version],
        ],
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
