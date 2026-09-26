import { meta, buildPalette } from '@fodt/color-palette';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'color-palette',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'base', label: 'Base colour', type: 'color', default: '#2563eb' },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'harmony',
      options: [
        { value: 'harmony', label: 'Harmony' },
        { value: 'tints', label: 'Tints' },
        { value: 'shades', label: 'Shades' },
        { value: 'tones', label: 'Tones' },
        { value: 'blend', label: 'Blend' },
      ],
    },
    {
      name: 'harmonyName',
      label: 'Harmony',
      type: 'select',
      default: 'complementary',
      visible: (v) => v.mode === 'harmony' || v.mode === undefined,
      options: [
        { value: 'complementary', label: 'Complementary' },
        { value: 'analogous', label: 'Analogous' },
        { value: 'triadic', label: 'Triadic' },
        { value: 'splitComplementary', label: 'Split complementary' },
        { value: 'tetradic', label: 'Tetradic' },
      ],
    },
    {
      name: 'steps',
      label: 'Steps',
      type: 'number',
      default: 5,
      min: 3,
      max: 12,
      step: 1,
      visible: (v) => v.mode === 'tints' || v.mode === 'shades' || v.mode === 'tones' || v.mode === 'blend',
    },
    {
      name: 'second',
      label: 'Second colour',
      type: 'color',
      default: '#f97316',
      visible: (v) => v.mode === 'blend',
    },
    {
      name: 'space',
      label: 'Mixing space',
      type: 'radio',
      default: 'oklch',
      options: [
        { value: 'oklch', label: 'OKLCH' },
        { value: 'hsl', label: 'HSL' },
        { value: 'srgb', label: 'sRGB' },
      ],
    },
  ],
  examples: [
    {
      label: 'Complementary',
      values: { base: '#2563eb', mode: 'harmony', harmonyName: 'complementary', space: 'oklch' },
    },
    { label: 'Tints', values: { base: '#2563eb', mode: 'tints', steps: 5, space: 'oklch' } },
    {
      label: 'Blend to orange',
      values: { base: '#2563eb', mode: 'blend', second: '#f97316', steps: 5, space: 'oklch' },
    },
  ],
  run(values): ToolResult {
    const base = str(values, 'base', '#2563eb');
    const mode = str(values, 'mode', 'harmony') as 'harmony' | 'tints' | 'shades' | 'tones' | 'blend';
    const harmonyName = str(values, 'harmonyName', 'complementary');
    const steps = num(values, 'steps', 5);
    const second = str(values, 'second', '#f97316');
    const space = str(values, 'space', 'oklch');

    const result = buildPalette({
      base,
      mode,
      harmonyName: harmonyName as never,
      steps,
      second,
      space: (mode === 'harmony'
        ? space === 'hsl'
          ? 'hsl'
          : 'oklch'
        : space === 'srgb'
          ? 'srgb'
          : space === 'oklch'
            ? 'oklch'
            : 'oklab') as never,
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'swatches',
        label: 'Palette',
        colors: result.swatches.map((s) => ({ css: s.css, label: s.label, caption: s.caption })),
      },
      {
        kind: 'code',
        label: 'CSS custom properties',
        language: 'css',
        value: result.css,
        download: 'palette.css',
      },
      {
        kind: 'table',
        label: 'Swatches',
        table: {
          headers: ['#', 'HEX', 'OKLCH', 'Mapped'],
          rows: result.table.map((r) => [r.index, r.hex, r.oklch, r.mapped ? 'Yes' : 'No']),
          mono: [1, 2],
        },
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
