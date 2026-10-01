import { meta, ShellFormatterError, SHELL_DIALECTS, type ShellDialect } from '@fodt/shell-formatter';
import { shellFormatterInWorker, ShellFormatterRunError } from '../lib/run-shell-formatter-in-worker';
import { defineTool, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The dialect choices, in the package's own order, each with the label the visitor reads. */
const DIALECT_LABELS: Record<ShellDialect, string> = {
  posix: 'POSIX sh (formatting only: bash-only syntax is not refused)',
  bash: 'bash',
  mksh: 'mksh',
};

export default defineTool({
  id: 'shell-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-shell-formatter-in-worker.ts's own comment): the engine is a
  // WebAssembly build that may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Shell script',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'dialect',
      label: 'Dialect',
      type: 'select',
      default: 'bash',
      options: SHELL_DIALECTS.map((value) => ({ value, label: DIALECT_LABELS[value] })),
    },
    {
      name: 'indent',
      label: 'Indent',
      type: 'number',
      default: 0,
      min: 0,
      max: 16,
      help: '0 indents with tabs, as shfmt does by default; 1 to 16 indents with that many spaces.',
    },
  ],
  examples: [
    {
      label: 'Tidy an if block',
      values: {
        input: 'if [ -f /etc/hosts ];then\necho "found"\nelse\n   echo "missing"\nfi\nfor f in a b c;do echo $f;done\n',
      },
    },
    {
      label: 'Indent with two spaces',
      values: {
        input: 'build(){\ncd src\nmake all &&\nmake install\n}\nbuild\n',
        indent: 2,
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const options = {
      dialect: str(values, 'dialect', 'bash') as ShellDialect,
      indent: num(values, 'indent', 0),
    };

    try {
      const result = await shellFormatterInWorker({ type: 'shell-formatter-job', source: input, options }, ctx);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Formatted shell script',
          language: 'bash',
          value: result.output,
          download: 'formatted.sh',
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
      if (err instanceof ShellFormatterError || err instanceof ShellFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
