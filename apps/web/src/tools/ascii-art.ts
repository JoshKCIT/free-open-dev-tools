import { meta, renderBanner, FONT_NAMES, FigletFontError, type Layout } from '@fodt/ascii-art';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ascii-art',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      rows: 3,
      default: 'Hello',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'font',
      label: 'Font',
      type: 'select',
      default: 'standard',
      options: FONT_NAMES.map((name) => ({ value: name, label: name })),
    },
    {
      name: 'layout',
      label: 'Layout',
      type: 'select',
      default: 'fitted',
      options: [
        { value: 'fitted', label: 'Fitted (characters touch)' },
        { value: 'full', label: 'Full width' },
      ],
    },
  ],
  examples: [{ label: 'Hello, standard font', values: { text: 'Hello', font: 'standard', layout: 'fitted' } }],
  run(values): ToolResult {
    const text = str(values, 'text');
    if (!text) return { outputs: [] };

    const font = str(values, 'font', 'standard');
    const layout = str(values, 'layout', 'fitted') as Layout;

    let result;
    try {
      result = renderBanner(font, text, { layout });
    } catch (error) {
      if (error instanceof FigletFontError) {
        return { outputs: [], errors: [{ message: error.message }] };
      }
      throw error;
    }

    const outputs: OutputBlock[] = [{ kind: 'code', label: 'Banner', value: result.lines.join('\n') }];
    if (result.missing.length > 0) {
      outputs.push({
        kind: 'note',
        tone: 'warn',
        value: `This font has no glyph for: ${result.missing.join(' ')}. Those characters were skipped.`,
      });
    }

    return { outputs };
  },
});
