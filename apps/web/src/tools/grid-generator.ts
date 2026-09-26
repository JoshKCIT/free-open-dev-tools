import { meta, generateGrid } from '@fodt/grid-generator';
import { defineTool, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const SELF_POSITION_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
  { value: 'center', label: 'Center' },
  { value: 'stretch', label: 'Stretch' },
];

export default defineTool({
  id: 'grid-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'columns',
      label: 'Columns',
      type: 'text',
      default: '1fr 2fr 1fr',
      help: 'A CSS Grid track list, e.g. "1fr 2fr 100px" or "repeat(3, 1fr)".',
    },
    { name: 'rows', label: 'Rows', type: 'text', default: 'auto 1fr auto' },
    {
      name: 'areas',
      label: 'Named areas',
      type: 'textarea',
      rows: 4,
      placeholder: 'header header\nsidebar main\nfooter footer',
      help: 'One row per line, cell names separated by spaces; a dot is a blank cell. Leave empty for auto-placed items.',
    },
    {
      name: 'itemCount',
      label: 'Item count',
      type: 'number',
      default: 3,
      min: 1,
      max: 12,
      step: 1,
      visible: (v) => String(v.areas ?? '').trim().length === 0,
    },
    { name: 'columnGap', label: 'Column gap (px)', type: 'number', default: 8, min: 0, max: 64, step: 1 },
    { name: 'rowGap', label: 'Row gap (px)', type: 'number', default: 8, min: 0, max: 64, step: 1 },
    { name: 'justifyItems', label: 'Justify items', type: 'select', default: 'normal', options: SELF_POSITION_OPTIONS },
    { name: 'alignItems', label: 'Align items', type: 'select', default: 'normal', options: SELF_POSITION_OPTIONS },
    { name: 'width', label: 'Container width (px)', type: 'number', default: 400, min: 160, max: 720, step: 1 },
    { name: 'height', label: 'Container height (px)', type: 'number', default: 280, min: 120, max: 480, step: 1 },
  ],
  examples: [
    {
      label: 'Page layout',
      values: {
        columns: '160px 1fr',
        rows: 'auto 1fr auto',
        areas: 'header header\nsidebar main\nfooter footer',
      },
    },
    { label: 'Card grid', values: { columns: 'repeat(3, 1fr)', rows: 'repeat(2, 1fr)', areas: '', itemCount: 6 } },
    {
      label: 'Magazine',
      values: {
        columns: '1fr 1fr 1fr 1fr',
        rows: 'auto auto',
        areas: 'lead lead sidebar sidebar\nstory1 story2 story2 story3',
      },
    },
  ],
  run(values): ToolResult {
    const result = generateGrid({
      columns: str(values, 'columns', '1fr 2fr 1fr'),
      rows: str(values, 'rows', 'auto 1fr auto'),
      areas: str(values, 'areas', ''),
      itemCount: num(values, 'itemCount', 3),
      columnGap: num(values, 'columnGap', 0),
      rowGap: num(values, 'rowGap', 0),
      justifyItems: str(values, 'justifyItems', 'normal') as never,
      alignItems: str(values, 'alignItems', 'normal') as never,
      width: num(values, 'width', 400),
      height: num(values, 'height', 280),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'grid-generator.css',
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
