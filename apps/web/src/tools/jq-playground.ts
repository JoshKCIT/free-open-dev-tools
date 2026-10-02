import { checkInputSize, meta, JqPlaygroundError, type JqOptions } from '@fodt/jq-playground';
import { jqPlaygroundInWorker, JqPlaygroundRunError } from '../lib/run-jq-playground-in-worker';
import { defineTool, bool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** Where a problem is, as the start of its message: a filter or an input problem names itself, a run problem does not. */
function problemMessage(part: string | undefined, message: string): string {
  if (part === 'filter') return `Filter: ${message}`;
  if (part === 'input' && message.startsWith('parse error')) return `Input: ${message}`;
  return message;
}

function outputBlock(output: string, raw: boolean, label: string): OutputBlock {
  return {
    kind: 'code',
    label,
    ...(raw ? {} : { language: 'json' }),
    value: output,
    download: 'jq-output.json',
  };
}

export default defineTool({
  id: 'jq-playground',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a new worker with a 5 second limit (see run-jq-playground-in-worker.ts's own comment): a
  // filter that never ends is stuck inside one synchronous engine call, so the page, not the engine, decides when it
  // has taken too long, and Cancel stops it at once.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'JSON input',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One or more JSON values.',
    },
    {
      name: 'filter',
      label: 'Filter',
      type: 'text',
      mono: true,
      default: '.',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'compact', label: 'Compact output', type: 'checkbox', default: false },
    { name: 'raw', label: 'Raw output', type: 'checkbox', default: false, help: 'Strings print without quotes.' },
    { name: 'slurp', label: 'Slurp', type: 'checkbox', default: false, help: 'Read all the inputs into one array.' },
    { name: 'sortKeys', label: 'Sort keys', type: 'checkbox', default: false },
    {
      name: 'nullInput',
      label: 'Null input',
      type: 'checkbox',
      default: false,
      help: 'Run the filter once with null and ignore the input.',
    },
    { name: 'ascii', label: 'ASCII output', type: 'checkbox', default: false },
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
    },
    {
      name: 'args',
      label: 'Arguments (a JSON object)',
      type: 'text',
      mono: true,
      placeholder: '{"limit": 3}',
      help: 'Each key becomes a variable, so {"limit": 3} gives you $limit in the filter.',
    },
  ],
  examples: [
    {
      label: 'Pick and reshape fields',
      values: {
        input: '{"user":"stedolan","titles":["JQ Primer","More JQ"]}',
        filter: '{user, title: .titles[]}',
      },
    },
    {
      label: 'Group and count',
      values: {
        input:
          '[{"kind":"fruit","name":"apple"},{"kind":"veg","name":"leek"},{"kind":"fruit","name":"pear"},{"kind":"veg","name":"kale"},{"kind":"veg","name":"bean"}]',
        filter: 'group_by(.kind) | map({kind: .[0].kind, count: length})',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    const filter = str(values, 'filter', '.');
    const nullInput = bool(values, 'nullInput');
    if (!filter.trim() || (!input.trim() && !nullInput)) return { outputs: [] };

    const indentChoice = str(values, 'indent', '2');
    const options: JqOptions = {
      compact: bool(values, 'compact'),
      raw: bool(values, 'raw'),
      slurp: bool(values, 'slurp'),
      sortKeys: bool(values, 'sortKeys'),
      nullInput,
      ascii: bool(values, 'ascii'),
      indent: indentChoice === 'tab' || indentChoice === '4' ? indentChoice : '2',
      args: str(values, 'args'),
    };

    try {
      // Refused before any worker starts, so an oversize input never reaches the engine.
      checkInputSize(input);
      const result = await jqPlaygroundInWorker({ type: 'jq-playground-job', input, filter, options }, ctx);
      if (!result) return { outputs: [] };

      const outputs: OutputBlock[] = [];
      if (result.output === '') {
        outputs.push({ kind: 'note', tone: 'info', value: 'The filter produced no output.' });
      } else {
        outputs.push(outputBlock(result.output, options.raw, 'Output'));
      }
      if (result.truncated) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: 'The output is longer than 1 MiB, so only the first 1 MiB is shown.',
        });
      }
      if (result.stderr !== '') {
        outputs.push({ kind: 'code', label: 'Messages from debug and stderr', value: result.stderr });
      }
      if (result.exitCode !== 0) {
        outputs.push({ kind: 'note', tone: 'warn', value: `jq stopped with exit status ${result.exitCode}.` });
      }
      return { outputs };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns
      // that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof JqPlaygroundError || err instanceof JqPlaygroundRunError) {
        const before: OutputBlock[] =
          err.output === '' ? [] : [outputBlock(err.output, options.raw, 'Output before the error')];
        // What debug and stderr wrote before the failure stays visible too.
        if (err.diagnostics !== '') {
          before.push({ kind: 'code', label: 'Messages from debug and stderr', value: err.diagnostics });
        }
        return {
          // What the filter produced before it failed stays visible above the error.
          outputs: before,
          errors: [{ message: problemMessage(err.part, err.message), line: err.line, column: err.column }],
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'Could not run that filter.' }],
      };
    }
  },
});
