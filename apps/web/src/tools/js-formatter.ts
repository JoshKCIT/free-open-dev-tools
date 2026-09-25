import { meta, formatJs, JsFormatterError } from '@fodt/js-formatter';
import { jsFormatterInWorker, JsFormatterRunError } from '../lib/run-js-formatter-in-worker';
import { defineTool, str, bool, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'js-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Only the TypeScript + minify combination runs in a background worker
  // with a 1.5 second time limit (D-57: `ts.transpileModule` showed clear
  // super-linear growth on a long chain of string concatenation, the same
  // pattern found elsewhere on this site's own type-stripping page). Every
  // other combination measured well under 1 second and runs on the main
  // thread. `cancellable: true` applies to the whole page; cancelling a
  // main-thread run is a no-op since those complete almost instantly.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'JavaScript or TypeScript',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'language',
      label: 'Language',
      type: 'radio',
      default: 'javascript',
      options: [
        { value: 'javascript', label: 'JavaScript' },
        { value: 'typescript', label: 'TypeScript' },
      ],
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'beautify',
      options: [
        { value: 'beautify', label: 'Beautify' },
        { value: 'minify', label: 'Minify' },
      ],
    },
    {
      name: 'indent',
      label: 'Indent',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: 'tab', label: 'Tab' },
      ],
      visible: (values) => values.mode !== 'minify',
    },
    {
      name: 'semicolons',
      label: 'Semicolons',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode !== 'minify',
    },
    {
      name: 'singleQuote',
      label: 'Single quotes',
      type: 'checkbox',
      default: false,
      visible: (values) => values.mode !== 'minify',
    },
    {
      name: 'module',
      label: "Module (top-level 'this' is undefined)",
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
    {
      name: 'mangle',
      label: 'Shorten local names',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
    {
      name: 'compress',
      label: 'Compress',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
    {
      name: 'keepLicenceComments',
      label: 'Keep licence and JSDoc comments',
      type: 'checkbox',
      default: true,
      visible: (values) => values.mode === 'minify',
    },
  ],
  examples: [
    {
      label: 'Beautify a compact object',
      values: { input: 'const a={b:1}', language: 'javascript', mode: 'beautify' },
    },
    {
      label: 'Beautify TypeScript with a generic',
      values: {
        input: 'interface Box<T>{value:T}\nfunction wrap<T>(v:T):Box<T>{return {value:v} satisfies Box<T>;}',
        language: 'typescript',
        mode: 'beautify',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const language = str(values, 'language', 'javascript') === 'typescript' ? 'typescript' : 'javascript';
    const mode = str(values, 'mode', 'beautify') === 'minify' ? 'minify' : 'beautify';
    const indentValue = str(values, 'indent', '2');
    const indent = indentValue === 'tab' ? 'tab' : indentValue === '4' ? 4 : 2;

    const options = {
      language,
      mode,
      indent,
      semicolons: bool(values, 'semicolons', true),
      singleQuote: bool(values, 'singleQuote', false),
      module: bool(values, 'module', true),
      mangle: bool(values, 'mangle', true),
      compress: bool(values, 'compress', true),
      keepLicenceComments: bool(values, 'keepLicenceComments', true),
    } as const;

    try {
      // Only this combination is routed to the worker; see the field's own
      // comment above the docs object for why.
      const result =
        language === 'typescript' && mode === 'minify'
          ? await jsFormatterInWorker({ type: 'js-formatter-job', source: input, options }, ctx)
          : await formatJs(input, options);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: language === 'typescript' && mode === 'beautify' ? 'typescript' : 'javascript',
          value: result.output,
          download:
            mode === 'beautify' ? (language === 'typescript' ? 'formatted.ts' : 'formatted.js') : 'script.min.js',
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: result.warnings.join('\n') });
      }

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
      if (err instanceof JsFormatterError || err instanceof JsFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
