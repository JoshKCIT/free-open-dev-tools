import { meta, MarkdownFormatterError } from '@fodt/markdown-formatter';
import {
  MARKDOWN_FORMATTER_TIME_LIMIT_MS,
  markdownFormatterInWorker,
  MarkdownFormatterRunError,
} from '../lib/run-markdown-formatter-in-worker';
import { defineTool, str, num, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'markdown-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 5 second time limit
  // (see run-markdown-formatter-in-worker.ts's own comment): unlike some
  // other pages on this site, there is no cheap way to detect ahead of
  // time whether a given Markdown document will be one of the slow shapes.
  cancellable: true,
  runLimit: { ms: MARKDOWN_FORMATTER_TIME_LIMIT_MS },
  fields: [
    {
      name: 'input',
      label: 'Markdown',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'parser',
      label: 'Format',
      type: 'radio',
      default: 'markdown',
      options: [
        { value: 'markdown', label: 'Markdown (CommonMark + GFM)' },
        { value: 'mdx', label: 'MDX' },
      ],
    },
    {
      name: 'proseWrap',
      label: 'Prose wrap',
      type: 'select',
      default: 'preserve',
      options: [
        { value: 'preserve', label: 'Keep line breaks as written' },
        { value: 'always', label: 'Wrap at the print width' },
        { value: 'never', label: 'One line per paragraph' },
      ],
    },
    {
      name: 'printWidth',
      label: 'Print width',
      type: 'number',
      default: 80,
      min: 20,
      max: 200,
      step: 1,
      help: 'The column prose wraps at when Prose wrap is "Wrap at the print width"; ignored otherwise.',
      // Only affects the 'always' wrap mode (Prettier ignores it under
      // preserve or never, and table alignment ignores it too -- see this
      // package's own meta.json ambiguities); hidden the rest of the time
      // so it never carries a stray value into a run it has no effect on.
      visible: (values) => values.proseWrap === 'always',
    },
  ],
  examples: [
    {
      label: 'Align a table and tidy a list',
      values: {
        input: '| a | bbbb | c |\n|:-|:-:|-:|\n| 1 | 2 | 333333 |\n\n* one\n* two\n',
        parser: 'markdown',
        proseWrap: 'preserve',
      },
    },
    {
      label: 'Wrap long prose at 40 columns',
      values: {
        input:
          'This is a reasonably long sentence that should wrap onto more than one line at a narrow print width. Here is a second sentence to wrap too.\n',
        parser: 'markdown',
        proseWrap: 'always',
        printWidth: 40,
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const parser = str(values, 'parser', 'markdown') === 'mdx' ? 'mdx' : 'markdown';
    const proseWrapValue = str(values, 'proseWrap', 'preserve');
    const proseWrap = proseWrapValue === 'always' || proseWrapValue === 'never' ? proseWrapValue : 'preserve';

    const options = {
      parser,
      proseWrap,
      printWidth: num(values, 'printWidth', 80),
    } as const;

    try {
      const result = await markdownFormatterInWorker({ type: 'markdown-formatter-job', source: input, options }, ctx);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: 'markdown',
          value: result.output,
          download: parser === 'mdx' ? 'formatted.mdx' : 'formatted.md',
        },
      ];

      return {
        outputs,
        stats: [
          ['Input', formatBytes(result.inputBytes)],
          ['Output', formatBytes(result.outputBytes)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof MarkdownFormatterError || err instanceof MarkdownFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
