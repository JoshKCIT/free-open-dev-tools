import { meta, convertMarkup, BbcodeError, type MarkupFormat } from '@fodt/bbcode';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function describeRemoved(removed: {
  elements: number;
  eventHandlers: number;
  dangerousUrls: number;
  externalReferences: number;
  styles: number;
}): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (removed.elements > 0) {
    lines.push(
      `Removed ${plural(removed.elements, 'script or other active element', 'scripts or other active elements')}.`,
    );
  }
  if (removed.eventHandlers > 0) {
    lines.push(`Removed ${plural(removed.eventHandlers, 'event handler attribute', 'event handler attributes')}.`);
  }
  if (removed.dangerousUrls > 0) {
    lines.push(
      `Removed ${plural(removed.dangerousUrls, 'dangerous URL or attribute', 'dangerous URLs or attributes')}.`,
    );
  }
  if (removed.externalReferences > 0) {
    lines.push(
      `Removed ${plural(removed.externalReferences, 'reference to another address', 'references to other addresses')}.`,
    );
  }
  if (removed.styles > 0) {
    lines.push(`Removed ${plural(removed.styles, 'dangerous style', 'dangerous styles')}.`);
  }
  return lines;
}

export default defineTool({
  id: 'bbcode',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'from',
      label: 'From',
      type: 'select',
      default: 'bbcode',
      options: [
        { value: 'bbcode', label: 'BBCode' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'html', label: 'HTML' },
      ],
    },
    {
      name: 'to',
      label: 'To',
      type: 'select',
      default: 'html',
      options: [
        { value: 'bbcode', label: 'BBCode' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'html', label: 'HTML' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'Bold, a link and a colour, converted to HTML',
      values: {
        from: 'bbcode',
        to: 'html',
        input: '[b]Hello[/b] [url=https://example.com]link[/url] [color=red]red text[/color]',
      },
    },
    {
      label: 'Markdown emphasis and a link, converted to BBCode',
      values: { from: 'markdown', to: 'bbcode', input: '*a* **b** [c](https://example.com)' },
    },
  ],
  run(values): ToolResult {
    const from = str(values, 'from', 'bbcode') as MarkupFormat;
    const to = str(values, 'to', 'html') as MarkupFormat;
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = convertMarkup(input, { from, to }, window);
      const outputs: OutputBlock[] = [];

      if (to === 'html') {
        outputs.push({
          kind: 'code',
          label: 'HTML',
          language: 'html',
          value: result.output,
          download: 'document.html',
        });
        outputs.push({ kind: 'sandboxed-html', label: 'Preview', html: result.preview });
        const removedLines = describeRemoved(result.removed);
        const allWarnings = [...removedLines, ...result.warnings];
        if (allWarnings.length > 0) {
          outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: allWarnings.join('\n') });
        }
      } else {
        const language = to === 'markdown' ? 'markdown' : undefined;
        const download = to === 'markdown' ? 'document.md' : 'document.bbcode';
        outputs.push({
          kind: 'code',
          label: to === 'markdown' ? 'Markdown' : 'BBCode',
          language,
          value: result.output,
          download,
        });
        if (result.warnings.length > 0) {
          outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
        }
      }

      return { outputs, stats: [['Characters', String(result.output.length)]] };
    } catch (err) {
      if (err instanceof BbcodeError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
