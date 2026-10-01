import { meta, PythonFormatterError } from '@fodt/python-formatter';
import { pythonFormatterInWorker, PythonFormatterRunError } from '../lib/run-python-formatter-in-worker';
import { defineTool, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'python-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-python-formatter-in-worker.ts's own comment): the engine is a
  // WebAssembly build that may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Python source',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'lineLength',
      label: 'Line length',
      type: 'number',
      default: 88,
      min: 1,
      max: 65535,
      help: 'Lines are wrapped to fit this many characters where they can be. Ruff starts at 88.',
    },
    {
      name: 'quoteStyle',
      label: 'Quote style',
      type: 'select',
      default: 'double',
      options: [
        { value: 'double', label: 'Double quotes' },
        { value: 'single', label: 'Single quotes' },
        { value: 'preserve', label: 'Keep as written' },
      ],
    },
    {
      name: 'indentStyle',
      label: 'Indent with',
      type: 'radio',
      default: 'space',
      options: [
        { value: 'space', label: 'Spaces' },
        { value: 'tab', label: 'Tabs' },
      ],
    },
    {
      name: 'indentWidth',
      label: 'Indent width',
      type: 'number',
      default: 4,
      min: 1,
      max: 255,
      help: 'Spaces per indent level, or the width a tab counts as when lines are measured.',
    },
  ],
  examples: [
    {
      label: 'Normalise quotes and spacing',
      values: {
        input:
          "def greet( name ,greeting='hello' ):\n    message = greeting+', '+name\n    return   message\nprint( greet( 'world' ) )\n",
      },
    },
    {
      label: 'Single quotes',
      values: {
        input: 'names = ["ada", "grace", "edsger"]\nfor n in names:\n    print("hello, " + n)\n',
        quoteStyle: 'single',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const options = {
      lineLength: num(values, 'lineLength', 88),
      quoteStyle: str(values, 'quoteStyle', 'double') as 'double' | 'single' | 'preserve',
      indentStyle: str(values, 'indentStyle', 'space') as 'space' | 'tab',
      indentWidth: num(values, 'indentWidth', 4),
    };

    try {
      const result = await pythonFormatterInWorker({ type: 'python-formatter-job', source: input, options }, ctx);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Formatted Python',
          language: 'python',
          value: result.output,
          download: 'formatted.py',
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
      if (err instanceof PythonFormatterError || err instanceof PythonFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
