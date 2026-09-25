import { meta } from '@fodt/ts-to-js';
import { tsToJsInWorker, TsToJsRunError } from '../lib/run-ts-to-js-in-worker';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ts-to-js',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Compiling runs in a background worker with a 1.5 second time limit
  // (D-57: a long chain of string concatenation showed clear super-linear
  // growth measured against the installed compiler), so the run can be
  // cancelled.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'TypeScript',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'target',
      label: 'Target',
      type: 'select',
      default: 'ES2022',
      options: [
        { value: 'ES2015', label: 'ES2015' },
        { value: 'ES2017', label: 'ES2017' },
        { value: 'ES2020', label: 'ES2020' },
        { value: 'ES2022', label: 'ES2022' },
        { value: 'ESNext', label: 'ESNext' },
      ],
    },
    {
      name: 'module',
      label: 'Module format',
      type: 'select',
      default: 'preserve',
      options: [
        { value: 'preserve', label: 'Keep import and export as written' },
        { value: 'commonjs', label: 'CommonJS' },
      ],
    },
    {
      name: 'jsx',
      label: 'JSX',
      type: 'select',
      default: 'preserve',
      options: [
        { value: 'preserve', label: 'Keep JSX as written' },
        { value: 'react-jsx', label: 'Automatic JSX runtime' },
        { value: 'react', label: 'React.createElement' },
      ],
    },
    { name: 'removeComments', label: 'Remove comments', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Type annotations erased',
      values: {
        input:
          'function greet(person: string, date: Date) {\n  console.log(`Hello ${person}, today is ${date.toDateString()}!`);\n}',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = await tsToJsInWorker(
        {
          type: 'ts-to-js-job',
          source: input,
          options: {
            target: str(values, 'target', 'ES2022') as 'ES2015' | 'ES2017' | 'ES2020' | 'ES2022' | 'ESNext',
            module: str(values, 'module', 'preserve') as 'preserve' | 'commonjs',
            jsx: str(values, 'jsx', 'preserve') as 'preserve' | 'react-jsx' | 'react',
            removeComments: bool(values, 'removeComments', false),
          },
        },
        ctx,
      );

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'JavaScript', language: 'javascript', value: result.output, download: 'output.js' },
      ];

      if (result.diagnostics.length > 0) {
        return {
          outputs,
          errors: result.diagnostics.map((d) => ({ message: d.message, line: d.line, column: d.column })),
        };
      }

      return { outputs };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message.
      if (ctx.signal.aborted) throw err;
      const message =
        err instanceof TsToJsRunError || err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
