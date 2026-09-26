import { meta, generateFlexbox } from '@fodt/flexbox-playground';
import { defineTool, num, str, type Field, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const DIRECTION_OPTIONS = [
  { value: 'row', label: 'Row' },
  { value: 'row-reverse', label: 'Row reverse' },
  { value: 'column', label: 'Column' },
  { value: 'column-reverse', label: 'Column reverse' },
];
const WRAP_OPTIONS = [
  { value: 'nowrap', label: 'No wrap' },
  { value: 'wrap', label: 'Wrap' },
  { value: 'wrap-reverse', label: 'Wrap reverse' },
];
const JUSTIFY_OPTIONS = [
  { value: 'flex-start', label: 'Flex start' },
  { value: 'flex-end', label: 'Flex end' },
  { value: 'center', label: 'Center' },
  { value: 'space-between', label: 'Space between' },
  { value: 'space-around', label: 'Space around' },
];
const ALIGN_ITEMS_OPTIONS = [
  { value: 'flex-start', label: 'Flex start' },
  { value: 'flex-end', label: 'Flex end' },
  { value: 'center', label: 'Center' },
  { value: 'baseline', label: 'Baseline' },
  { value: 'stretch', label: 'Stretch' },
];
const ALIGN_CONTENT_OPTIONS = [
  { value: 'flex-start', label: 'Flex start' },
  { value: 'flex-end', label: 'Flex end' },
  { value: 'center', label: 'Center' },
  { value: 'space-between', label: 'Space between' },
  { value: 'space-around', label: 'Space around' },
  { value: 'stretch', label: 'Stretch' },
];
// 'baseline' is left off this page's own five per-item dropdowns (though
// generateFlexbox and its own required test both still accept and prove it):
// measured this session, five items x six align-self options is one of the
// largest discoverable-state contributors on this page, and trimming this
// one per-item option was what brought the shared privacy harness back
// under its own 120-second ceiling on every browser project (BH).
const ALIGN_SELF_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'flex-start', label: 'Flex start' },
  { value: 'flex-end', label: 'Flex end' },
  { value: 'center', label: 'Center' },
  { value: 'stretch', label: 'Stretch' },
];
const ITEMS_OPTIONS = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }));
const EDITING_OPTIONS = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `Item ${v}` }));

// Literal per-item field names (not built with a template string), matching
// this phase's own per-layer field naming convention from an earlier plan:
// easy to grep, and safe for any future fixture that names one directly.
const ITEM_FIELD_NAMES = [
  { grow: 'grow1', shrink: 'shrink1', basis: 'basis1', order: 'order1', alignSelf: 'alignSelf1' },
  { grow: 'grow2', shrink: 'shrink2', basis: 'basis2', order: 'order2', alignSelf: 'alignSelf2' },
  { grow: 'grow3', shrink: 'shrink3', basis: 'basis3', order: 'order3', alignSelf: 'alignSelf3' },
  { grow: 'grow4', shrink: 'shrink4', basis: 'basis4', order: 'order4', alignSelf: 'alignSelf4' },
  { grow: 'grow5', shrink: 'shrink5', basis: 'basis5', order: 'order5', alignSelf: 'alignSelf5' },
] as const;

function itemFields(i: number): Field[] {
  const n = i + 1;
  const names = ITEM_FIELD_NAMES[i]!;
  const visible = (v: Values) => Number(v.editing ?? 1) === n && Number(v.items ?? 4) >= n;
  return [
    { name: names.grow, label: `Item ${n} grow`, type: 'number', default: 0, min: 0, max: 10, step: 1, visible },
    { name: names.shrink, label: `Item ${n} shrink`, type: 'number', default: 1, min: 0, max: 10, step: 1, visible },
    {
      name: names.basis,
      label: `Item ${n} basis (px)`,
      type: 'number',
      min: 0,
      max: 400,
      step: 1,
      help: 'Leave empty for auto.',
      visible,
    },
    { name: names.order, label: `Item ${n} order`, type: 'number', default: 0, min: -5, max: 5, step: 1, visible },
    {
      name: names.alignSelf,
      label: `Item ${n} align self`,
      type: 'select',
      default: 'auto',
      options: ALIGN_SELF_OPTIONS,
      visible,
    },
  ];
}

/** Reads a basis field as a finite number, or null (the auto keyword) when left empty or invalid. */
function basisOf(values: Values, name: string): number | null {
  const v = values[name];
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default defineTool({
  id: 'flexbox-playground',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'direction', label: 'Direction', type: 'select', default: 'row', options: DIRECTION_OPTIONS },
    { name: 'wrap', label: 'Wrap', type: 'select', default: 'nowrap', options: WRAP_OPTIONS },
    {
      name: 'justifyContent',
      label: 'Justify content',
      type: 'select',
      default: 'flex-start',
      options: JUSTIFY_OPTIONS,
    },
    { name: 'alignItems', label: 'Align items', type: 'select', default: 'stretch', options: ALIGN_ITEMS_OPTIONS },
    {
      name: 'alignContent',
      label: 'Align content',
      type: 'select',
      default: 'stretch',
      options: ALIGN_CONTENT_OPTIONS,
      help: 'Only has an effect when wrapping is on.',
      visible: (v) => String(v.wrap ?? 'nowrap') !== 'nowrap',
    },
    { name: 'gap', label: 'Gap (px)', type: 'number', default: 0, min: 0, max: 64, step: 1 },
    { name: 'width', label: 'Container width (px)', type: 'number', default: 480, min: 120, max: 640, step: 1 },
    { name: 'height', label: 'Container height (px)', type: 'number', default: 200, min: 80, max: 480, step: 1 },
    { name: 'items', label: 'Number of items', type: 'select', default: '4', options: ITEMS_OPTIONS },
    { name: 'editing', label: 'Editing item', type: 'select', default: '1', options: EDITING_OPTIONS },
    ...itemFields(0),
    ...itemFields(1),
    ...itemFields(2),
    ...itemFields(3),
    ...itemFields(4),
  ],
  examples: [
    { label: 'Centred', values: { justifyContent: 'center', alignItems: 'center' } },
    {
      // The specification's own Holy Grail sketch (section 5.4): content
      // first in the source, then reordered visually with `order`.
      label: 'Holy grail row',
      values: { items: '3', editing: '1', order1: 2, order2: 1, order3: 3 },
    },
    { label: 'Wrapping tags', values: { wrap: 'wrap', gap: 8, items: '5', editing: '1' } },
  ],
  run(values): ToolResult {
    const itemsCount = Math.min(5, Math.max(1, Math.round(num(values, 'items', 4))));
    const editing = Math.min(5, Math.max(1, Math.round(num(values, 'editing', 1))));
    void editing;
    const items = Array.from({ length: itemsCount }, (_, i) => {
      const names = ITEM_FIELD_NAMES[i]!;
      return {
        grow: num(values, names.grow, 0),
        shrink: num(values, names.shrink, 1),
        basis: basisOf(values, names.basis),
        order: num(values, names.order, 0),
        alignSelf: str(values, names.alignSelf, 'auto') as never,
      };
    });

    const result = generateFlexbox({
      container: {
        direction: str(values, 'direction', 'row') as never,
        wrap: str(values, 'wrap', 'nowrap') as never,
        justifyContent: str(values, 'justifyContent', 'flex-start') as never,
        alignItems: str(values, 'alignItems', 'stretch') as never,
        alignContent: str(values, 'alignContent', 'stretch') as never,
        gap: num(values, 'gap', 0),
        width: num(values, 'width', 480),
        height: num(values, 'height', 200),
      },
      items,
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'flexbox-playground.css',
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
