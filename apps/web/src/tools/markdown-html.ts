import { meta, markdownToSafeHtml, MarkdownHtmlError } from '@fodt/markdown-html';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'markdown-html',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'md-to-html',
      options: [
        { value: 'md-to-html', label: 'Markdown to HTML' },
        { value: 'html-to-md', label: 'HTML to Markdown' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'toc',
      label: 'Table of contents',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'md-to-html') === 'md-to-html',
    },
    {
      name: 'tocDepth',
      label: 'Table of contents depth',
      type: 'number',
      default: 3,
      min: 1,
      max: 6,
      visible: (values) => str(values, 'direction', 'md-to-html') === 'md-to-html' && bool(values, 'toc', false),
    },
  ],
  examples: [
    {
      label: 'A heading, a table and a hostile script stripped',
      values: {
        direction: 'md-to-html',
        input: '# Hi\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>',
      },
    },
  ],
  run(values): ToolResult {
    const direction = str(values, 'direction', 'md-to-html');
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      if (direction === 'md-to-html') {
        const tocDepthInput = num(values, 'tocDepth', 3);
        const tocDepth = Math.min(6, Math.max(1, Math.trunc(tocDepthInput)));
        const result = markdownToSafeHtml(input, window, {
          toc: bool(values, 'toc', false),
          tocDepth,
        });

        const outputs: OutputBlock[] = [
          { kind: 'code', label: 'HTML', language: 'html', value: result.html, download: 'document.html' },
          { kind: 'sandboxed-html', label: 'Preview', html: result.html },
        ];
        if (result.warnings.length > 0) {
          outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
        }

        return { outputs, stats: [['Headings', String(result.headings.length)]] };
      }

      // Task 2 fills in the html-to-md branch.
      return { outputs: [], errors: [{ message: 'HTML to Markdown is not available yet.' }] };
    } catch (err) {
      if (err instanceof MarkdownHtmlError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
