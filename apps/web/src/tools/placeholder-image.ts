import { meta, generatePlaceholder, MAX_PNG_SIDE, type Pattern } from '@fodt/placeholder-image';
import { drawPlaceholderPng } from '../lib/draw-placeholder-png';
import { defineTool, num, str, type Field, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const FONT_FAMILY_OPTIONS: Field['options'] = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'cursive', label: 'Cursive' },
  { value: 'fantasy', label: 'Fantasy' },
];

const PATTERN_OPTIONS: Field['options'] = [
  { value: 'none', label: 'None' },
  { value: 'cross', label: 'Cross' },
  { value: 'grid', label: 'Grid' },
];

export default defineTool({
  id: 'placeholder-image',
  // Deterministic and cheap: reruns as the visitor types, same as
  // every other tool in this phase that reads no file.
  autoRun: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'width', label: 'Width', type: 'number', default: 640, min: 1 },
    { name: 'height', label: 'Height', type: 'number', default: 360, min: 1 },
    { name: 'label', label: 'Label', type: 'text', default: '', placeholder: 'Leave empty for the size' },
    { name: 'background', label: 'Background', type: 'color', default: '#cccccc' },
    { name: 'foreground', label: 'Foreground', type: 'color', default: '#333333' },
    { name: 'fontSize', label: 'Font size (0 = automatic)', type: 'number', default: 0, min: 0 },
    { name: 'fontFamily', label: 'Font', type: 'select', default: 'sans-serif', options: FONT_FAMILY_OPTIONS },
    { name: 'pattern', label: 'Pattern', type: 'select', default: 'none', options: PATTERN_OPTIONS },
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'svg',
      options: [
        { value: 'svg', label: 'SVG' },
        { value: 'png', label: 'PNG' },
        { value: 'both', label: 'Both' },
      ],
    },
  ],
  examples: [{ label: 'A 16 by 9 hero placeholder', values: { width: 1280, height: 720, pattern: 'grid' } }],
  async run(values): Promise<ToolResult> {
    const fontFamily = str(values, 'fontFamily', 'sans-serif') as
      'sans-serif' | 'serif' | 'monospace' | 'cursive' | 'fantasy';
    const pattern = str(values, 'pattern', 'none') as Pattern;
    const fontSizeInput = num(values, 'fontSize', 0);

    const result = generatePlaceholder({
      width: num(values, 'width', 640),
      height: num(values, 'height', 360),
      label: str(values, 'label', ''),
      background: str(values, 'background', '#cccccc'),
      foreground: str(values, 'foreground', '#333333'),
      fontSize: fontSizeInput > 0 ? fontSizeInput : undefined,
      fontFamily,
      pattern,
    });

    const format = str(values, 'format', 'svg');
    const outputs: OutputBlock[] = [
      { kind: 'image', src: result.dataUri, alt: 'Placeholder preview', width: result.width, height: result.height },
      {
        kind: 'code',
        label: 'SVG',
        language: 'xml',
        value: result.svg,
        download: `placeholder-${result.width}x${result.height}.svg`,
      },
      { kind: 'code', label: 'Data URI', value: result.dataUri },
    ];

    const warnings = [...result.warnings];

    if (format === 'png' || format === 'both') {
      if (result.width > MAX_PNG_SIDE || result.height > MAX_PNG_SIDE) {
        warnings.push(
          `PNG output is limited to ${MAX_PNG_SIDE.toLocaleString('en-US')} pixels on a side in this browser; the SVG above is not affected.`,
        );
      } else {
        try {
          const blob = await drawPlaceholderPng(result, {
            background: result.background,
            foreground: result.foreground,
            fontFamily: result.fontFamily,
            fontSize: result.fontSize,
            pattern: result.pattern,
          });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          outputs.push({
            kind: 'files',
            label: 'PNG',
            files: [{ name: `placeholder-${result.width}x${result.height}.png`, mime: 'image/png', content: bytes }],
          });
        } catch (err) {
          return {
            outputs,
            errors: [{ message: err instanceof Error ? err.message : 'Could not draw the PNG for an unknown reason.' }],
          };
        }
      }
    }

    return {
      outputs,
      warnings,
      stats: [
        ['Size', `${result.width} × ${result.height}`],
        ['Label', result.label],
      ],
    };
  },
});
