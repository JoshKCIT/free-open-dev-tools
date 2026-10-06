import { meta, GoFormatterError } from '@fodt/go-formatter';
import {
  GO_FORMATTER_TIME_LIMIT_MS,
  goFormatterInWorker,
  GoFormatterRunError,
} from '../lib/run-go-formatter-in-worker';
import { defineTool, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'go-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-go-formatter-in-worker.ts's own comment): the engine is a
  // WebAssembly build that may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  cancellable: true,
  runLimit: { ms: GO_FORMATTER_TIME_LIMIT_MS },
  fields: [
    {
      name: 'input',
      label: 'Go source',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'Sort imports and fix spacing',
      values: {
        input:
          'package main\nimport ("os"\n"fmt")\nfunc main(){\nfmt.Println("hello",os.Args)\nif len(os.Args)>1{fmt.Println("more")}\n}\n',
      },
    },
    {
      label: 'Generic types',
      values: {
        input:
          'package main\ntype Number interface{~int|~float64}\nfunc Sum[T Number](xs []T) T{\nvar total T\nfor _,x:=range xs{total+=x}\nreturn total}\n',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    try {
      const result = await goFormatterInWorker({ type: 'go-formatter-job', source: input }, ctx);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Formatted Go',
          language: 'go',
          value: result.output,
          download: 'formatted.go',
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
      if (err instanceof GoFormatterError || err instanceof GoFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
