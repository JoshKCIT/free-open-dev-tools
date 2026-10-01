import { meta, DartFormatterError } from '@fodt/dart-formatter';
import { dartFormatterInWorker, DartFormatterRunError } from '../lib/run-dart-formatter-in-worker';
import { defineTool, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'dart-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-dart-formatter-in-worker.ts's own comment): the engine is a
  // WebAssembly build that may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Dart source',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'lineWidth',
      label: 'Line width',
      type: 'number',
      default: 80,
      min: 1,
      max: 1000,
      help: "dart_style's own default is 80.",
    },
  ],
  examples: [
    {
      label: 'Wrap a long import',
      values: {
        input:
          "import 'package:some_long_package_name/some/very/long/path/to/a_file.dart' as some_alias;\nvoid main(){print('hello');}\n",
      },
    },
    {
      label: 'Narrow width',
      values: {
        input:
          "class Greeter {\n  final String name;\n  Greeter(this.name);\n  String greet(String other) => 'Hello, $other, I am $name';\n}\n",
        lineWidth: 40,
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    // A blank field uses the default of 80. Any number typed in, such as the large negative one the privacy
    // harness types, goes to the package, which refuses it by name before the engine runs.
    const options = { lineWidth: num(values, 'lineWidth', 80) };

    try {
      const result = await dartFormatterInWorker({ type: 'dart-formatter-job', source: input, options }, ctx);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Formatted Dart',
          language: 'dart',
          value: result.output,
          download: 'formatted.dart',
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
      if (err instanceof DartFormatterError || err instanceof DartFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
